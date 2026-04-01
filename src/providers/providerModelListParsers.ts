/** OpenAI + OpenAI-compatible `/v1/models` JSON shape. */
export function parseOpenAiStyleModelsList(j: { data?: Array<{ id?: string }> }): string[] {
  return (j.data || []).map((m) => m.id).filter((id): id is string => !!id?.trim());
}

export type OpenAiModelRow = { id: string; created?: number };

/** OpenAI `/v1/models` with optional `created` unix timestamp for ranking. */
export function parseOpenAiStyleModelsWithCreated(j: { data?: Array<{ id?: string; created?: number }> }): OpenAiModelRow[] {
  const rows: OpenAiModelRow[] = [];
  for (const m of j.data || []) {
    const id = m.id?.trim();
    if (!id) continue;
    rows.push({ id, created: typeof m.created === "number" ? m.created : undefined });
  }
  return rows;
}
