import * as vscode from "vscode";
import { ChatRequest } from "../types";
import { IModelProvider } from "./IModelProvider";
import { fetchWithPolicy } from "./fetchWithPolicy";
import { parseOllamaNdjsonLines } from "./streamParsers";
import { resolveModelForProvider } from "./providerModelResolution";

export class OllamaProvider implements IModelProvider {
  readonly id = "ollama";

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const cfg = vscode.workspace.getConfiguration();
    const baseUrl = cfg.get<string>("myAi.ollama.baseUrl", "http://127.0.0.1:11434").replace(/\/$/, "");
    const model = resolveModelForProvider(this.id, req.model, (k, d) => cfg.get(k, d));

    const timeoutMs = Math.max(2000, cfg.get<number>("myAi.providers.requestTimeoutMs", 30000));
    const retries = Math.max(0, cfg.get<number>("myAi.providers.maxRetries", 1));
    const retryDelayMs = Math.max(100, cfg.get<number>("myAi.providers.retryDelayMs", 400));
    const useChat = !!req.history?.length;
    const endpoint = useChat ? `${baseUrl}/api/chat` : `${baseUrl}/api/generate`;
    const body = useChat
      ? {
          model,
          stream: true,
          messages: [
            { role: "system", content: req.system || "" },
            ...req.history!.map((h) => ({ role: h.role, content: h.content })),
            { role: "user", content: renderContext(req) }
          ]
        }
      : {
          model,
          prompt: [req.system || "", renderContext(req)].filter(Boolean).join("\n\n"),
          stream: true
        };
    const res = await fetchWithPolicy(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      },
      { timeoutMs, retries, retryDelayMs, abortSignal: req.signal }
    );

    if (!res.ok || !res.body) throw new Error(`Ollama request failed: ${res.status} (${baseUrl})`);

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
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      const parsed = parseOllamaNdjsonLines(lines);
      for (const chunk of parsed.chunks) yield chunk;
    }
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    const cfg = vscode.workspace.getConfiguration();
    const baseUrl = cfg.get<string>("myAi.ollama.baseUrl", "http://127.0.0.1:11434").replace(/\/$/, "");
    const embModel = model || cfg.get<string>("myAi.embeddings.ollamaModel", "nomic-embed-text");
    const results: number[][] = [];
    for (const text of texts) {
      const res = await fetchWithPolicy(
        `${baseUrl}/api/embed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: embModel, input: text })
        },
        { timeoutMs: 15000, retries: 1, retryDelayMs: 300 }
      );
      if (!res.ok) throw new Error(`Ollama embedding failed (${res.status})`);
      const json = (await res.json()) as { embeddings?: number[][] };
      results.push(json.embeddings?.[0] || []);
    }
    return results;
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
