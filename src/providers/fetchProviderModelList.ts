import * as vscode from "vscode";
import { SecretStore } from "../storage/SecretStore";
import { fetchWithPolicy } from "./fetchWithPolicy";
import { PROVIDER_MODEL_PRESETS } from "./providerModelResolution";
import { parseOpenAiStyleModelsWithCreated } from "./providerModelListParsers";
import { geminiCatalogIdsFromListModels, type GeminiModelRecord } from "./geminiModelCatalogParse";
import { rankFullAndShortlist, type RankCatalogOpts } from "./modelCatalogRank";

/** `cache` is used only when the host reapplies a persisted snapshot (not returned from `fetchProviderModelList`). */
export type ModelListSource = "live" | "fallback" | "environment" | "unavailable" | "cache";

export interface ModelListResult {
  /** Full normalized catalog, newest / most relevant first. */
  models: string[];
  /** Bounded shortlist for pickers (subset of `models`). */
  displayShortlist: string[];
  source: ModelListSource;
  hint?: string;
}

function policy(): { timeoutMs: number; retries: number; retryDelayMs: number } {
  const cfg = vscode.workspace.getConfiguration();
  return {
    timeoutMs: Math.max(2000, cfg.get<number>("myAi.providers.requestTimeoutMs", 30000)),
    retries: 0,
    retryDelayMs: Math.max(100, cfg.get<number>("myAi.providers.retryDelayMs", 400))
  };
}

function finalize(
  providerId: string,
  ids: string[],
  source: ModelListSource,
  hint: string,
  rankOpts?: RankCatalogOpts
): ModelListResult {
  const { modelsAll, displayShortlist } = rankFullAndShortlist(providerId, ids, rankOpts);
  return { models: modelsAll, displayShortlist, source, hint };
}

function gptishPresets(): string[] {
  return [...(PROVIDER_MODEL_PRESETS.openai || [])];
}

function anthropicPresetIds(): string[] {
  return [...(PROVIDER_MODEL_PRESETS.anthropic || [])];
}

function anthropicFromPresets(prefix: string, source: ModelListSource): ModelListResult {
  return finalize("anthropic", anthropicPresetIds(), source, `${prefix} Curated Claude ids (secondary fallback).`);
}

/**
 * Fetches model ids where feasible. Never logs secrets.
 * Always returns `displayShortlist` (bounded) alongside full `models`.
 */
export async function fetchProviderModelList(secrets: SecretStore, providerId: string): Promise<ModelListResult> {
  const cfg = vscode.workspace.getConfiguration();

  switch (providerId) {
    case "anthropic": {
      const key = (await secrets.get("myAi.anthropic.apiKey"))?.trim();
      if (!key) {
        return anthropicFromPresets("No API key.", "fallback");
      }
      const base = cfg.get<string>("myAi.anthropic.baseUrl", "https://api.anthropic.com/v1").replace(/\/$/, "");
      try {
        return await fetchAnthropicModelListLive(base, key);
      } catch (e) {
        return anthropicFromPresets(e instanceof Error ? e.message : String(e), "unavailable");
      }
    }
    case "ollama": {
      const base = cfg.get<string>("myAi.ollama.baseUrl", "http://127.0.0.1:11434").replace(/\/$/, "");
      try {
        const res = await fetchWithPolicy(`${base}/api/tags`, { method: "GET" }, policy());
        if (!res.ok) {
          return finalize(
            "ollama",
            [...(PROVIDER_MODEL_PRESETS.ollama || [])],
            "fallback",
            `Ollama HTTP ${res.status} at ${base}/api/tags; curated presets only (secondary).`
          );
        }
        const j = (await res.json()) as { models?: Array<{ name?: string }> };
        const raw = (j.models || []).map((m) => m.name).filter((n): n is string => !!n?.trim());
        const order: string[] = [];
        const seen = new Set<string>();
        for (const n of raw) {
          const t = n.trim();
          if (!t || seen.has(t)) continue;
          seen.add(t);
          order.push(t);
        }
        return order.length
          ? finalize("ollama", order, "live", `Live Ollama: ${order.length} installed model(s) from ${base}/api/tags.`, {
              apiListOrder: order
            })
          : finalize(
              "ollama",
              [...(PROVIDER_MODEL_PRESETS.ollama || [])],
              "fallback",
              "Ollama returned no models in /api/tags; curated presets only (secondary)."
            );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return finalize(
          "ollama",
          [...(PROVIDER_MODEL_PRESETS.ollama || [])],
          "unavailable",
          `Cannot reach Ollama at ${base} (${msg}). Check myAi.ollama.baseUrl and that the daemon is running.`
        );
      }
    }
    case "openai": {
      const key = (await secrets.get("myAi.openai.apiKey"))?.trim();
      if (!key) {
        return finalize("openai", gptishPresets(), "fallback", "No API key; curated GPT-family list (secondary fallback).");
      }
      const base = cfg.get<string>("myAi.openai.baseUrl", "https://api.openai.com/v1").replace(/\/$/, "");
      try {
        const res = await fetchWithPolicy(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } }, policy());
        if (!res.ok) {
          return finalize("openai", gptishPresets(), "fallback", `OpenAI HTTP ${res.status}; curated list.`);
        }
        const j = (await res.json()) as { data?: Array<{ id?: string; created?: number }> };
        const rows = parseOpenAiStyleModelsWithCreated(j);
        const ids = rows.map((r) => r.id);
        const gpt = ids.filter(
          (id) => /^(gpt-|o\d|chatgpt-|text-embedding-)/i.test(id) || id.toLowerCase().includes("gpt")
        );
        const useIds = gpt.length ? gpt : ids;
        const createdById: Record<string, number> = {};
        for (const r of rows) {
          if (r.created != null && useIds.includes(r.id)) createdById[r.id] = r.created;
        }
        const apiListOrder = [...useIds].sort((a, b) => (createdById[b] ?? 0) - (createdById[a] ?? 0));
        return useIds.length
          ? finalize("openai", useIds, "live", `From ${base}/models (${useIds.length} id(s)).`, {
              createdById,
              apiListOrder
            })
          : finalize("openai", gptishPresets(), "fallback", "No models parsed; curated list.");
      } catch (e) {
        return finalize("openai", gptishPresets(), "unavailable", e instanceof Error ? e.message : String(e));
      }
    }
    case "openai-compat": {
      const base = cfg.get<string>("myAi.openaiCompat.baseUrl", "http://127.0.0.1:8000/v1").replace(/\/$/, "");
      const key = (await secrets.get("myAi.openaiCompat.apiKey"))?.trim();
      const headers: Record<string, string> = {};
      if (key) headers.Authorization = `Bearer ${key}`;
      try {
        const res = await fetchWithPolicy(`${base}/models`, { headers }, policy());
        if (!res.ok) {
          return finalize(
            "openai-compat",
            [...(PROVIDER_MODEL_PRESETS["openai-compat"] || [])],
            "fallback",
            `Endpoint HTTP ${res.status}; curated list.`
          );
        }
        const j = (await res.json()) as { data?: Array<{ id?: string; created?: number }> };
        const rows = parseOpenAiStyleModelsWithCreated(j);
        const ids = rows.map((r) => r.id);
        const createdById: Record<string, number> = {};
        for (const r of rows) {
          if (r.created != null) createdById[r.id] = r.created;
        }
        const apiListOrder = [...ids].sort((a, b) => (createdById[b] ?? 0) - (createdById[a] ?? 0));
        return ids.length
          ? finalize("openai-compat", ids, "live", `From ${base}/models`, { createdById, apiListOrder })
          : finalize(
              "openai-compat",
              [...(PROVIDER_MODEL_PRESETS["openai-compat"] || [])],
              "fallback",
              "Empty /models response."
            );
      } catch (e) {
        return finalize(
          "openai-compat",
          [...(PROVIDER_MODEL_PRESETS["openai-compat"] || [])],
          "unavailable",
          e instanceof Error ? e.message : String(e)
        );
      }
    }
    case "gemini": {
      const key = (await secrets.get("myAi.gemini.apiKey"))?.trim();
      if (!key) {
        return finalize(
          "gemini",
          [...(PROVIDER_MODEL_PRESETS.gemini || [])],
          "fallback",
          "No API key; curated Gemini list (secondary fallback)."
        );
      }
      const root = cfg.get<string>("myAi.gemini.baseUrl", "https://generativelanguage.googleapis.com").replace(/\/$/, "");
      try {
        return await fetchGeminiModelListResult(root, key);
      } catch (e) {
        return finalize(
          "gemini",
          [...(PROVIDER_MODEL_PRESETS.gemini || [])],
          "unavailable",
          e instanceof Error ? e.message : String(e)
        );
      }
    }
    case "vscode-lm": {
      try {
        const vscodeAny = await import("vscode") as any;
        if (!vscodeAny.lm?.selectChatModels) {
          return { models: [], displayShortlist: [], source: "unavailable", hint: "Language Model API not available." };
        }
        const models = await vscodeAny.lm.selectChatModels();
        const raw: string[] = (models || []).map((m: any) =>
          typeof m?.id === "string" ? m.id : typeof m?.name === "string" ? m.name : ""
        );
        const ids = raw.map((x) => x.trim()).filter(Boolean);
        return ids.length
          ? finalize("vscode-lm", [...new Set(ids)], "environment", "From VS Code lm.selectChatModels()")
          : { models: [], displayShortlist: [], source: "unavailable", hint: "No VS Code chat models reported." };
      } catch (e) {
        return {
          models: [],
          displayShortlist: [],
          source: "unavailable",
          hint: e instanceof Error ? e.message : String(e)
        };
      }
    }
    default:
      return { models: [], displayShortlist: [], source: "unavailable", hint: "Unknown provider." };
  }
}

/** One page from `models.list` (Gemini Developer API / Google AI). */
type GeminiListModelsResponse = {
  models?: GeminiModelRecord[];
  nextPageToken?: string;
};

const GEMINI_LIST_MAX_PAGES = 25;
const GEMINI_CATALOG_CAP = 800;

async function fetchGeminiModelListResult(root: string, key: string): Promise<ModelListResult> {
  const pol = policy();
  const headers = { "x-goog-api-key": key };
  const merged: GeminiModelRecord[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const url = new URL(`${root}/v1beta/models`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetchWithPolicy(url.toString(), { headers }, pol);
    if (!res.ok) {
      return finalize(
        "gemini",
        [...(PROVIDER_MODEL_PRESETS.gemini || [])],
        "fallback",
        `Gemini HTTP ${res.status}; curated list.`
      );
    }
    const j = (await res.json()) as GeminiListModelsResponse;
    for (const m of j.models || []) merged.push(m);
    pageToken = j.nextPageToken?.trim() || undefined;
    pages += 1;
    if (pages >= GEMINI_LIST_MAX_PAGES) break;
  } while (pageToken);

  const use = geminiCatalogIdsFromListModels(merged);
  const capped = use.slice(0, GEMINI_CATALOG_CAP);
  const pageHint = pages > 1 ? ` (${pages} API pages)` : "";
  return capped.length
    ? finalize("gemini", capped, "live", `${merged.length} record(s) from ${root}/v1beta/models${pageHint}; ids favor baseModelId + generateContent.`)
    : finalize("gemini", [...(PROVIDER_MODEL_PRESETS.gemini || [])], "fallback", "No Gemini models parsed after list; curated list.");
}

type AnthropicListModelsResponse = {
  data?: Array<{ id?: string; created_at?: string }>;
  has_more?: boolean;
  last_id?: string;
};

const ANTHROPIC_LIST_MAX_PAGES = 50;

async function fetchAnthropicModelListLive(base: string, key: string): Promise<ModelListResult> {
  const merged: { id: string; created_at?: string }[] = [];
  let afterId: string | undefined;
  const pol = policy();

  for (let page = 0; page < ANTHROPIC_LIST_MAX_PAGES; page++) {
    const url = new URL(`${base}/models`);
    url.searchParams.set("limit", "1000");
    if (afterId) url.searchParams.set("after_id", afterId);

    const res = await fetchWithPolicy(
      url.toString(),
      {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01"
        }
      },
      pol
    );

    if (!res.ok) {
      return anthropicFromPresets(`Anthropic HTTP ${res.status}.`, "fallback");
    }

    const j = (await res.json()) as AnthropicListModelsResponse;
    const batch = j.data || [];
    for (const row of batch) {
      const id = row.id?.trim();
      if (id) merged.push({ id, created_at: row.created_at });
    }

    if (!j.has_more) break;
    const next = j.last_id?.trim();
    if (!next || batch.length === 0) break;
    afterId = next;
  }

  const ids = merged.map((m) => m.id);
  if (!ids.length) {
    return anthropicFromPresets("Anthropic returned no models.", "fallback");
  }

  const createdById: Record<string, number> = {};
  for (const m of merged) {
    if (m.created_at) {
      const t = Date.parse(m.created_at);
      if (Number.isFinite(t)) createdById[m.id] = t / 1000;
    }
  }
  const apiListOrder = merged.map((m) => m.id);
  return finalize("anthropic", ids, "live", `From ${base}/models (${ids.length} id(s)).`, { createdById, apiListOrder });
}
