import test from "node:test";
import assert from "node:assert/strict";
import {
  missionQueueHasAlreadySatisfiedWorkItem,
  missionQueueHasApplyPatchNoopWorkItem,
  parseAlreadySatisfiedDeclaration,
  resolveCompletionReasonForCompletedMission,
  shouldHonorAlreadySatisfiedNoToolRun
} from "../missions/alreadySatisfiedWorkItem";
import { hasRequiredUnresolvedWork } from "../missions/requiredWork";
import { shouldCollapseToComplete } from "../missions/missionCompletionCollapse";
import { Mission, MissionPolicy, WorkItem } from "../types";

test("parseAlreadySatisfiedDeclaration: first matching line", () => {
  assert.deepEqual(parseAlreadySatisfiedDeclaration("x\nALREADY_SATISFIED: README fixed\n"), { reason: "README fixed" });
  assert.deepEqual(parseAlreadySatisfiedDeclaration("already_satisfied: no delta"), { reason: "no delta" });
});

test("parseAlreadySatisfiedDeclaration: empty reason becomes placeholder", () => {
  assert.deepEqual(parseAlreadySatisfiedDeclaration("ALREADY_SATISFIED:\n"), { reason: "(no reason given)" });
});

test("shouldHonorAlreadySatisfiedNoToolRun: implementer/reviewer, no tools", () => {
  assert.deepEqual(
    shouldHonorAlreadySatisfiedNoToolRun("implementer", "ALREADY_SATISFIED: ok", undefined),
    { reason: "ok" }
  );
  assert.deepEqual(shouldHonorAlreadySatisfiedNoToolRun("implementer", "ALREADY_SATISFIED: ok", []), { reason: "ok" });
  assert.deepEqual(shouldHonorAlreadySatisfiedNoToolRun("reviewer", "ALREADY_SATISFIED: clean", []), { reason: "clean" });
});

test("shouldHonorAlreadySatisfiedNoToolRun: tools present => no honor (tools win)", () => {
  assert.equal(
    shouldHonorAlreadySatisfiedNoToolRun("implementer", "ALREADY_SATISFIED: x", [{ tool: "readFile", args: { path: "a" } }]),
    null
  );
});

test("shouldHonorAlreadySatisfiedNoToolRun: validator/planner excluded", () => {
  assert.equal(shouldHonorAlreadySatisfiedNoToolRun("validator", "ALREADY_SATISFIED: x", []), null);
  assert.equal(shouldHonorAlreadySatisfiedNoToolRun("planner", "ALREADY_SATISFIED: x", []), null);
});

test("missionQueueHasAlreadySatisfiedWorkItem", () => {
  assert.equal(missionQueueHasAlreadySatisfiedWorkItem([{ completionKind: "already_satisfied" }]), true);
  assert.equal(missionQueueHasAlreadySatisfiedWorkItem([{ completionKind: undefined }]), false);
});

test("missionQueueHasApplyPatchNoopWorkItem", () => {
  assert.equal(missionQueueHasApplyPatchNoopWorkItem([{ completionKind: "apply_patch_noop" }]), true);
  assert.equal(missionQueueHasApplyPatchNoopWorkItem([{ completionKind: "already_satisfied" }]), false);
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

test("Case 1 — partial mission: implementer done already_satisfied + validator todo => unresolved work, no collapse", () => {
  const q: WorkItem[] = [
    {
      id: "i1",
      title: "Impl",
      role: "implementer",
      status: "done",
      prompt: "p",
      completionKind: "already_satisfied"
    },
    { id: "v1", title: "Val", role: "validator", status: "todo", prompt: "p" }
  ];
  const m = baseMission({ queue: q, validationState: "pending" });
  assert.equal(hasRequiredUnresolvedWork(m), true);
  assert.equal(shouldCollapseToComplete(m), false);
});

test("Case 1b — partial mission: validation passed but validator still todo => still no collapse", () => {
  const q: WorkItem[] = [
    {
      id: "i1",
      title: "Impl",
      role: "implementer",
      status: "done",
      prompt: "p",
      completionKind: "already_satisfied"
    },
    { id: "v1", title: "Val", role: "validator", status: "todo", prompt: "p" }
  ];
  const m = baseMission({ queue: q, validationState: "passed" });
  assert.equal(shouldCollapseToComplete(m), false);
});

test("Case 3 — mixed mission: already_satisfied + normal done + reviewer + validator, all done, validation passed => collapse", () => {
  const q: WorkItem[] = [
    {
      id: "i1",
      title: "Impl A",
      role: "implementer",
      status: "done",
      prompt: "p",
      completionKind: "already_satisfied"
    },
    { id: "i2", title: "Impl B", role: "implementer", status: "done", prompt: "p" },
    { id: "r1", title: "Review", role: "reviewer", status: "done", prompt: "p" },
    { id: "v1", title: "Validate", role: "validator", status: "done", prompt: "p" }
  ];
  const m = baseMission({ queue: q, validationState: "passed" });
  assert.equal(hasRequiredUnresolvedWork(m), false);
  assert.equal(shouldCollapseToComplete(m), true);
  assert.equal(
    resolveCompletionReasonForCompletedMission(undefined, q),
    "already_satisfied_no_tool_run"
  );
});

test("Case 4 — no false completion: validation failed despite done already_satisfied + todo validator", () => {
  const q: WorkItem[] = [
    {
      id: "i1",
      title: "Impl",
      role: "implementer",
      status: "done",
      prompt: "p",
      completionKind: "already_satisfied"
    },
    { id: "v1", title: "Val", role: "validator", status: "todo", prompt: "p" }
  ];
  const m = baseMission({ queue: q, validationState: "failed" });
  assert.equal(shouldCollapseToComplete(m), false);
});

test("Case 4b — no false completion: validation passed but required work still running", () => {
  const q: WorkItem[] = [
    {
      id: "i1",
      title: "Impl",
      role: "implementer",
      status: "done",
      prompt: "p",
      completionKind: "already_satisfied"
    },
    { id: "v1", title: "Val", role: "validator", status: "running", prompt: "p" }
  ];
  const m = baseMission({ queue: q, validationState: "passed" });
  assert.equal(shouldCollapseToComplete(m), false);
});

test("Case 4c — no false completion: validation pending => no collapse", () => {
  const q: WorkItem[] = [
    {
      id: "i1",
      title: "Impl",
      role: "implementer",
      status: "done",
      prompt: "p",
      completionKind: "already_satisfied"
    }
  ];
  const m = baseMission({ queue: q, validationState: "pending" });
  assert.equal(shouldCollapseToComplete(m), false);
});

test("Case 5 — tools win: ALREADY_SATISFIED line present but toolCalls non-empty => no honor", () => {
  assert.equal(
    shouldHonorAlreadySatisfiedNoToolRun(
      "implementer",
      "ALREADY_SATISFIED: x\nTOOL:{\"tool\":\"readFile\",\"args\":{\"path\":\"a\"}}",
      [{ tool: "readFile", args: { path: "a" } }]
    ),
    null
  );
});

test("Case 6 — completionReason: stale_patch pending beats queue already_satisfied metadata", () => {
  assert.equal(
    resolveCompletionReasonForCompletedMission("stale_patch_but_goal_already_met", [
      { completionKind: "already_satisfied" }
    ]),
    "stale_patch_but_goal_already_met"
  );
});

test("Case 6b — completionReason: no pending + queue has already_satisfied => already_satisfied_no_tool_run", () => {
  assert.equal(resolveCompletionReasonForCompletedMission(undefined, [{ completionKind: "already_satisfied" }]), "already_satisfied_no_tool_run");
});

test("Case 6c — completionReason: no pending + no queue flag => undefined", () => {
  assert.equal(resolveCompletionReasonForCompletedMission(undefined, [{ completionKind: undefined }]), undefined);
});

test("Case 6d — completionReason: only apply_patch_noop in queue => apply_patch_noop_success", () => {
  assert.equal(
    resolveCompletionReasonForCompletedMission(undefined, [{ completionKind: "apply_patch_noop" }]),
    "apply_patch_noop_success"
  );
});

test("Case 6e — completionReason: already_satisfied beats apply_patch_noop for mission metadata", () => {
  assert.equal(
    resolveCompletionReasonForCompletedMission(undefined, [
      { completionKind: "apply_patch_noop" },
      { completionKind: "already_satisfied" }
    ]),
    "already_satisfied_no_tool_run"
  );
});

test("all required resolved including only already_satisfied implementer + validation passed => collapse", () => {
  const q: WorkItem[] = [
    {
      id: "i1",
      title: "Impl",
      role: "implementer",
      status: "done",
      prompt: "p",
      completionKind: "already_satisfied"
    }
  ];
  const m = baseMission({ queue: q, validationState: "passed" });
  assert.equal(shouldCollapseToComplete(m), true);
});
