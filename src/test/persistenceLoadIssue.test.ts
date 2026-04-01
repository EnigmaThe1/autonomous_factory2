import test from "node:test";
import assert from "node:assert/strict";
import { shouldIgnorePersistenceReadError } from "../storage/persistenceLoadIssue";

test("shouldIgnorePersistenceReadError returns true for missing-file variants", () => {
  assert.equal(shouldIgnorePersistenceReadError({ code: "ENOENT", message: "no such file or directory" }), true);
  assert.equal(shouldIgnorePersistenceReadError({ code: "FileNotFound", message: "FileNotFound" }), true);
  assert.equal(shouldIgnorePersistenceReadError({ name: "FileNotFound", message: "missing" }), true);
  assert.equal(shouldIgnorePersistenceReadError(new Error("ENOENT: no such file or directory")), true);
});

test("shouldIgnorePersistenceReadError returns false for real parse/corruption errors", () => {
  assert.equal(shouldIgnorePersistenceReadError(new Error("Unexpected token } in JSON at position 20")), false);
  assert.equal(shouldIgnorePersistenceReadError({ code: "EACCES", message: "permission denied" }), false);
});
