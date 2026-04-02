import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { redactSensitiveObject } from "../security/SecretRedaction";
import type { TraceLevel, TraceRecord } from "./traceTypes";
import type { TraceLogInput } from "./traceTypes";
import { traceLevelPassesFilter } from "./traceLevel";
import { parseTraceLevel } from "./traceLevel";
import { normalizeWebviewTracePayload } from "./tracePayload";

const CHANNEL_NAME = "Autonomous Factory Trace";
const CONFIG_SECTION = "myAi.trace";
const DEFAULT_BUFFER = 5000;

function readConfigLevel(): TraceLevel {
  const raw = vscode.workspace.getConfiguration().get<string>(`${CONFIG_SECTION}.level`, "info");
  return parseTraceLevel(raw) ?? "info";
}

function readPersist(): boolean {
  return vscode.workspace.getConfiguration().get<boolean>(`${CONFIG_SECTION}.persistToFile`, false);
}

function summarizeForLevel(configLevel: TraceLevel, data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  if (configLevel === "trace") return data;
  const maxKeys = configLevel === "debug" ? 24 : 12;
  const keys = Object.keys(data);
  if (keys.length <= maxKeys) return data;
  const slim: Record<string, unknown> = {};
  for (const k of keys.slice(0, maxKeys)) slim[k] = data[k];
  slim._truncated = `+${keys.length - maxKeys} keys`;
  return slim;
}

export class ExtensionTraceLogger {
  private seq = 0;
  private readonly buffer: TraceRecord[] = [];
  private readonly maxBuffer: number;
  readonly output: vscode.OutputChannel;
  readonly sessionId: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    sessionId: string,
    maxBuffer: number = DEFAULT_BUFFER
  ) {
    this.sessionId = sessionId;
    this.maxBuffer = maxBuffer;
    this.output = vscode.window.createOutputChannel(CHANNEL_NAME);
    context.subscriptions.push(this.output);
  }

  getConfiguredLevel(): TraceLevel {
    return readConfigLevel();
  }

  setConfiguredLevel(level: TraceLevel): Thenable<void> {
    return vscode.workspace.getConfiguration().update(`${CONFIG_SECTION}.level`, level, vscode.ConfigurationTarget.Global);
  }

  show(): void {
    this.output.show(true);
  }

  clear(): void {
    this.buffer.length = 0;
    this.output.clear();
  }

  getBufferSnapshot(): readonly TraceRecord[] {
    return [...this.buffer];
  }

  log(input: TraceLogInput): void {
    const configLevel = readConfigLevel();
    const level = input.level;
    if (!traceLevelPassesFilter(configLevel, level)) return;

    this.seq += 1;
    const ts = input.ts ?? new Date().toISOString();
    const dataRaw = input.data ? (redactSensitiveObject(input.data) as Record<string, unknown>) : undefined;
    const data = summarizeForLevel(configLevel, dataRaw);

    const record: TraceRecord = {
      ts,
      seq: this.seq,
      level,
      side: input.side,
      sessionId: input.sessionId || this.sessionId,
      interactionId: input.interactionId,
      category: input.category,
      event: input.event,
      activeTab: input.activeTab,
      messageType: input.messageType,
      ok: input.ok,
      data
    };

    const line = JSON.stringify(record);
    this.output.appendLine(line);
    this.pushBuffer(record);
    void this.maybeAppendFile(line);
  }

  ingestWebviewPayload(raw: unknown): { ok: true } | { ok: false; reason: string } {
    const normalized = normalizeWebviewTracePayload(raw, this.sessionId);
    if (!normalized.ok) return normalized;
    const { record } = normalized;
    this.log({
      ...record,
      sessionId: record.sessionId
    });
    return { ok: true };
  }

  async exportBufferToFile(): Promise<string> {
    const dir = path.join(this.context.globalStorageUri.fsPath, "trace");
    await fs.mkdir(dir, { recursive: true });
    const name = `my-ai-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
    const fp = path.join(dir, name);
    const body = this.buffer.map((r) => JSON.stringify(r)).join("\n") + (this.buffer.length ? "\n" : "");
    await fs.writeFile(fp, body, "utf8");
    return fp;
  }

  private pushBuffer(record: TraceRecord): void {
    this.buffer.push(record);
    while (this.buffer.length > this.maxBuffer) this.buffer.shift();
  }

  private async maybeAppendFile(line: string): Promise<void> {
    if (!readPersist()) return;
    try {
      const dir = path.join(this.context.globalStorageUri.fsPath, "trace");
      await fs.mkdir(dir, { recursive: true });
      const fp = path.join(dir, "my-ai-trace-append.jsonl");
      await fs.appendFile(fp, line + "\n", "utf8");
    } catch {
      /* avoid throwing from trace path */
    }
  }
}
