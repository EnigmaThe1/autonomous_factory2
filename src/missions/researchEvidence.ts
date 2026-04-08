import { trimText } from "../util";
import type { MemoryItem } from "../types";

export type EvidenceFreshnessClass = "volatile" | "short" | "medium" | "long" | "persistent";

const FRESHNESS_ORDER: EvidenceFreshnessClass[] = ["volatile", "short", "medium", "long", "persistent"];

/** Max age (ms) after which evidence of this class is considered stale for warnings/gates. */
export function freshnessTtlMs(f: EvidenceFreshnessClass): number {
  const h = 3_600_000;
  const d = 24 * h;
  switch (f) {
    case "volatile":
      return h;
    case "short":
      return d;
    case "medium":
      return 7 * d;
    case "long":
      return 30 * d;
    case "persistent":
      return 365 * d;
    default:
      return d;
  }
}

export function parseFreshnessFromTags(tags?: string[]): EvidenceFreshnessClass | undefined {
  const raw = tags?.find((x) => x.startsWith("freshness:"));
  if (!raw) return undefined;
  const v = raw.slice("freshness:".length) as EvidenceFreshnessClass;
  return FRESHNESS_ORDER.includes(v) ? v : undefined;
}

/** Parses `Captured: <ISO>` line written by `formatResearchEvidenceFinding`. */
export function parseCapturedMsFromEvidenceText(text: string): number | undefined {
  const m = text.match(/Captured:\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (!m) return undefined;
  const ts = Date.parse(m[1]);
  return Number.isFinite(ts) ? ts : undefined;
}

export interface StaleResearchEvidenceRow {
  id: string;
  freshness: EvidenceFreshnessClass;
  ageMs: number;
  ttlMs: number;
}

/** Mission memories tagged `research_evidence` whose capture time exceeds freshness TTL. */
export function findStaleResearchEvidenceMemories(memory: MemoryItem[], now = Date.now()): StaleResearchEvidenceRow[] {
  const out: StaleResearchEvidenceRow[] = [];
  for (const item of memory) {
    if (item.kind !== "finding") continue;
    if (!item.tags?.includes("research_evidence")) continue;
    const freshness = parseFreshnessFromTags(item.tags);
    if (!freshness) continue;
    const captured = parseCapturedMsFromEvidenceText(item.text);
    if (captured === undefined) continue;
    const ttlMs = freshnessTtlMs(freshness);
    const ageMs = now - captured;
    if (ageMs > ttlMs) out.push({ id: item.id, freshness, ageMs, ttlMs });
  }
  return out;
}

export function inferFreshnessForUrl(url: string): EvidenceFreshnessClass {
  const u = (url || "").toLowerCase();
  if (!u) return "short";
  if (u.includes("localhost") || u.includes("127.0.0.1")) return "volatile";
  if (u.includes("/releases") || u.includes("/changelog") || u.includes("/release-notes")) return "short";
  if (u.includes("/blog") || u.includes("/news") || u.includes("/posts")) return "short";
  if (u.includes("/docs") || u.includes("readthedocs") || u.includes("developer.") || u.includes("docs.")) return "long";
  if (u.includes("github.com") || u.includes("gitlab.com")) return "medium";
  return "medium";
}

export function formatResearchEvidenceFinding(input: {
  tool: "webSearch" | "fetchWebPage";
  ts: number;
  query?: string;
  url?: string;
  provider?: string;
  excerpt?: string;
  topUrls?: string[];
  status?: number;
  contentType?: string;
}): { text: string; freshness: EvidenceFreshnessClass } {
  const freshness = input.url ? inferFreshnessForUrl(input.url) : "volatile";
  const header =
    input.tool === "webSearch"
      ? `Research evidence (webSearch)\nQuery: ${trimText(String(input.query || ""), 300)}`
      : `Research evidence (fetchWebPage)\nURL: ${trimText(String(input.url || ""), 600)}`;
  const meta: string[] = [];
  if (input.provider) meta.push(`Provider: ${input.provider}`);
  if (typeof input.status === "number") meta.push(`HTTP: ${input.status}`);
  if (input.contentType) meta.push(`Content-Type: ${trimText(input.contentType, 120)}`);
  meta.push(`Freshness: ${freshness}`);
  meta.push(`Captured: ${new Date(input.ts).toISOString()}`);

  const excerpt = trimText(String(input.excerpt || ""), 1600);
  const urls = (input.topUrls || []).slice(0, 8).filter(Boolean);
  const urlsBlock = urls.length ? `Top URLs:\n- ${urls.join("\n- ")}` : "";
  const body = excerpt ? `Excerpt:\n${excerpt}` : "";

  return {
    freshness,
    text: [header, meta.join(" | "), "", urlsBlock, urlsBlock && body ? "" : "", body]
      .filter((x) => String(x || "").trim().length > 0)
      .join("\n")
      .trim()
  };
}

