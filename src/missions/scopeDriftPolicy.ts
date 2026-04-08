import type { BlueprintStep } from "./missionBlueprintTypes";
import type { Mission, WorkItem } from "../types";
import { tokenise } from "../util";
import { extractBlueprintKeywords, pathMatchesBlueprintKeywords } from "./blueprintPlanFidelity";

export type ScopeDriftVerdict =
  | { kind: "hard_block"; reason: string }
  | { kind: "in_scope"; reason: string }
  | { kind: "needs_approval"; reason: string; details: Record<string, unknown> };

const HARD_BLOCK_PATH_SUBSTRINGS = [
  "/.git/",
  "/.vscode/",
  "/node_modules/",
  "/dist/",
  "/.output/",
  "/.vsix/",
  "/.my-ai-extension/",
];

const HARD_BLOCK_BASENAMES = [
  ".env",
];

function normalizeFsPath(input: string): string {
  const n = input.toLowerCase().replace(/\\/g, "/");
  return n.startsWith("/") ? n : `/${n}`;
}

function isHardBlockedPath(resolvedPath: string): boolean {
  const n = normalizeFsPath(resolvedPath);
  if (HARD_BLOCK_PATH_SUBSTRINGS.some((s) => n.includes(s))) return true;
  if (n.endsWith(".vsix")) return true;
  const base = n.split("/").pop() || "";
  if (!base) return false;
  if (HARD_BLOCK_BASENAMES.includes(base)) return true;
  if (base.startsWith(".env.")) return true;
  return false;
}

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

function stepKeywords(step: BlueprintStep): Set<string> {
  const chunks = [step.title, step.summary, ...(step.acceptanceCriteria || [])].join("\n");
  const words = tokenise(chunks);
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < 4) continue;
    if (STOPWORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

export function classifyScopeDriftForPath(input: {
  mission: Mission;
  item: WorkItem;
  tool: string;
  resolvedPath: string;
}): ScopeDriftVerdict {
  const { mission, item, tool, resolvedPath } = input;
  if (isHardBlockedPath(resolvedPath)) {
    return { kind: "hard_block", reason: `Sensitive path blocked by policy: ${resolvedPath}` };
  }

  const bp = mission.blueprint;
  if (bp?.status === "approved" && item.blueprintStepId) {
    const step = bp.steps.find((s) => s.id === item.blueprintStepId);
    if (step) {
      const kws = stepKeywords(step);
      if (pathMatchesBlueprintKeywords(resolvedPath, kws)) {
        return { kind: "in_scope", reason: `Path matches step keywords for ${item.blueprintStepId}` };
      }
      const global = extractBlueprintKeywords(mission);
      if (pathMatchesBlueprintKeywords(resolvedPath, global)) {
        return {
          kind: "in_scope",
          reason: `Path matches global blueprint keywords (weak alignment; step ${item.blueprintStepId} did not match)`
        };
      }
      return {
        kind: "needs_approval",
        reason: `Scope drift: path does not match step ${item.blueprintStepId} intent`,
        details: {
          tool,
          resolvedPath,
          blueprintStepId: item.blueprintStepId,
          topStepKeywords: [...kws].slice(0, 12),
        }
      };
    }
  }

  // No approved blueprint/step context → treat as in-scope (B1 relies on approvals + role envelopes).
  return { kind: "in_scope", reason: "No approved blueprint step context for drift classification" };
}

