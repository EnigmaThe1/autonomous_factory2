import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithPolicy } from "../providers/fetchWithPolicy";

test("fetchWithPolicy retries after transient failure", async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = (async () => {
    attempts += 1;
    if (attempts < 2) throw new Error("transient");
    return new Response("ok", { status: 200 });
  }) as any;

  const response = await fetchWithPolicy("https://example.test", { method: "GET" }, { timeoutMs: 1000, retries: 2, retryDelayMs: 1 });
  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
  global.fetch = originalFetch;
});

test("fetchWithPolicy throws after max retries", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("down");
  }) as any;
  await assert.rejects(
    () => fetchWithPolicy("https://example.test", { method: "GET" }, { timeoutMs: 10, retries: 1, retryDelayMs: 1 }),
    /down/
  );
  global.fetch = originalFetch;
});

test("fetchWithPolicy aborts on timeout", async () => {
  const originalFetch = global.fetch;
  global.fetch = ((_: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as any;
  await assert.rejects(
    () => fetchWithPolicy("https://example.test", { method: "GET" }, { timeoutMs: 5, retries: 0, retryDelayMs: 1 }),
    /aborted/
  );
  global.fetch = originalFetch;
});

test("fetchWithPolicy aborts when external AbortSignal aborts", async () => {
  const originalFetch = global.fetch;
  global.fetch = ((_: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as any;
  const ac = new AbortController();
  const p = fetchWithPolicy("https://example.test", { method: "GET" }, { timeoutMs: 5000, retries: 2, retryDelayMs: 1, abortSignal: ac.signal });
  queueMicrotask(() => ac.abort());
  await assert.rejects(() => p, /aborted|Request aborted/);
  global.fetch = originalFetch;
});
