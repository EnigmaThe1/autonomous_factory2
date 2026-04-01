import * as vscode from "vscode";
import { ChatRequest } from "../types";
import { SecretStore } from "../storage/SecretStore";
import { IModelProvider } from "./IModelProvider";
import { fetchWithPolicy } from "./fetchWithPolicy";
import { parseGeminiSseLines } from "./streamParsers";
import { resolveModelForProvider } from "./providerModelResolution";
import { renderChatContext } from "./providerContextRender";
import { readStreamChunks } from "./providerStreamReader";

export class GeminiProvider implements IModelProvider {
  readonly id = "gemini";

  constructor(private readonly secrets: SecretStore) {}

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const cfg = vscode.workspace.getConfiguration();
    const root = cfg.get<string>("myAi.gemini.baseUrl", "https://generativelanguage.googleapis.com").replace(/\/$/, "");
    const apiKey = await this.secrets.get("myAi.gemini.apiKey");
    const model = resolveModelForProvider(this.id, req.model, (k, d) => cfg.get(k, d));
    if (!apiKey?.trim()) {
      throw new Error(`Missing API key for Gemini. Open the Providers tab and save your key (secure storage).`);
    }

    const timeoutMs = Math.max(2000, cfg.get<number>("myAi.providers.requestTimeoutMs", 30000));
    const retries = Math.max(0, cfg.get<number>("myAi.providers.maxRetries", 1));
    const retryDelayMs = Math.max(100, cfg.get<number>("myAi.providers.retryDelayMs", 400));

    const systemPrefix = req.system ? `System:\n${req.system}\n\n` : "";
    const text = systemPrefix + renderChatContext(req, "\n");

    const url = `${root}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const res = await fetchWithPolicy(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: buildGeminiContents(req, text)
        })
      },
      { timeoutMs, retries, retryDelayMs, abortSignal: req.signal }
    );

    if (!res.ok || !res.body) throw new Error(`Gemini request failed: ${res.status} (${root})`);

    yield* readStreamChunks(res.body, req.signal, parseGeminiSseLines);
  }
}

function buildGeminiContents(
  req: ChatRequest,
  currentText: string
): Array<{ role: string; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  if (req.history?.length) {
    for (const turn of req.history) {
      contents.push({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.content }] });
    }
  }
  contents.push({ role: "user", parts: [{ text: currentText }] });
  return contents;
}
