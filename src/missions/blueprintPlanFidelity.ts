import type { Mission } from "../types";
import { tokenise } from "../util";

/** Paths that commonly change without implying product-scope drift. */
const PATH_ALLOWLIST_SUBSTRINGS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock",
  "yarn.lock",
  "tsconfig",
  "eslint",
  ".gitignore",
  "readme",
  "license",
  "changelog",
  ".vscode",
  "cargo.toml",
  "go.mod",
  "go.sum",
  "dockerfile",
  "docker-compose",
  ".env.example",
  "jest.config",
  "vitest.config",
  "playwright.config",
  "webpack.config",
  "vite.config",
  ".prettierrc",
  "biome.json"
];

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "are",
  "was",
  "will",
  "have",
  "has",
  "been",
  "each",
  "not",
  "but",
  "can",
  "should",
  "must",
  "into",
  "also",
  "when",
  "then",
  "than",
  "such",
  "only",
  "over",
  "both",
  "most",
  "some",
  "what",
  "your",
  "their",
  "there",
  "where",
  "which",
  "while",
  "after",
  "before",
  "being",
  "other"
]);

function isAllowlistedPath(filePath: string): boolean {
  const n = filePath.toLowerCase().replace(/\\/g, "/");
  return PATH_ALLOWLIST_SUBSTRINGS.some((s) => n.includes(s));
}

/**
 * Tokens from approved blueprint text (requirements, architecture, steps) for loose path matching.
 */
export function extractBlueprintKeywords(mission: Mission): Set<string> {
  const bp = mission.blueprint;
  if (!bp || bp.status !== "approved") return new Set();
  const chunks: string[] = [
    bp.requirementsSummary,
    bp.architectureSummary,
    ...bp.steps.flatMap((s) => [s.title, s.summary, ...s.acceptanceCriteria])
  ];
  const words = tokenise(chunks.join("\n"));
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < 4) continue;
    if (STOPWORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

/**
 * True if normalized path plausibly relates to blueprint vocabulary (substring match).
 */
export function pathMatchesBlueprintKeywords(filePath: string, keywords: Set<string>): boolean {
  if (!keywords.size) return true;
  if (isAllowlistedPath(filePath)) return true;
  const norm = filePath.toLowerCase().replace(/\\/g, "/");
  for (const k of keywords) {
    if (k.length >= 3 && norm.includes(k)) return true;
  }
  return false;
}

export interface PlanFidelityDriftResult {
  drift: boolean;
  suspicious: string[];
}

/**
 * Heuristic v1: modified files whose paths don't match any blueprint-derived keyword (allowlist exempt).
 */
export function computePlanFidelityDrift(mission: Mission): PlanFidelityDriftResult {
  const bp = mission.blueprint;
  if (!bp || bp.status !== "approved") return { drift: false, suspicious: [] };
  const files = mission.filesModified || [];
  if (!files.length) return { drift: false, suspicious: [] };
  const keywords = extractBlueprintKeywords(mission);
  if (!keywords.size) return { drift: false, suspicious: [] };
  const suspicious = files.filter((f) => !pathMatchesBlueprintKeywords(f, keywords));
  return { drift: suspicious.length > 0, suspicious };
}
