import test from "node:test";
import assert from "node:assert/strict";
import { shouldCollapseToComplete } from "../missions/missionCompletionCollapse";
import { Mission, MissionPolicy, WorkItem } from "../types";

function baseMission(over: Partial<Mission> & { queue?: WorkItem[]; policy?: MissionPolicy }): Mission {
  const policy: MissionPolicy = {
    closureRequired: true,
    requireReviewerBeforeComplete: true,
    requireValidatorBeforeComplete: true,
    requireImplementerBeforeComplete: true,
    autoContinue: true,
    maxAutoRounds: 24,
    minCompletedWorkItems: 6,
    stallReplanThreshold: 3,
    policyPreset: "strict",
    ...over.policy
  };
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
    policy,
    validationState: over.validationState,
    ...over
  };
}

test("collapses when closure required, validation passed, empty queue", () => {
  const m = baseMission({ queue: [], validationState: "passed" });
  assert.equal(shouldCollapseToComplete(m), true);
});

test("collapses when optional todo remains (requiredForCompletion false)", () => {
  const q: WorkItem[] = [
    { id: "1", title: "tail review", role: "reviewer", status: "todo", prompt: "x", requiredForCompletion: false }
  ];
  const m = baseMission({ queue: q, validationState: "passed" });
  assert.equal(shouldCollapseToComplete(m), true);
});

test("does not collapse when required reviewer todo remains", () => {
  const q: WorkItem[] = [
    { id: "1", title: "tail review", role: "reviewer", status: "todo", prompt: "x" }
  ];
  const m = baseMission({ queue: q, validationState: "passed" });
  assert.equal(shouldCollapseToComplete(m), false);
});

test("does not collapse when validation pending", () => {
  const m = baseMission({ queue: [], validationState: "pending" });
  assert.equal(shouldCollapseToComplete(m), false);
});

test("does not collapse when closure not required", () => {
  const m = baseMission({
    policy: {
      closureRequired: false,
      requireReviewerBeforeComplete: false,
      requireValidatorBeforeComplete: false,
      requireImplementerBeforeComplete: false,
      autoContinue: true,
      maxAutoRounds: 24,
      minCompletedWorkItems: 1,
      stallReplanThreshold: 3
    },
    validationState: "passed"
  });
  assert.equal(shouldCollapseToComplete(m), false);
});

test("does not collapse when a work item failed", () => {
  const q: WorkItem[] = [
    { id: "1", title: "x", role: "implementer", status: "failed", prompt: "p" }
  ];
  const m = baseMission({ queue: q, validationState: "passed" });
  assert.equal(shouldCollapseToComplete(m), false);
});

test("does not collapse while any work item is still running", () => {
  const q: WorkItem[] = [
    { id: "1", title: "x", role: "reviewer", status: "running", prompt: "p" }
  ];
  const m = baseMission({ queue: q, validationState: "passed" });
  assert.equal(shouldCollapseToComplete(m), false);
});
