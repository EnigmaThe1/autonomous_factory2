import { fetchWithPolicy } from "./fetchWithPolicy";
import { formatModelListHttpHint } from "./providerHttpErrors";
import type { ModelListResult, ModelListSource } from "./fetchProviderModelList";
import type { RankCatalogOpts } from "./modelCatalogRank";

type AnthropicListModelsResponse = {
  data?: Array<{ id?: string; created_at?: string }>;
  has_more?: boolean;
  last_id?: string;
};

const ANTHROPIC_LIST_MAX_PAGES = 50;

export async function fetchAnthropicModelListLive(
  base: string,
  key: string,
  policy: { timeoutMs: number; retries: number; retryDelayMs: number },
  finalize: (providerId: string, ids: string[], source: ModelListSource, hint: string, rankOpts?: RankCatalogOpts) => ModelListResult,
  fromPresets: (prefix: string, source: ModelListSource) => ModelListResult
): Promise<ModelListResult> {
  const merged: { id: string; created_at?: string }[] = [];
  let afterId: string | undefined;

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
      policy
    );

    if (!res.ok) {
      return fromPresets(formatModelListHttpHint("Anthropic", res.status, `${base}/models`), "fallback");
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
    return fromPresets("Anthropic returned no models.", "fallback");
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
