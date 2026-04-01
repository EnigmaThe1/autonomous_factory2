import * as vscode from "vscode";
import { ChatRequest } from "../types";
import { SecretStore } from "../storage/SecretStore";
import { IModelProvider } from "./IModelProvider";
import { fetchWithPolicy } from "./fetchWithPolicy";
import { parseAnthropicSseLines } from "./streamParsers";
import { resolveModelForProvider } from "./providerModelResolution";

export class AnthropicProvider implements IModelProvider {
  readonly id = "anthropic";

  constructor(private readonly secrets: SecretStore) {}

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const cfg = vscode.workspace.getConfiguration();
    const baseUrl = cfg.get<string>("myAi.anthropic.baseUrl", "https://api.anthropic.com/v1").replace(/\/$/, "");
    const apiKey = await this.secrets.get("myAi.anthropic.apiKey");
    const model = resolveModelForProvider(this.id, req.model, (k, d) => cfg.get(k, d));
    if (!apiKey?.trim()) {
      throw new Error(`Missing API key for Anthropic. Open the Providers tab and save your key (secure storage).`);
    }

    const timeoutMs = Math.max(2000, cfg.get<number>("myAi.providers.requestTimeoutMs", 30000));
    const retries = Math.max(0, cfg.get<number>("myAi.providers.maxRetries", 1));
    const retryDelayMs = Math.max(100, cfg.get<number>("myAi.providers.retryDelayMs", 400));

    const res = await fetchWithPolicy(
      `${baseUrl}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          stream: true,
          system: req.system || "You are a helpful coding assistant inside VS Code.",
          messages: buildAnthropicMessages(req)
        })
      },
      { timeoutMs, retries, retryDelayMs, abortSignal: req.signal }
    );

    if (!res.ok || !res.body) throw new Error(`Anthropic request failed: ${res.status} (${baseUrl})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      if (req.signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Request aborted.");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      const parsed = parseAnthropicSseLines(parts);
      for (const chunk of parsed.chunks) yield chunk;
      if (parsed.done) return;
    }
  }
}

function renderUser(req: ChatRequest): string {
  return [
    req.context.workspaceName ? `Workspace: ${req.context.workspaceName}` : "",
    req.context.fileName ? `File: ${req.context.fileName}` : "",
    req.context.selection ? `Selection:\n${req.context.selection}` : "",
    req.context.activeFileText ? `Active file:\n${req.context.activeFileText}` : "",
    req.context.diagnostics?.length ? `Diagnostics:\n${req.context.diagnostics.map((d) => `${d.severity}@${d.line}: ${d.message}`).join("\n")}` : "",
    `User request:\n${req.prompt}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildAnthropicMessages(req: ChatRequest): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = [];
  if (req.history?.length) {
    for (const turn of req.history) {
      msgs.push({ role: turn.role, content: turn.content });
    }
  }
  msgs.push({ role: "user", content: renderUser(req) });
  return msgs;
}
