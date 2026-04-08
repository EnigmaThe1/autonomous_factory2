import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateQueryResearchContradictions } from "../missions/researchContradiction";
import type { MemoryItem } from "../types";

test("findDuplicateQueryResearchContradictions: empty", () => {
  assert.equal(findDuplicateQueryResearchContradictions([]).length, 0);
});

test("findDuplicateQueryResearchContradictions: flags same query different excerpts", () => {
  const mk = (ex: string, id: string): MemoryItem => ({
    id,
    ts: 1,
    kind: "finding",
    text: `Research evidence (webSearch)\nQuery: react hooks rules\nFreshness: short | Captured: 2026-01-01T00:00:00.000Z\n\nExcerpt:\n${ex}`,
    tags: ["research_evidence", "web", "webSearch", "freshness:short"]
  });
  const mem = [mk("Answer A is correct for hooks.", "a"), mk("Answer B contradicts A entirely.", "b")];
  const hits = findDuplicateQueryResearchContradictions(mem);
  assert.equal(hits.length, 1);
  assert.match(hits[0].detail, /differing excerpts/i);
});
