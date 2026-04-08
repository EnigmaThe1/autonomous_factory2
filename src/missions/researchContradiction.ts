import type { MemoryItem } from "../types";
import { trimText } from "../util";

function extractWebSearchQuery(text: string): string | undefined {
  const m = text.match(/^Query:\s*(.+)$/m);
  return m ? trimText(m[1], 400) : undefined;
}

function extractExcerptNormalized(text: string): string | undefined {
  const idx = text.indexOf("Excerpt:\n");
  if (idx < 0) return undefined;
  const body = text.slice(idx + "Excerpt:\n".length).trim();
  return body.replace(/\s+/g, " ").slice(0, 500);
}

export interface ResearchContradictionHit {
  queryKey: string;
  detail: string;
}

/**
 * Detects duplicate webSearch queries in research_evidence findings with materially different excerpts.
 * Heuristic only — surfaces operator warning, does not prove logical contradiction.
 */
export function findDuplicateQueryResearchContradictions(memories: MemoryItem[]): ResearchContradictionHit[] {
  type Row = { excerpt: string; id: string };
  const byQuery = new Map<string, Row[]>();

  for (const m of memories) {
    if (m.kind !== "finding") continue;
    if (!m.tags?.includes("research_evidence")) continue;
    if (!m.text.includes("Research evidence (webSearch)")) continue;
    const q = extractWebSearchQuery(m.text);
    const ex = extractExcerptNormalized(m.text);
    if (!q || !ex || ex.length < 24) continue;
    const key = q.toLowerCase().trim();
    const list = byQuery.get(key) || [];
    list.push({ excerpt: ex, id: m.id });
    byQuery.set(key, list);
  }

  const out: ResearchContradictionHit[] = [];
  for (const [queryKey, rows] of byQuery) {
    if (rows.length < 2) continue;
    const excerpts = new Set(rows.map((r) => r.excerpt));
    if (excerpts.size < 2) continue;
    out.push({
      queryKey,
      detail: `Same webSearch query produced ${excerpts.size} differing excerpts (${rows.length} memories). Reconcile or fetch a canonical source.`
    });
  }
  return out;
}
