/** One model entry from Gemini `models.list` (Developer API / generativelanguage). */
export type GeminiModelRecord = {
  name?: string;
  /** Pass this to `:generateContent` / streaming — preferred over versioned `name`. */
  baseModelId?: string;
  supportedGenerationMethods?: string[];
};

export function shortGeminiIdFromName(name: string | undefined): string {
  if (!name?.trim()) return "";
  const n = name.trim();
  return n.startsWith("models/") ? n.slice("models/".length) : n;
}

/**
 * Build catalog ids from merged `models.list` pages.
 * - Prefer `baseModelId` (stable id for API calls).
 * - Keep models that declare `generateContent` when methods are present (skip embed-only, etc.).
 * - If that yields nothing, fall back to legacy name-based heuristic on the same records.
 */
export function geminiCatalogIdsFromListModels(models: GeminiModelRecord[] | undefined): string[] {
  const list = models || [];
  const strict = new Set<string>();
  for (const m of list) {
    const methods = m.supportedGenerationMethods;
    if (Array.isArray(methods) && methods.length > 0 && !methods.includes("generateContent")) {
      continue;
    }
    const id = (typeof m.baseModelId === "string" && m.baseModelId.trim()) || shortGeminiIdFromName(m.name);
    const t = id.trim();
    if (t) strict.add(t);
  }
  if (strict.size > 0) {
    return [...strict].sort((a, b) => a.localeCompare(b));
  }
  const legacy = new Set<string>();
  for (const m of list) {
    const short = shortGeminiIdFromName(m.name);
    const t = short.trim();
    if (!t) continue;
    if (t.includes("gemini") || t.startsWith("embedding")) legacy.add(t);
  }
  return [...legacy].sort((a, b) => a.localeCompare(b));
}
