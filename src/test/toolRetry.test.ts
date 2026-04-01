import test from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../tools/toolRetry";
import type { ToolResult } from "../tools/ToolRegistry";

function okResult(summary = "ok"): ToolResult {
  return { ok: true, summary };
}

function failResult(summary: string): ToolResult {
  return { ok: false, summary };
}

test("withRetry: returns result on first success", async () => {
  let calls = 0;
  const result = await withRetry(() => { calls++; return Promise.resolve(okResult()); });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result._retryAttempts, undefined);
});

test("withRetry: retries on transient error in summary", async () => {
  let calls = 0;
  const result = await withRetry(
    () => {
      calls++;
      if (calls < 3) return Promise.resolve(failResult("ECONNRESET connection reset"));
      return Promise.resolve(okResult("recovered"));
    },
    { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, retryableErrors: [/ECONNRESET/i] }
  );
  assert.equal(calls, 3);
  assert.equal(result.ok, true);
  assert.equal(result._retryAttempts, 3);
});

test("withRetry: retries on thrown transient error", async () => {
  let calls = 0;
  const result = await withRetry(
    () => {
      calls++;
      if (calls < 2) throw new Error("socket hang up");
      return Promise.resolve(okResult("recovered"));
    },
    { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, retryableErrors: [/socket hang up/i] }
  );
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
});

test("withRetry: does NOT retry non-transient failures", async () => {
  let calls = 0;
  const result = await withRetry(
    () => { calls++; return Promise.resolve(failResult("Permission denied")); },
    { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, retryableErrors: [/ECONNRESET/i] }
  );
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
});

test("withRetry: does NOT retry approval requests", async () => {
  let calls = 0;
  const _result = await withRetry(
    () => {
      calls++;
      return Promise.resolve({
        ok: false,
        summary: "Approval required (ECONNRESET in name only)",
        requiresApproval: { kind: "terminal" as const, title: "test", details: "" }
      });
    },
    { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, retryableErrors: [/ECONNRESET/i] }
  );
  assert.equal(calls, 1);
});

test("withRetry: does NOT retry policy blocks", async () => {
  let calls = 0;
  const _result = await withRetry(
    () => {
      calls++;
      return Promise.resolve({ ok: false, summary: "timed out", blockedByPolicy: true });
    },
    { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, retryableErrors: [/timed out/i] }
  );
  assert.equal(calls, 1);
});

test("withRetry: exhausts max attempts and returns last result", async () => {
  let calls = 0;
  const result = await withRetry(
    () => { calls++; return Promise.resolve(failResult("ETIMEDOUT")); },
    { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, retryableErrors: [/ETIMEDOUT/i] }
  );
  assert.equal(calls, 3);
  assert.equal(result.ok, false);
  assert.equal(result._retryAttempts, 3);
});

test("withRetry: re-throws non-transient exceptions", async () => {
  await assert.rejects(
    () => withRetry(
      () => { throw new Error("TypeError: x is not a function"); },
      { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50, retryableErrors: [/ECONNRESET/i] }
    ),
    { message: /TypeError/ }
  );
});

test("withRetry: single attempt when maxAttempts is 1", async () => {
  let calls = 0;
  const result = await withRetry(
    () => { calls++; return Promise.resolve(failResult("ECONNRESET")); },
    { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 50, retryableErrors: [/ECONNRESET/i] }
  );
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
});
