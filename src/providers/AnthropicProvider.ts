import * as vscode from "vscode";
import { ChatRequest } from "../types";
import { SecretStore } from "../storage/SecretStore";
import { IModelProvider } from "./IModelProvider";
import { fetchWithPolicy } from "./fetchWithPolicy";
import { parseAnthropicSseLines } from "./streamParsers";
import { resolveModelForProvider } from "./providerModelResolution";
import { readStreamChunks } from "./providerStreamReader";
import { formatProviderHttpError } from "./providerHttpErrors";
import { anthropicMessagesFromChatRequest } from "./anthropicMessages";

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
          messages: anthropicMessagesFromChatRequest(req)
        })
      },
      { timeoutMs, retries, retryDelayMs, abortSignal: req.signal }
    );

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(
        formatProviderHttpError({
          providerLabel: "Anthropic",
          operation: "Chat stream",
          status: res.status,
          endpoint: baseUrl,
          providerDetail: parseAnthropicErrorDetail(bodyText)
        })
      );
    }
    if (!res.body) throw new Error(`Anthropic chat stream missing response body (${baseUrl})`);

    yield* readStreamChunks(res.body, req.signal, parseAnthropicSseLines);
  }
}

function parseAnthropicErrorDetail(bodyText: string): string | undefined {
  const t = bodyText.trim();
  if (!t) return undefined;
  try {
    const j = JSON.parse(t) as { error?: { message?: string; type?: string } };
    const msg = j.error?.message?.trim();
    if (msg) return msg;
    const typ = j.error?.type?.trim();
    if (typ) return typ;
  } catch {
    /* ignore */
  }
  if (t.length <= 280) return t;
  return `${t.slice(0, 277)}…`;
}
