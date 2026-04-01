import * as vscode from "vscode";
import { ChatRequest } from "../types";
import { SecretStore } from "../storage/SecretStore";
import { IModelProvider } from "./IModelProvider";
import { fetchWithPolicy } from "./fetchWithPolicy";
import { parseAnthropicSseLines } from "./streamParsers";
import { resolveModelForProvider } from "./providerModelResolution";
import { renderChatContext } from "./providerContextRender";
import { readStreamChunks } from "./providerStreamReader";

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

    yield* readStreamChunks(res.body, req.signal, parseAnthropicSseLines);
  }
}

function buildAnthropicMessages(req: ChatRequest): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = [];
  if (req.history?.length) {
    for (const turn of req.history) {
      msgs.push({ role: turn.role, content: turn.content });
    }
  }
  msgs.push({ role: "user", content: renderChatContext(req) });
  return msgs;
}
