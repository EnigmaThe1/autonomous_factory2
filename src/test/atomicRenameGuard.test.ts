import test from "node:test";
import assert from "node:assert/strict";
import { isLikelyFileExistsFilesystemError, isLikelyMissingPathFilesystemError } from "../storage/atomicRenameGuard";

test("isLikelyMissingPathFilesystemError: ENOENT code", () => {
  assert.equal(isLikelyMissingPathFilesystemError({ code: "ENOENT", message: "x" }), true);
});

test("isLikelyMissingPathFilesystemError: EntryNotFound message", () => {
  assert.equal(
    isLikelyMissingPathFilesystemError({
      message: "Error: Unable to delete nonexistent file /path/mission.json (EntryNotFound)"
    }),
    true
  );
});

test("isLikelyMissingPathFilesystemError: generic permission false", () => {
  assert.equal(isLikelyMissingPathFilesystemError({ code: "EACCES", message: "permission denied" }), false);
});

test("isLikelyFileExistsFilesystemError: EEXIST", () => {
  assert.equal(isLikelyFileExistsFilesystemError({ code: "EEXIST", message: "exists" }), true);
});
