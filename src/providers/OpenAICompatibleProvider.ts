import * as vscode from "vscode";
import { ChatRequest } from "../types";
import { SecretStore } from "../storage/SecretStore";
import { IModelProvider } from "./IModelProvider";
import { fetchWithPolicy } from "./fetchWithPolicy";
import { parseOpenAiSseLines } from "./streamParsers";
import { resolveModelForProvider } from "./providerModelResolution";

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

    if (!res.ok || !res.body) throw new Error(`OpenAI-compatible request failed: ${res.status} (${baseUrl})`);

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
      const parsed = parseOpenAiSseLines(parts);
      for (const chunk of parsed.chunks) yield chunk;
      if (parsed.done) return;
    }
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
    if (!res.ok) throw new Error(`Embedding request failed (${res.status})`);
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return (json.data || []).map((d) => d.embedding);
  }
}

function renderContext(req: ChatRequest): string {
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

function buildMessages(req: ChatRequest): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = [
    { role: "system", content: req.system || "You are a helpful coding assistant inside VS Code." }
  ];
  if (req.history?.length) {
    for (const turn of req.history) {
      msgs.push({ role: turn.role, content: turn.content });
    }
  }
  msgs.push({ role: "user", content: renderContext(req) });
  return msgs;
}
