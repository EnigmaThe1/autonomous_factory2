import test from "node:test";
import assert from "node:assert/strict";
import { parseOllamaNdjsonLines, parseOpenAiSseLines } from "../providers/streamParsers";

test("openai parser extracts chunks and handles malformed payloads", () => {
  const lines = [
    "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}",
    "data: not-json",
    "data: [DONE]"
  ];
  const parsed = parseOpenAiSseLines(lines);
  assert.deepEqual(parsed.chunks, ["hello"]);
  assert.equal(parsed.done, true);
  assert.equal(parsed.malformedCount, 1);
});

test("ollama parser extracts response chunks and counts malformed lines", () => {
  const lines = [
    "{\"response\":\"a\"}",
    "not-json",
    "{\"response\":\"b\"}"
  ];
  const parsed = parseOllamaNdjsonLines(lines);
  assert.deepEqual(parsed.chunks, ["a", "b"]);
  assert.equal(parsed.malformedCount, 1);
});
