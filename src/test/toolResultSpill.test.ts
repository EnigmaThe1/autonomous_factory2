import test from "node:test";
import assert from "node:assert/strict";
import { jsonUtf8ByteLength } from "../missions/toolResultSpill";

test("jsonUtf8ByteLength: small object", () => {
  assert.ok(jsonUtf8ByteLength({ a: 1 }) > 0);
  assert.ok(jsonUtf8ByteLength({ a: 1 }) < 100);
});

test("jsonUtf8ByteLength: counts utf-8 not code units", () => {
  const s = "é".repeat(100);
  assert.equal(Buffer.byteLength(JSON.stringify(s), "utf8"), jsonUtf8ByteLength(s));
});

test("jsonUtf8ByteLength: non-serializable returns infinity", () => {
  const o: Record<string, unknown> = {};
  o.self = o;
  assert.equal(jsonUtf8ByteLength(o), Number.POSITIVE_INFINITY);
});
