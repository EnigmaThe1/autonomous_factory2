import test from "node:test";
import assert from "node:assert/strict";
import {
  isStaleApplyPatchSearchNotFound,
  staleImplementerToolFailureRecoveryDecision
} from "../missions/staleEditRecovery";

test("isStaleApplyPatchSearchNotFound: applyPatch + search text not found", () => {
  assert.equal(
    isStaleApplyPatchSearchNotFound({ tool: "applyPatch" }, "Search text not found in /x/y.md"),
    true
  );
  assert.equal(isStaleApplyPatchSearchNotFound({ tool: "applyPatch" }, "SEARCH TEXT NOT FOUND in foo"), true);
});

test("isStaleApplyPatchSearchNotFound: other tools or errors", () => {
  assert.equal(isStaleApplyPatchSearchNotFound({ tool: "readFile" }, "Search text not found"), false);
  assert.equal(isStaleApplyPatchSearchNotFound({ tool: "applyPatch" }, "ENOENT: no such file"), false);
});

test("stale recovery: implementer applyPatch search miss + validation passed => recover_to_satisfied", () => {
  assert.equal(
    staleImplementerToolFailureRecoveryDecision(
      "implementer",
      { validationState: "passed" },
      { tool: "applyPatch" },
      "Search text not found in README.md"
    ),
    "recover_to_satisfied"
  );
});

test("stale recovery: validation pending or failed => no_recovery (mission stays actionable, not false-completed)", () => {
  assert.equal(
    staleImplementerToolFailureRecoveryDecision(
      "implementer",
      { validationState: "pending" },
      { tool: "applyPatch" },
      "Search text not found in README.md"
    ),
    "no_recovery"
  );
  assert.equal(
    staleImplementerToolFailureRecoveryDecision(
      "implementer",
      { validationState: "failed" },
      { tool: "applyPatch" },
      "Search text not found in README.md"
    ),
    "no_recovery"
  );
});

test("stale recovery: genuine tool failure (not search miss) => no_recovery", () => {
  assert.equal(
    staleImplementerToolFailureRecoveryDecision(
      "implementer",
      { validationState: "passed" },
      { tool: "readFile" },
      "Search text not found"
    ),
    "no_recovery"
  );
  assert.equal(
    staleImplementerToolFailureRecoveryDecision(
      "implementer",
      { validationState: "passed" },
      { tool: "applyPatch" },
      "Policy denied"
    ),
    "no_recovery"
  );
});

test("stale recovery: non-implementer => no_recovery", () => {
  assert.equal(
    staleImplementerToolFailureRecoveryDecision(
      "reviewer",
      { validationState: "passed" },
      { tool: "applyPatch" },
      "Search text not found in README.md"
    ),
    "no_recovery"
  );
});
