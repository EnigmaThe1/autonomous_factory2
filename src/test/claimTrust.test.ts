import test from "node:test";
import assert from "node:assert/strict";
import { missionHasVerifiedClaimBasis, normalizeParsedMemoryItemsForStorage } from "../missions/claimTrust";
import type { MemoryItem } from "../types";

test("normalizeParsedMemoryItemsForStorage maps claim_verified_tool", () => {
  const out = normalizeParsedMemoryItemsForStorage([
    { kind: "finding", tags: ["claim_verified_tool"], text: "t" }
  ]);
  assert.deepEqual(out[0].tags, ["claim:verified_tool"]);
});

test("missionHasVerifiedClaimBasis", () => {
  const now = Date.now();
  const mem: MemoryItem[] = [{ id: "1", ts: now, kind: "finding", text: "x", tags: ["claim:assumption"] }];
  assert.equal(missionHasVerifiedClaimBasis(mem, 3_600_000, now), false);
  mem.push({ id: "2", ts: now, kind: "finding", text: "y", tags: ["claim:verified_file"] });
  assert.equal(missionHasVerifiedClaimBasis(mem, 3_600_000, now), true);
});
