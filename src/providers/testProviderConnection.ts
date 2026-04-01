import * as vscode from "vscode";
import { SecretStore } from "../storage/SecretStore";
import { fetchWithPolicy } from "./fetchWithPolicy";
import { resolveModelForProvider } from "./providerModelResolution";
import { ProviderRegistry } from "./ProviderRegistry";

function policyFromConfig(): { timeoutMs: number; retries: number; retryDelayMs: number } {
  const cfg = vscode.workspace.getConfiguration();
  return {
    timeoutMs: Math.max(2000, cfg.get<number>("myAi.providers.requestTimeoutMs", 30000)),
    retries: 0,
    retryDelayMs: Math.max(100, cfg.get<number>("myAi.providers.retryDelayMs", 400))
  };
}

/**
 * Lightweight connectivity checks. Does not log secrets.
 * Anthropic path uses a minimal non-streaming Messages call (may incur trivial usage).
 */
export async function testProviderConnection(secrets: SecretStore, _registry: ProviderRegistry, providerId: string): Promise<{ ok: boolean; message: string }> {
  const cfg = vscode.workspace.getConfiguration();
  const policy = policyFromConfig();

  switch (providerId) {
    case "ollama": {
      const base = cfg.get<string>("myAi.ollama.baseUrl", "http://127.0.0.1:11434").replace(/\/$/, "");
      try {
        const res = await fetchWithPolicy(`${base}/api/tags`, { method: "GET" }, policy);
        if (!res.ok) return { ok: false, message: `Ollama unreachable (HTTP ${res.status}). Check base URL in Providers.` };
        const j = (await res.json().catch(() => ({}))) as { models?: unknown[] };
        const n = Array.isArray(j.models) ? j.models.length : 0;
        return { ok: true, message: `Ollama OK — ${n} model tag(s) at ${base}.` };
      } catch (e) {
        return { ok: false, message: `Ollama error: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    case "openai": {
      const key = await secrets.get("myAi.openai.apiKey");
      if (!key?.trim()) return { ok: false, message: "OpenAI API key is not configured. Use the Providers tab." };
      const base = cfg.get<string>("myAi.openai.baseUrl", "https://api.openai.com/v1").replace(/\/$/, "");
      try {
        const res = await fetchWithPolicy(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } }, policy);
        if (!res.ok) return { ok: false, message: `OpenAI check failed: HTTP ${res.status}. Verify key and base URL.` };
        return { ok: true, message: "OpenAI OK — credentials accepted." };
      } catch (e) {
        return { ok: false, message: `OpenAI error: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    case "openai-compat": {
      const base = cfg.get<string>("myAi.openaiCompat.baseUrl", "http://127.0.0.1:8000/v1").replace(/\/$/, "");
      const key = await secrets.get("myAi.openaiCompat.apiKey");
      const headers: Record<string, string> = {};
      if (key?.trim()) headers.Authorization = `Bearer ${key}`;
      try {
        const res = await fetchWithPolicy(`${base}/models`, { headers }, policy);
        if (!res.ok) return { ok: false, message: `OpenAI-compatible endpoint check failed: HTTP ${res.status}.` };
        return { ok: true, message: `OpenAI-compatible OK — ${base}/models reachable.` };
      } catch (e) {
        return { ok: false, message: `OpenAI-compatible error: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    case "anthropic": {
      const key = await secrets.get("myAi.anthropic.apiKey");
      if (!key?.trim()) return { ok: false, message: "Anthropic API key is not configured. Use the Providers tab." };
      const base = cfg.get<string>("myAi.anthropic.baseUrl", "https://api.anthropic.com/v1").replace(/\/$/, "");
      const model = resolveModelForProvider("anthropic", undefined, (k, d) => cfg.get(k, d));
      try {
        const res = await fetchWithPolicy(
          `${base}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model,
              max_tokens: 1,
              stream: false,
              messages: [{ role: "user", content: "ping" }]
            })
          },
          policy
        );
        if (!res.ok) return { ok: false, message: `Anthropic check failed: HTTP ${res.status}. Verify model id and key.` };
        return { ok: true, message: "Anthropic OK — minimal message accepted." };
      } catch (e) {
        return { ok: false, message: `Anthropic error: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    case "gemini": {
      const key = await secrets.get("myAi.gemini.apiKey");
      if (!key?.trim()) return { ok: false, message: "Gemini API key is not configured. Use the Providers tab." };
      const root = cfg.get<string>("myAi.gemini.baseUrl", "https://generativelanguage.googleapis.com").replace(/\/$/, "");
      try {
        const res = await fetchWithPolicy(
          `${root}/v1beta/models`,
          { headers: { "x-goog-api-key": key } },
          policy
        );
        if (!res.ok) return { ok: false, message: `Gemini check failed: HTTP ${res.status}. Verify API key.` };
        return { ok: true, message: "Gemini OK — models listing accepted." };
      } catch (e) {
        return { ok: false, message: `Gemini error: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    case "vscode-lm": {
      try {
        const vscodeAny = await import("vscode") as any;
        if (!vscodeAny.lm?.selectChatModels) {
          return { ok: false, message: "VS Code Language Model API is not available in this environment." };
        }
        const models = await vscodeAny.lm.selectChatModels();
        const n = Array.isArray(models) ? models.length : 0;
        if (!n) return { ok: false, message: "No VS Code chat models reported. Install/enable Copilot or another LM provider." };
        return { ok: true, message: `VS Code LM OK — ${n} model(s) available.` };
      } catch (e) {
        return { ok: false, message: `VS Code LM error: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    default:
      if (!_registry.list().includes(providerId)) return { ok: false, message: `Unknown provider: ${providerId}` };
      return { ok: true, message: "No automated connection test for this provider." };
  }
}
