import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLY_PATCH_NOOP_REPLACE_MIN_LEN,
  isApplyPatchNoopBecauseReplaceAlreadyPresent,
  workCompletionKindFromSuccessfulToolSteps
} from "../tools/applyPatchNoOpPolicy";
import { resolveCompletionReasonForCompletedMission } from "../missions/alreadySatisfiedWorkItem";
import { hasRequiredUnresolvedWork } from "../missions/requiredWork";
import { shouldCollapseToComplete } from "../missions/missionCompletionCollapse";
import { Mission, MissionPolicy, WorkItem } from "../types";

test("Case A — search miss, long replace already in file => no-op success predicate", () => {
  const file = "line one\nconst TARGET_VALUE = 42;\nline three\n";
  const search = "this old snippet is gone";
  const replace = "const TARGET_VALUE = 42;";
  assert.equal(file.replace(search, replace), file);
  assert.equal(isApplyPatchNoopBecauseReplaceAlreadyPresent(file, search, replace), true);
});

test("Case B — search miss, replace not in file => not a deterministic no-op", () => {
  const file = "alpha\nbeta\n";
  const search = "missing";
  const replace = "gamma_line_xx"; // 12 chars
  assert.equal(file.replace(search, replace), file);
  assert.equal(isApplyPatchNoopBecauseReplaceAlreadyPresent(file, search, replace), false);
});

test("Case E — short replace substring present => reject (ambiguous / avoid false success)", () => {
  const file = "function foo() { return x; }\n";
  const search = "not here";
  const replace = "return"; // < MIN_LEN
  assert.equal(replace.length < APPLY_PATCH_NOOP_REPLACE_MIN_LEN, true);
  assert.equal(file.includes(replace), true);
  assert.equal(isApplyPatchNoopBecauseReplaceAlreadyPresent(file, search, replace), false);
});

test("Case E — empty replace => false (and would be unsafe with naive includes)", () => {
  const file = "any";
  assert.equal(isApplyPatchNoopBecauseReplaceAlreadyPresent(file, "nope", ""), false);
});

test("search still in file but replace produced no change (identity) => false", () => {
  const file = "keep KEEP token\n";
  const search = "KEEP";
  const replace = "KEEP";
  assert.equal(file.replace(search, replace), file);
  assert.equal(file.includes(search), true);
  assert.equal(isApplyPatchNoopBecauseReplaceAlreadyPresent(file, search, replace), false);
});

function mkPolicy(): MissionPolicy {
  return {
    closureRequired: true,
    requireReviewerBeforeComplete: true,
    requireValidatorBeforeComplete: true,
    requireImplementerBeforeComplete: true,
    autoContinue: true,
    maxAutoRounds: 24,
    minCompletedWorkItems: 4,
    stallReplanThreshold: 3,
    policyPreset: "balanced",
    requireValidationEvidence: true
  };
}

function baseMission(over: Partial<Mission> & { queue?: WorkItem[] }): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 0,
    updatedAt: 0,
    status: "running",
    activeProviderId: "x",
    queue: over.queue ?? [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: mkPolicy(),
    validationState: over.validationState,
    ...over
  };
}

test("Case C — multi-step: normal implementer done + later required todo => no collapse, unresolved work", () => {
  const q: WorkItem[] = [
    { id: "i1", title: "Impl", role: "implementer", status: "done", prompt: "p" },
    { id: "r1", title: "Rev", role: "reviewer", status: "todo", prompt: "p" }
  ];
  const m = baseMission({ queue: q, validationState: "pending" });
  assert.equal(hasRequiredUnresolvedWork(m), true);
  assert.equal(shouldCollapseToComplete(m), false);
});

test("Case D — tool-style completion without already_satisfied and no pending => completionReason undefined", () => {
  assert.equal(resolveCompletionReasonForCompletedMission(undefined, [{}]), undefined);
});

test("Case D — queue apply_patch_noop only => apply_patch_noop_success", () => {
  assert.equal(
    resolveCompletionReasonForCompletedMission(undefined, [{ completionKind: "apply_patch_noop" }]),
    "apply_patch_noop_success"
  );
});

test("Case D — pending stale_patch still wins over apply_patch_noop queue metadata", () => {
  assert.equal(
    resolveCompletionReasonForCompletedMission("stale_patch_but_goal_already_met", [{ completionKind: "apply_patch_noop" }]),
    "stale_patch_but_goal_already_met"
  );
});

test("workCompletionKindFromSuccessfulToolSteps: readFile + applyPatch noop => apply_patch_noop", () => {
  assert.equal(
    workCompletionKindFromSuccessfulToolSteps([
      { tool: "readFile" },
      { tool: "applyPatch", applyPatchNoop: true }
    ]),
    "apply_patch_noop"
  );
});

test("workCompletionKindFromSuccessfulToolSteps: applyPatch noop + writeFile => undefined (mutating)", () => {
  assert.equal(
    workCompletionKindFromSuccessfulToolSteps([
      { tool: "applyPatch", applyPatchNoop: true },
      { tool: "writeFile" }
    ]),
    undefined
  );
});

test("workCompletionKindFromSuccessfulToolSteps: real patch after noop => undefined", () => {
  assert.equal(
    workCompletionKindFromSuccessfulToolSteps([
      { tool: "applyPatch", applyPatchNoop: true },
      { tool: "applyPatch" }
    ]),
    undefined
  );
});

test("Case Cb — apply_patch_noop done + required reviewer todo => multi-step continues, no collapse", () => {
  const q: WorkItem[] = [
    {
      id: "i1",
      title: "Impl",
      role: "implementer",
      status: "done",
      prompt: "p",
      completionKind: "apply_patch_noop"
    },
    { id: "r1", title: "Rev", role: "reviewer", status: "todo", prompt: "p" }
  ];
  const m = baseMission({ queue: q, validationState: "pending" });
  assert.equal(hasRequiredUnresolvedWork(m), true);
  assert.equal(shouldCollapseToComplete(m), false);
});
