import * as vscode from "vscode";
import { ChatRequest } from "../types";
import { SecretStore } from "../storage/SecretStore";
import { IModelProvider } from "./IModelProvider";
import { fetchWithPolicy } from "./fetchWithPolicy";
import { parseOpenAiSseLines } from "./streamParsers";
import { resolveModelForProvider } from "./providerModelResolution";
import { renderChatContext } from "./providerContextRender";
import { readStreamChunks } from "./providerStreamReader";
import { formatProviderHttpError } from "./providerHttpErrors";

export interface OpenAiCompatSpec {
  id: string;
  secretKey: string;
  baseUrlKey: string;
  defaultBaseUrl: string;
}

export const OPENAI_CLOUD_SPEC: OpenAiCompatSpec = {
  id: "openai",
  secretKey: "myAi.openai.apiKey",
  baseUrlKey: "myAi.openai.baseUrl",
  defaultBaseUrl: "https://api.openai.com/v1"
};

export const OPENAI_COMPAT_LOCAL_SPEC: OpenAiCompatSpec = {
  id: "openai-compat",
  secretKey: "myAi.openaiCompat.apiKey",
  baseUrlKey: "myAi.openaiCompat.baseUrl",
  defaultBaseUrl: "http://127.0.0.1:8000/v1"
};

export class OpenAICompatibleProvider implements IModelProvider {
  readonly id: string;
  private readonly spec: OpenAiCompatSpec;

  constructor(
    private readonly secrets: SecretStore,
    spec: OpenAiCompatSpec
  ) {
    this.spec = spec;
    this.id = spec.id;
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const cfg = vscode.workspace.getConfiguration();
    const baseUrl = cfg.get<string>(this.spec.baseUrlKey, this.spec.defaultBaseUrl).replace(/\/$/, "");
    const apiKey = await this.secrets.get(this.spec.secretKey);
    const model = resolveModelForProvider(this.id, req.model, (k, d) => cfg.get(k, d));
    if (!apiKey?.trim()) {
      throw new Error(`Missing API key for provider "${this.id}". Open the Providers tab and save your key (secure storage).`);
    }

    const timeoutMs = Math.max(2000, cfg.get<number>("myAi.providers.requestTimeoutMs", 30000));
    const retries = Math.max(0, cfg.get<number>("myAi.providers.maxRetries", 1));
    const retryDelayMs = Math.max(100, cfg.get<number>("myAi.providers.retryDelayMs", 400));
    const res = await fetchWithPolicy(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: buildMessages(req)
        })
      },
      { timeoutMs, retries, retryDelayMs, abortSignal: req.signal }
    );

    if (!res.ok)
      throw new Error(
        formatProviderHttpError({
          providerLabel: "OpenAI-compatible",
          operation: "Chat stream",
          status: res.status,
          endpoint: baseUrl
        })
      );
    if (!res.body) throw new Error(`OpenAI-compatible stream missing response body (${baseUrl})`);

    yield* readStreamChunks(res.body, req.signal, parseOpenAiSseLines);
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    const cfg = vscode.workspace.getConfiguration();
    const baseUrl = cfg.get<string>(this.spec.baseUrlKey, this.spec.defaultBaseUrl).replace(/\/$/, "");
    const apiKey = await this.secrets.get(this.spec.secretKey);
    if (!apiKey?.trim()) throw new Error(`Missing API key for provider "${this.id}" (embedding).`);
    const embModel = model || cfg.get<string>("myAi.embeddings.model", "text-embedding-3-small");
    const res = await fetchWithPolicy(
      `${baseUrl}/embeddings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: embModel, input: texts })
      },
      { timeoutMs: 15000, retries: 1, retryDelayMs: 300 }
    );
    if (!res.ok)
      throw new Error(
        formatProviderHttpError({
          providerLabel: "OpenAI-compatible",
          operation: "Embedding request",
          status: res.status,
          endpoint: baseUrl
        })
      );
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return (json.data || []).map((d) => d.embedding);
  }
}

function buildMessages(req: ChatRequest): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = [
    { role: "system", content: req.system || "You are a helpful coding assistant inside VS Code." }
  ];
  if (req.history?.length) {
    for (const turn of req.history) {
      msgs.push({ role: turn.role, content: turn.content });
    }
  }
  msgs.push({ role: "user", content: renderChatContext(req) });
  return msgs;
}
