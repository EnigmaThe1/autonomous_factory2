import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRunCommandPreview } from "../missions/runCommandPreviewNormalize";

test("normalizeRunCommandPreview: string trims and caps", () => {
  assert.equal(normalizeRunCommandPreview("  ls -la  "), "ls -la");
  const long = "x".repeat(600);
  assert.equal(normalizeRunCommandPreview(long)?.length, 500);
});

test("normalizeRunCommandPreview: number and boolean", () => {
  assert.equal(normalizeRunCommandPreview(42), "42");
  assert.equal(normalizeRunCommandPreview(false), "false");
});

test("normalizeRunCommandPreview: object JSON", () => {
  const p = normalizeRunCommandPreview({ cmd: "ls", cwd: "." });
  assert.ok(p?.includes("cmd"));
  assert.ok(p?.includes("ls"));
});

test("normalizeRunCommandPreview: nullish", () => {
  assert.equal(normalizeRunCommandPreview(undefined), undefined);
  assert.equal(normalizeRunCommandPreview(null), undefined);
  assert.equal(normalizeRunCommandPreview(""), undefined);
  assert.equal(normalizeRunCommandPreview("   "), undefined);
});
