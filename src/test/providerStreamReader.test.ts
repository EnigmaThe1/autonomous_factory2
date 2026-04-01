import test from "node:test";
import assert from "node:assert/strict";
import { readStreamChunks } from "../providers/providerStreamReader";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    }
  });
}

function simpleParse(lines: string[]): { chunks: string[]; done?: boolean } {
  const chunks: string[] = [];
  let done = false;
  for (const l of lines) {
    const trimmed = l.trim();
    if (trimmed === "[DONE]") { done = true; break; }
    if (trimmed.length > 0) chunks.push(trimmed);
  }
  return { chunks, done };
}

test("readStreamChunks: yields parsed chunks from stream", async () => {
  const stream = makeStream(["hello\nworld\n", "foo\n"]);
  const result: string[] = [];
  for await (const chunk of readStreamChunks(stream, undefined, simpleParse)) {
    result.push(chunk);
  }
  assert.deepEqual(result, ["hello", "world", "foo"]);
});

test("readStreamChunks: handles partial lines across read boundaries", async () => {
  const stream = makeStream(["hel", "lo\nwor", "ld\n"]);
  const result: string[] = [];
  for await (const chunk of readStreamChunks(stream, undefined, simpleParse)) {
    result.push(chunk);
  }
  assert.deepEqual(result, ["hello", "world"]);
});

test("readStreamChunks: stops early when parser signals done", async () => {
  const stream = makeStream(["a\n[DONE]\nb\n"]);
  const result: string[] = [];
  for await (const chunk of readStreamChunks(stream, undefined, simpleParse)) {
    result.push(chunk);
  }
  assert.deepEqual(result, ["a"]);
});

test("readStreamChunks: throws on aborted signal", async () => {
  const ac = new AbortController();
  ac.abort();
  const stream = makeStream(["data\n"]);
  const gen = readStreamChunks(stream, ac.signal, simpleParse);
  await assert.rejects(() => gen.next(), /aborted/i);
});

test("readStreamChunks: empty stream yields nothing", async () => {
  const stream = makeStream([]);
  const result: string[] = [];
  for await (const chunk of readStreamChunks(stream, undefined, simpleParse)) {
    result.push(chunk);
  }
  assert.deepEqual(result, []);
});

test("readStreamChunks: skips empty lines via parser", async () => {
  const stream = makeStream(["\n\nhello\n\n"]);
  const result: string[] = [];
  for await (const chunk of readStreamChunks(stream, undefined, simpleParse)) {
    result.push(chunk);
  }
  assert.deepEqual(result, ["hello"]);
});
