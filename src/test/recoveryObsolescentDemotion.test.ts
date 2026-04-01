import test from "node:test";
import assert from "node:assert/strict";
import { recoverInterruptedQueueItems } from "../missions/resumeRecovery";
import { applyObsolescentTodoDemotions, hasRequiredUnresolvedWork } from "../missions/requiredWork";
import { resolveCompletionStatus } from "../missions/LifecycleRules";
import { Mission, MissionPolicy, WorkItem } from "../types";

function policy(): MissionPolicy {
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

function missionWithQueue(queue: WorkItem[], validationState: Mission["validationState"]): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 0,
    updatedAt: 0,
    status: "running",
    activeProviderId: "x",
    queue,
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: policy(),
    validationState
  };
}

test("stale running superseded reviewer -> todo leaves required unresolved until obsolescent demotion", () => {
  const queue: WorkItem[] = [
    { id: "r1", title: "Review 1", role: "reviewer", status: "done", prompt: "p", output: "ok" },
    { id: "r2", title: "Extra review", role: "reviewer", status: "running", prompt: "p" }
  ];
  const m = missionWithQueue(queue, "passed");
  // `autoDemoteObsolescentQueueItems` only considers `todo` rows; stale `running` is not demoted until recovery.

  const { queue: recovered, recoveredCount } = recoverInterruptedQueueItems(queue);
  assert.equal(recoveredCount, 1);
  assert.equal(recovered[1].status, "todo");

  const afterRecover = missionWithQueue(recovered, "passed");
  assert.equal(hasRequiredUnresolvedWork(afterRecover), true);

  const demotedQueue = applyObsolescentTodoDemotions(m, recovered);
  const afterDemote = missionWithQueue(demotedQueue, "passed");
  assert.equal(demotedQueue[1].status, "skipped");
  assert.match(demotedQueue[1].output || "", /superseded reviewer/i);
  assert.equal(hasRequiredUnresolvedWork(afterDemote), false);

  const hasBlocked = demotedQueue.some((w) => w.status === "blocked" || w.status === "failed");
  assert.equal(resolveCompletionStatus(hasBlocked, afterDemote.policy.closureRequired, afterDemote.validationState), "completed");
});

test("recovered non-obsolescent todo is not demoted and remains required unresolved", () => {
  const queue: WorkItem[] = [
    { id: "i1", title: "Impl", role: "implementer", status: "running", prompt: "p" }
  ];
  const m = missionWithQueue(queue, "passed");
  const { queue: recovered } = recoverInterruptedQueueItems(queue);
  const demotedQueue = applyObsolescentTodoDemotions(m, recovered);
  assert.equal(demotedQueue[0].status, "todo");
  assert.equal(hasRequiredUnresolvedWork(missionWithQueue(demotedQueue, "passed")), true);
});
