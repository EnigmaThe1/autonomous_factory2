import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { DiskMissionPersistence, PersistedMcpSessionState } from "../storage/DiskMissionPersistence";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { McpToolDescriptor, ToolCall } from "../types";
import { trimText } from "../util";

interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

interface McpConfigFile {
  servers: McpServerConfig[];
}

/** JSON-RPC 2.0 response shapes for MCP protocol methods. */
interface McpToolsListResponse {
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>;
}

interface McpJsonRpcMessage {
  jsonrpc: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

interface McpSession {
  config: McpServerConfig;
  child: ChildProcessWithoutNullStreams;
  status: "starting" | "ready" | "error";
  startedAt: number;
  lastError?: string;
  seq: number;
  buffer: string;
  pending: Map<number, PendingRequest>;
  toolsCache?: { at: number; tools: McpToolDescriptor[] };
}

export class McpRegistry implements vscode.Disposable {
  private readonly sessions = new Map<string, McpSession>();
  private readonly persisted = new Map<string, PersistedMcpSessionState>();
  private persistDirty = false;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private static readonly PERSIST_DEBOUNCE_MS = 500;

  constructor(private readonly paths: WorkspacePaths, private readonly disk: DiskMissionPersistence) {}

  async hydrate(): Promise<void> {
    const states = await this.disk.loadMcpSessionStates();
    this.persisted.clear();
    for (const state of states) this.persisted.set(state.name, state);
    if (vscode.workspace.getConfiguration().get<boolean>("myAi.mcp.sessionWarmupOnStartup", false)) {
      const servers = await this.listServers();
      for (const server of servers) {
        try {
          await this.getSession(server.name);
        } catch {
          // keep startup resilient
        }
      }
    }
  }

  dispose(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    if (this.persistDirty) {
      this.persistDirty = false;
      void this.flushPersist();
    }
    for (const session of this.sessions.values()) {
      try { session.child.kill(); } catch {}
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP session closed: ${session.config.name}`));
      }
    }
    this.sessions.clear();
  }

  /** Resolved filesystem path for the configured MCP JSON (or configured value when no workspace root). */
  getResolvedConfigPath(): string {
    const configured = vscode.workspace.getConfiguration().get<string>("myAi.mcp.configPath", "examples/mcp.sample.json");
    if (path.isAbsolute(configured)) return configured;
    const root = this.paths.workspaceRoot();
    return root ? path.join(root, configured) : configured;
  }

  async listServers(): Promise<McpServerConfig[]> {
    const file = this.getResolvedConfigPath();
    try {
      const text = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(text) as McpConfigFile;
      return Array.isArray(parsed.servers) ? parsed.servers : [];
    } catch {
      return [];
    }
  }

  async listSessionStates(): Promise<PersistedMcpSessionState[]> {
    const states: PersistedMcpSessionState[] = [];
    const servers = await this.listServers();
    for (const server of servers) {
      const live = this.sessions.get(server.name);
      if (live) {
        states.push({
          name: server.name,
          status: live.status,
          lastStartedAt: live.startedAt,
          lastError: live.lastError,
          toolCount: live.toolsCache?.tools.length
        });
        continue;
      }
      states.push(this.persisted.get(server.name) || { name: server.name, status: "disconnected" });
    }
    return states;
  }

  async restartSession(name: string): Promise<void> {
    const existing = this.sessions.get(name);
    if (existing) {
      try { existing.child.kill(); } catch {}
      this.sessions.delete(name);
    }
    const servers = await this.listServers();
    const server = servers.find((s) => s.name === name);
    if (!server) throw new Error(`MCP server not found: ${name}`);
    await this.getSession(name, server);
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const servers = await this.listServers();
    const out: McpToolDescriptor[] = [];
    for (const server of servers) {
      try {
        const session = await this.getSession(server.name, server);
        const ttlMs = Math.max(5, vscode.workspace.getConfiguration().get<number>("myAi.mcp.toolCacheTtlSeconds", 60)) * 1000;
        if (!session.toolsCache || (Date.now() - session.toolsCache.at) > ttlMs) {
          const res = await this.sendRequest(session, "tools/list", {}) as McpToolsListResponse | undefined;
          const tools = Array.isArray(res?.tools) ? res.tools : [];
          session.toolsCache = {
            at: Date.now(),
            tools: tools.map((tool) => ({
              server: server.name,
              name: String(tool.name || "unknown"),
              description: tool.description ? String(tool.description) : undefined,
              inputSchema: tool.inputSchema,
              sessionState: session.status
            }))
          };
          await this.persistState(server.name, session);
        }
        out.push(...session.toolsCache.tools.map((tool) => ({ ...tool, sessionState: session.status })));
      } catch {
        out.push({ server: server.name, name: "<unavailable>", description: "Session unavailable", sessionState: "error" });
      }
    }
    return out;
  }

  async execute(call: ToolCall): Promise<{ ok: boolean; summary: string; data?: unknown }> {
    const match = call.tool.match(/^mcp\.([^.]+)\.(.+)$/);
    if (!match) return { ok: false, summary: `Invalid MCP tool name: ${call.tool}` };
    const [, serverName, toolName] = match;
    const session = await this.getSession(serverName);
    try {
      const data = await this.sendRequest(session, "tools/call", { name: toolName, arguments: call.args || {} });
      return { ok: true, summary: `MCP ${serverName}.${toolName} completed`, data };
    } catch (err) {
      session.lastError = String(err);
      session.status = "error";
      await this.persistState(serverName, session);
      return { ok: false, summary: `MCP ${serverName}.${toolName} failed: ${trimText(String(err), 800)}` };
    }
  }

  private async getSession(name: string, provided?: McpServerConfig): Promise<McpSession> {
    const live = this.sessions.get(name);
    if (live && !live.child.killed) return live;
    const server = provided || (await this.listServers()).find((s) => s.name === name);
    if (!server) throw new Error(`MCP server not found: ${name}`);
    const session = await this.startSession(server);
    this.sessions.set(name, session);
    return session;
  }

  private async startSession(server: McpServerConfig): Promise<McpSession> {
    const root = this.paths.workspaceRoot();
    const cwd = server.cwd ? (path.isAbsolute(server.cwd) ? server.cwd : root ? path.join(root, server.cwd) : server.cwd) : root || process.cwd();
    const child = spawn(server.command, server.args || [], {
      cwd,
      env: { ...process.env, ...(server.env || {}) },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const session: McpSession = {
      config: server,
      child,
      status: "starting",
      startedAt: Date.now(),
      seq: 1,
      buffer: "",
      pending: new Map()
    };

    child.stdout.on("data", (chunk) => this.onStdout(session, chunk.toString()));
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) session.lastError = trimText(text, 1000);
    });
    child.on("exit", () => {
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP session exited: ${server.name}`));
      }
      session.pending.clear();
      if (this.sessions.get(server.name) === session) this.sessions.delete(server.name);
      void this.persistDisconnected(server.name, session.lastError);
    });
    child.on("error", (err) => {
      session.lastError = String(err);
      session.status = "error";
      void this.persistState(server.name, session);
    });

    try {
      await this.sendRequest(session, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "my-ai-extension-v7", version: "0.7.0" }
      }, Math.max(2000, server.timeoutMs || 12000));
      this.sendNotification(session, "notifications/initialized", {});
      session.status = "ready";
      await this.persistState(server.name, session);
      return session;
    } catch (err) {
      session.status = "error";
      session.lastError = String(err);
      await this.persistState(server.name, session);
      throw err;
    }
  }

  private onStdout(session: McpSession, chunk: string): void {
    session.buffer += chunk;
    while (true) {
      const headerEnd = session.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = session.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        session.buffer = session.buffer.slice(headerEnd + 4);
        continue;
      }
      const bodyLength = Number(match[1]);
      const totalLength = headerEnd + 4 + bodyLength;
      if (session.buffer.length < totalLength) return;
      const body = session.buffer.slice(headerEnd + 4, totalLength);
      session.buffer = session.buffer.slice(totalLength);
      try {
        const parsed = JSON.parse(body) as McpJsonRpcMessage;
        if (typeof parsed.id === "number") {
          const pending = session.pending.get(parsed.id);
          if (pending) {
            clearTimeout(pending.timer);
            session.pending.delete(parsed.id);
            if (parsed.error) pending.reject(new Error(JSON.stringify(parsed.error)));
            else pending.resolve(parsed.result);
          }
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }

  private async sendRequest(session: McpSession, method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = session.seq++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const raw = JSON.stringify(payload);
    const message = `Content-Length: ${Buffer.byteLength(raw, "utf8")}\r\n\r\n${raw}`;
    const actualTimeout = timeoutMs || Math.max(2000, session.config.timeoutMs || 12000);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`Timed out waiting for MCP response from ${session.config.name}`));
      }, actualTimeout);
      session.pending.set(id, { resolve, reject, timer });
      session.child.stdin.write(message, "utf8", (err) => {
        if (err) {
          clearTimeout(timer);
          session.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private sendNotification(session: McpSession, method: string, params: unknown): void {
    const payload = { jsonrpc: "2.0", method, params };
    const raw = JSON.stringify(payload);
    const message = `Content-Length: ${Buffer.byteLength(raw, "utf8")}\r\n\r\n${raw}`;
    try {
      session.child.stdin.write(message, "utf8");
    } catch {
      // ignore
    }
  }

  private async persistState(name: string, session: McpSession): Promise<void> {
    this.persisted.set(name, {
      name,
      status: session.status,
      lastStartedAt: session.startedAt,
      lastError: session.lastError,
      toolCount: session.toolsCache?.tools.length
    });
    this.schedulePersistFlush();
  }

  private async persistDisconnected(name: string, lastError?: string): Promise<void> {
    this.persisted.set(name, { name, status: "disconnected", lastError });
    this.schedulePersistFlush();
  }

  private schedulePersistFlush(): void {
    this.persistDirty = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      if (this.persistDirty) {
        this.persistDirty = false;
        void this.flushPersist();
      }
    }, McpRegistry.PERSIST_DEBOUNCE_MS);
  }

  private async flushPersist(): Promise<void> {
    if (!vscode.workspace.getConfiguration().get<boolean>("myAi.mcp.persistSessions", true)) return;
    await this.disk.saveMcpSessionStates([...this.persisted.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }
}
