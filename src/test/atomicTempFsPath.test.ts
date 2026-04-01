import test from "node:test";
import assert from "node:assert/strict";
import { atomicTempFsPath } from "../util";

test("atomicTempFsPath generates unique temp filenames", () => {
  const final = "/tmp/example.json";
  const a = atomicTempFsPath(final);
  const b = atomicTempFsPath(final);
  assert.notEqual(a, b);
  assert.equal(a.startsWith(final), true);
  assert.equal(a.endsWith(".tmp"), true);
});

