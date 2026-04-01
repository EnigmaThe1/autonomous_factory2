import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { isLikelyStreamAbort } from "../util";

test("isLikelyStreamAbort: true for AbortError and aborted signal", () => {
  assert.equal(isLikelyStreamAbort(new DOMException("aborted", "AbortError")), true);
  const ac = new AbortController();
  ac.abort();
  assert.equal(isLikelyStreamAbort(new Error("other"), ac.signal), true);
});

test("isLikelyStreamAbort: false for unrelated errors when signal not aborted", () => {
  assert.equal(isLikelyStreamAbort(new Error("network down")), false);
  assert.equal(isLikelyStreamAbort(null), false);
});

test("isLikelyStreamAbort: message heuristics for provider abort wording", () => {
  assert.equal(isLikelyStreamAbort(new Error("Request aborted")), true);
  assert.equal(isLikelyStreamAbort(new Error("operation was cancelled")), true);
});

test("BaseAgent forwards AbortSignal into provider.stream ChatRequest (source contract)", () => {
  const baseAgentPath = path.join(__dirname, "..", "..", "src", "agents", "BaseAgent.ts");
  const src = fs.readFileSync(baseAgentPath, "utf8");
  assert.match(src, /provider\.stream\(\{[\s\S]*\bsignal\b/);
});
