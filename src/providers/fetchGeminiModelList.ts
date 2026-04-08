import { fetchWithPolicy } from "./fetchWithPolicy";
import { formatModelListHttpHint } from "./providerHttpErrors";
import { PROVIDER_MODEL_PRESETS } from "./providerModelResolution";
import { geminiCatalogIdsFromListModels, type GeminiModelRecord } from "./geminiModelCatalogParse";
import type { ModelListResult, ModelListSource } from "./fetchProviderModelList";

type GeminiListModelsResponse = {
  models?: GeminiModelRecord[];
  nextPageToken?: string;
};

const GEMINI_LIST_MAX_PAGES = 25;
const GEMINI_CATALOG_CAP = 800;

export async function fetchGeminiModelListResult(
  root: string,
  key: string,
  policy: { timeoutMs: number; retries: number; retryDelayMs: number },
  finalize: (providerId: string, ids: string[], source: ModelListSource, hint: string) => ModelListResult
): Promise<ModelListResult> {
  const headers = { "x-goog-api-key": key };
  const merged: GeminiModelRecord[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const url = new URL(`${root}/v1beta/models`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetchWithPolicy(url.toString(), { headers }, policy);
    if (!res.ok) {
      return finalize(
        "gemini",
        [...(PROVIDER_MODEL_PRESETS.gemini || [])],
        "fallback",
        `${formatModelListHttpHint("Gemini", res.status, `${root}/v1beta/models`)} Curated list.`
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
