import type { MemoryItem } from "../types";

/** Injected into agent prompts when claim discipline is enabled. */
export const CLAIM_STATUS_INSTRUCTIONS = [
  "CLAIM DISCIPLINE: For conclusions that drive code, dependencies, or release risk, make the basis explicit:",
  "- Use MEMORY lines to record claims, e.g. MEMORY:finding:claim_verified_tool- <one-line fact tied to a tool you ran>",
  "- MEMORY:finding:claim_verified_file- <fact from readFile/listFiles/search>",
  "- MEMORY:finding:claim_verified_web- <fact from webSearch/fetchWebPage already in memory>",
  "- MEMORY:finding:claim_assumption- <explicit guess; do not treat as verified>",
  "Do not label ASSUMPTION-level text as if it were tool-verified."
].join("\n");

const MEMORY_KINDS = new Set<MemoryItem["kind"]>(["summary", "finding", "decision", "tool_result", "user", "checkpoint"]);

/**
 * Normalizes MEMORY: lines from parseAgentOutput into storable memories with canonical `claim:*` tags.
 */
export function normalizeParsedMemoryItemsForStorage(
  items: Array<{ kind: string; tags: string[]; text: string }>
): Array<Omit<MemoryItem, "id" | "ts">> {
  return items.map((m) => {
    const kind = MEMORY_KINDS.has(m.kind as MemoryItem["kind"]) ? (m.kind as MemoryItem["kind"]) : "finding";
    const tags = m.tags.flatMap((t) => {
      const x = t.trim();
      if (!x) return [];
      if (x.startsWith("claim_verified_")) return [`claim:verified_${x.slice("claim_verified_".length)}`];
      if (x === "claim_assumption" || x.startsWith("claim_assumption_")) return ["claim:assumption"];
      if (x.startsWith("claim_")) return [`claim:${x.slice("claim_".length)}`];
      return [x];
    });
    return { kind, text: m.text, tags };
  });
}

/** True if mission memory contains an explicit verified-claim tag (used by trust gates). */
export function missionHasVerifiedClaimBasis(memory: MemoryItem[], maxAgeMs = 4 * 3_600_000, now = Date.now()): boolean {
  for (const m of memory) {
    if (m.ts < now - maxAgeMs) continue;
    if (m.tags?.some((t) => t.startsWith("claim:verified_"))) return true;
  }
  return false;
}
