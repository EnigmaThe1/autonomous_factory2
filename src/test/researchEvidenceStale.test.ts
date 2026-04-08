import test from "node:test";
import assert from "node:assert/strict";
import {
  findStaleResearchEvidenceMemories,
  formatResearchEvidenceFinding,
  freshnessTtlMs,
  parseCapturedMsFromEvidenceText,
  parseFreshnessFromTags
} from "../missions/researchEvidence";
import type { MemoryItem } from "../types";

test("freshnessTtlMs: volatile is shorter than long", () => {
  assert.ok(freshnessTtlMs("volatile") < freshnessTtlMs("long"));
});

test("parseCapturedMsFromEvidenceText reads ISO line", () => {
  const { text } = formatResearchEvidenceFinding({
    tool: "webSearch",
    ts: Date.UTC(2024, 0, 2, 12, 0, 0),
    query: "q",
    excerpt: "x"
  });
  const ms = parseCapturedMsFromEvidenceText(text);
  assert.equal(ms, Date.UTC(2024, 0, 2, 12, 0, 0));
});

test("parseFreshnessFromTags extracts class", () => {
  assert.equal(parseFreshnessFromTags(["research_evidence", "freshness:volatile"]), "volatile");
  assert.equal(parseFreshnessFromTags(["foo"]), undefined);
});

test("findStaleResearchEvidenceMemories: flags item older than TTL", () => {
  const oldTs = Date.now() - freshnessTtlMs("volatile") - 60_000;
  // webSearch without URL uses volatile freshness (short TTL) so we exceed it quickly in tests.
  const { text, freshness } = formatResearchEvidenceFinding({
    tool: "webSearch",
    ts: oldTs,
    query: "q",
    excerpt: "body"
  });
  const mem: MemoryItem = {
    id: "m1",
    ts: Date.now(),
    kind: "finding",
    text,
    tags: ["research_evidence", "web", "fetchWebPage", `freshness:${freshness}`]
  };
  const stale = findStaleResearchEvidenceMemories([mem]);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].id, "m1");
  assert.equal(stale[0].freshness, freshness);
});

test("findStaleResearchEvidenceMemories: ignores fresh item", () => {
  const ts = Date.now() - 60_000;
  const { text, freshness } = formatResearchEvidenceFinding({
    tool: "webSearch",
    ts,
    query: "q",
    excerpt: "x"
  });
  const mem: MemoryItem = {
    id: "m2",
    ts: Date.now(),
    kind: "finding",
    text,
    tags: ["research_evidence", "freshness:volatile"]
  };
  const stale = findStaleResearchEvidenceMemories([mem]);
  assert.equal(stale.length, 0);
});
