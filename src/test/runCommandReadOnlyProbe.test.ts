import test from "node:test";
import assert from "node:assert/strict";
import { isRunCommandLikelyReadOnlyProbe } from "../missions/runCommandReadOnlyProbe";

test("allows ls and find probes", () => {
  assert.equal(isRunCommandLikelyReadOnlyProbe("ls -la docs/foo"), true);
  assert.equal(isRunCommandLikelyReadOnlyProbe("find docs/foo -type f"), true);
});

test("rejects rm and compound commands", () => {
  assert.equal(isRunCommandLikelyReadOnlyProbe("rm -rf x"), false);
  assert.equal(isRunCommandLikelyReadOnlyProbe("ls a; rm b"), false);
});

test("rejects find -delete", () => {
  assert.equal(isRunCommandLikelyReadOnlyProbe("find . -name '*.tmp' -delete"), false);
});
