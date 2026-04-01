import * as vscode from "vscode";
import * as path from "path";
import { MissionStore } from "../missions/MissionStore";
import { ToolApproval, ToolCall } from "../types";
import { trimText, uid } from "../util";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { ExternalToolAdapterRegistry } from "./ExternalToolAdapterRegistry";
import { McpRegistry } from "./McpRegistry";
import { TrustPolicyEngine } from "../security/TrustPolicyEngine";
import { redactSensitiveObject } from "../security/SecretRedaction";
import { isApplyPatchNoopBecauseReplaceAlreadyPresent } from "./applyPatchNoOpPolicy";

function buildDiffHunks(beforeText: string, afterText: string) {
  const before = beforeText.split(/\r?\n/);
  const after = afterText.split(/\r?\n/);
  const hunks: Array<{ header: string; beforeStart: number; beforeEnd: number; afterStart: number; afterEnd: number; beforeLines: string[]; afterLines: string[] }> = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (before[i] === after[j]) { i += 1; j += 1; continue; }
    const bs = i;
    const as = j;
    const beforeLines: string[] = [];
    const afterLines: string[] = [];
    let guard = 0;
    while ((i < before.length || j < after.length) && guard < 40) {
      if (before[i] === after[j] && beforeLines.length && afterLines.length) break;
      if (i < before.length) beforeLines.push(before[i++]);
      if (j < after.length) afterLines.push(after[j++]);
      guard += 1;
    }
    hunks.push({
      header: `@@ -${bs + 1},${Math.max(1, beforeLines.length)} +${as + 1},${Math.max(1, afterLines.length)} @@`,
      beforeStart: bs + 1,
      beforeEnd: i,
      afterStart: as + 1,
      afterEnd: j,
      beforeLines,
      afterLines
    });
  }
  return hunks.slice(0, 12);
}

function renderHunkSummary(hunks: ReturnType<typeof buildDiffHunks>): string {
  if (!hunks.length) return 'No line-level changes detected.';
  return hunks.map((h) => [h.header, ...h.beforeLines.map((l) => `- ${l}`), ...h.afterLines.map((l) => `+ ${l}`)].join('\n')).join('\n\n');
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  requiresApproval?: ToolApproval;
  blockedByPolicy?: boolean;
  /** applyPatch returned ok without writing (deterministic replace-already-present no-op). */
  applyPatchNoop?: boolean;
}

export const BUILTIN_TOOL_NAMES = [
  "readFile", "writeFile", "applyPatch", "searchFiles",
  "listFiles", "getDiagnostics", "runTerminal", "listTools", "listMcpTools"
] as const;

export class ToolRegistry {
  private cachedPolicyEngine?: TrustPolicyEngine;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly missionStore: MissionStore,
    private readonly disk: DiskMissionPersistence,
    private readonly externalAdapters: ExternalToolAdapterRegistry,
    private readonly mcp: McpRegistry
  ) {}

  private policyEngine(): TrustPolicyEngine {
    if (!this.cachedPolicyEngine) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const cfg = vscode.workspace.getConfiguration();
      this.cachedPolicyEngine = new TrustPolicyEngine(workspaceRoot, {
        allowTerminal: cfg.get<boolean>("myAi.tools.allowTerminal", false),
        requireApprovalForWrite: cfg.get<boolean>("myAi.tools.requireApprovalForWrite", true),
        requireApprovalForInWorkspaceWrites: cfg.get<boolean>("myAi.tools.requireApprovalForInWorkspaceWrites", true),
        requireApprovalForTerminal: cfg.get<boolean>("myAi.tools.requireApprovalForTerminal", true),
        requireApprovalForMcp: cfg.get<boolean>("myAi.tools.requireApprovalForMcp", true),
        requireApprovalForExternal: cfg.get<boolean>("myAi.tools.requireApprovalForExternal", true),
        restrictToWorkspace: cfg.get<boolean>("myAi.tools.restrictToWorkspace", true)
      });
    }
    return this.cachedPolicyEngine;
  }

  /** Invalidate cached policy engine so next call re-reads configuration. */
  invalidatePolicyCache(): void {
    this.cachedPolicyEngine = undefined;
  }

  private policyBlocked(reason: string): ToolResult {
    return { ok: false, summary: reason, blockedByPolicy: true };
  }

  private resolveWorkspacePath(inputPath: string): string {
    if (path.isAbsolute(inputPath)) return inputPath;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.join(root, inputPath) : path.resolve(inputPath);
  }

  private readonly builtinDispatch: Record<string, (missionId: string, call: ToolCall) => Promise<ToolResult>> = {
    readFile: (mid, c) => this.readFile(mid, String(c.args.path || "")),
    writeFile: (mid, c) => this.writeFile(mid, String(c.args.path || ""), String(c.args.content || ""), Boolean(c.args.__approved)),
    applyPatch: (mid, c) => this.applyPatch(mid, String(c.args.path || ""), String(c.args.search || ""), String(c.args.replace || ""), Boolean(c.args.__approved)),
    searchFiles: (mid, c) => this.searchFiles(mid, String(c.args.glob || "**/*"), String(c.args.query || "")),
    listFiles: (mid, c) => this.listFiles(mid, String(c.args.glob || "**/*")),
    getDiagnostics: (mid) => this.getDiagnostics(mid),
    listTools: (mid) => this.listTools(mid),
    listMcpTools: (mid) => this.listMcpTools(mid),
    runTerminal: (mid, c) => this.runTerminal(mid, String(c.args.command || ""), Boolean(c.args.__approved))
  };

  async execute(missionId: string, call: ToolCall): Promise<ToolResult> {
    this.invalidatePolicyCache();

    if (call.tool.startsWith("mcp.")) return this.executeMcp(missionId, call, Boolean(call.args.__approved));
    if (call.tool.startsWith("ext.")) return this.executeExternal(missionId, call, Boolean(call.args.__approved));

    const handler = this.builtinDispatch[call.tool];
    if (handler) return handler(missionId, call);
    return { ok: false, summary: `Unknown tool: ${call.tool}` };
  }

  async showApprovalDiff(approvalId: string, diffPreview: ToolApproval["diffPreview"]): Promise<void> {
    if (!diffPreview?.previewBeforeUri || !diffPreview.previewAfterUri) return;
    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.file(diffPreview.previewBeforeUri),
      vscode.Uri.file(diffPreview.previewAfterUri),
      diffPreview.targetPath ? `Approval diff • ${diffPreview.targetPath}` : `Approval diff • ${approvalId}`
    );
  }


  async showApprovalHunks(approvalId: string, diffPreview: ToolApproval["diffPreview"]): Promise<void> {
    const hunks = diffPreview?.hunks || [];
    const content = [
      `# Pending change hunks`,
      '',
      `Approval: ${approvalId}`,
      diffPreview?.targetPath ? `Target: ${diffPreview.targetPath}` : '',
      '',
      renderHunkSummary(hunks)
    ].filter(Boolean).join("\n");
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  async showApprovalHunkAtIndex(approvalId: string, diffPreview: ToolApproval["diffPreview"], index: number): Promise<void> {
    const hunks = diffPreview?.hunks || [];
    if (!hunks.length) {
      return this.showApprovalHunks(approvalId, diffPreview);
    }
    const clamped = Math.max(0, Math.min(index, hunks.length - 1));
    const h = hunks[clamped];
    const content = [
      `# Pending change hunk ${clamped + 1} / ${hunks.length}`,
      '',
      `Approval: ${approvalId}`,
      diffPreview?.targetPath ? `Target: ${diffPreview.targetPath}` : '',
      '',
      h.header,
      '',
      ...h.beforeLines.map((l) => `- ${l}`),
      ...h.afterLines.map((l) => `+ ${l}`)
    ].filter(Boolean).join("\n");
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc, { preview: false });
  }


  private async listMcpTools(missionId: string): Promise<ToolResult> {
    const tools = await this.mcp.listTools();
    if (missionId !== "__system__") {
      await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:listMcpTools", message: `Listed ${tools.length} MCP tools` });
    }
    return { ok: true, summary: `Listed ${tools.length} MCP tools.`, data: tools };
  }

  private async executeMcp(missionId: string, call: ToolCall, approved: boolean): Promise<ToolResult> {
    const decision = this.policyEngine().decide({ action: "call_mcp" });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    if (decision.requiresApproval && !approved) {
      const sanitizedArgs = redactSensitiveObject(call.args || {});
      return {
        ok: false,
        summary: `Approval required before MCP call ${call.tool}`,
        requiresApproval: {
          kind: "external_tool",
          title: `Call MCP tool ${call.tool}`,
          details: trimText(JSON.stringify(sanitizedArgs, null, 2), 1600)
        }
      };
    }
    const result = await this.mcp.execute(call);
    await this.missionStore.saveEvent(missionId, {
      level: result.ok ? "info" : "warn",
      source: `tool:${call.tool}`,
      message: result.summary,
      data: result.data !== undefined ? redactSensitiveObject(result.data) : undefined
    });
    return result;
  }

  private async executeExternal(missionId: string, call: ToolCall, approved: boolean): Promise<ToolResult> {
    const adapterName = call.tool.replace(/^ext\./, "");
    const adapter = await this.externalAdapters.get(adapterName);
    if (!adapter) return { ok: false, summary: `External adapter not found: ${adapterName}` };

    const decision = this.policyEngine().decide({ action: "call_external", mutating: Boolean(adapter.mutating) });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    if (decision.requiresApproval && !approved) {
      const sanitizedAdapter = redactSensitiveObject(adapter);
      const sanitizedArgs = redactSensitiveObject(call.args);
      return {
        ok: false,
        summary: `Approval required before external adapter ${adapterName}`,
        requiresApproval: {
          kind: "external_tool",
          title: `Call external adapter ${adapterName}`,
          details: trimText(JSON.stringify({ adapter: sanitizedAdapter, args: sanitizedArgs }, null, 2), 1600)
        }
      };
    }

    const result = await this.externalAdapters.execute(call, missionId);
    await this.missionStore.saveEvent(missionId, {
      level: result.ok ? "info" : "warn",
      source: `tool:${call.tool}`,
      message: result.summary,
      data: result.data !== undefined ? redactSensitiveObject(result.data) : undefined
    });
    return { ok: result.ok, summary: result.summary, data: result.data };
  }

  private async listTools(missionId: string): Promise<ToolResult> {
    const external = await this.externalAdapters.list();
    const builtins = [...BUILTIN_TOOL_NAMES];
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:listTools", message: "Listed built-in and external tools" });
    return { ok: true, summary: `Listed ${builtins.length + external.length} tools.`, data: { builtins, external } };
  }

  private async readFile(missionId: string, fsPath: string): Promise<ToolResult> {
    const resolvedPath = this.resolveWorkspacePath(fsPath);
    const decision = this.policyEngine().decide({ action: "read_file", targetPath: resolvedPath });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(resolvedPath));
    const text = Buffer.from(bytes).toString("utf8");
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:readFile", message: resolvedPath });
    return { ok: true, summary: `Read ${resolvedPath}`, data: trimText(text, 30000) };
  }

  private async buildFileApprovalResult(
    kind: ToolApproval["kind"],
    title: string,
    resolvedPath: string,
    beforeText: string,
    afterText: string,
    detailsText: string
  ): Promise<ToolResult> {
    const hunks = buildDiffHunks(beforeText, afterText);
    const preview = await this.disk.writeApprovalPreview(uid("preview"), beforeText, afterText);
    return {
      ok: false,
      summary: `Approval required before ${title.toLowerCase()}`,
      requiresApproval: {
        kind,
        title,
        details: detailsText + "\n\n" + trimText(renderHunkSummary(hunks), 1200),
        diffPreview: {
          targetPath: resolvedPath,
          beforeText: trimText(beforeText, 1200),
          afterText: trimText(afterText, 1200),
          previewBeforeUri: preview?.before.fsPath,
          previewAfterUri: preview?.after.fsPath,
          hunks
        }
      }
    };
  }

  private async writeFile(missionId: string, fsPath: string, content: string, approved: boolean): Promise<ToolResult> {
    const resolvedPath = this.resolveWorkspacePath(fsPath);
    const decision = this.policyEngine().decide({ action: "write_file", targetPath: resolvedPath });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    const uri = vscode.Uri.file(resolvedPath);
    let beforeText = "";
    try {
      beforeText = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    } catch {
      beforeText = "";
    }
    if (decision.requiresApproval && !approved) {
      return this.buildFileApprovalResult(
        "write_file",
        `Write file ${resolvedPath}`,
        resolvedPath,
        beforeText,
        content,
        trimText(content, 1200)
      );
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:writeFile", message: resolvedPath });
    return { ok: true, summary: `Wrote ${resolvedPath}` };
  }

  private async applyPatch(missionId: string, fsPath: string, search: string, replace: string, approved: boolean): Promise<ToolResult> {
    const resolvedPath = this.resolveWorkspacePath(fsPath);
    const decision = this.policyEngine().decide({ action: "apply_patch", targetPath: resolvedPath });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    const uri = vscode.Uri.file(resolvedPath);
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const updated = text.replace(search, replace);
    if (updated === text) {
      if (isApplyPatchNoopBecauseReplaceAlreadyPresent(text, search, replace)) {
        return {
          ok: true,
          summary: `No-op: search text not found but replace content already present in ${resolvedPath}`,
          applyPatchNoop: true
        };
      }
      return { ok: false, summary: `Search text not found in ${resolvedPath}` };
    }
    if (decision.requiresApproval && !approved) {
      const patchDetails = ["Path: " + resolvedPath, "", "SEARCH:", trimText(search, 600), "", "REPLACE:", trimText(replace, 600)].join("\n");
      return this.buildFileApprovalResult("apply_patch", `Apply patch to ${resolvedPath}`, resolvedPath, text, updated, patchDetails);
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, "utf8"));
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:applyPatch", message: resolvedPath });
    return { ok: true, summary: `Patched ${resolvedPath}` };
  }

  private async searchFiles(missionId: string, glob: string, query: string): Promise<ToolResult> {
    const files = await vscode.workspace.findFiles(glob, "**/node_modules/**", 200);
    const matches: Array<{ file: string; lines: string[] }> = [];
    for (const file of files) {
      const text = Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8");
      if (!text.includes(query)) continue;
      matches.push({
        file: file.fsPath,
        lines: text.split(/\r?\n/).filter((line) => line.includes(query)).slice(0, 8)
      });
      if (matches.length >= 25) break;
    }
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:searchFiles", message: `glob=${glob} query=${query}` });
    return { ok: true, summary: `Found ${matches.length} matching files.`, data: matches };
  }

  private async listFiles(missionId: string, glob: string): Promise<ToolResult> {
    const files = await vscode.workspace.findFiles(glob, "**/node_modules/**", 300);
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:listFiles", message: `glob=${glob}` });
    return { ok: true, summary: `Listed ${files.length} files.`, data: files.map((f) => f.fsPath) };
  }

  private async getDiagnostics(missionId: string): Promise<ToolResult> {
    const all = vscode.languages.getDiagnostics().map(([uri, diags]) => ({
      file: uri.fsPath,
      diagnostics: diags.map((d) => ({
        message: d.message,
        line: d.range.start.line,
        severity: String(d.severity)
      }))
    }));
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:getDiagnostics", message: "Collected diagnostics" });
    return { ok: true, summary: `Collected diagnostics for ${all.length} files.`, data: all };
  }

  private async runTerminal(missionId: string, command: string, approved: boolean): Promise<ToolResult> {
    const decision = this.policyEngine().decide({ action: "run_terminal" });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    if (decision.requiresApproval && !approved) {
      return {
        ok: false,
        summary: "Approval required before terminal execution.",
        requiresApproval: {
          kind: "terminal",
          title: "Run terminal command",
          details: command
        }
      };
    }
    const terminal = vscode.window.createTerminal({ name: `My AI ${uid("term")}` });
    terminal.show(true);
    terminal.sendText(command, true);
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:runTerminal", message: command });
    return { ok: true, summary: `Sent command to terminal: ${command}` };
  }
}
