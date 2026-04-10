import test from "node:test";
import assert from "node:assert/strict";
import {
  baseWorkItemTitleForRetryMatching,
  dependencyEdgeSatisfied,
  hasRequiredBlockingOrFailedWork,
  hasRequiredUnresolvedWork,
  isFailedWorkItemSupersededBySuccessfulRetry,
  isRequiredForCompletion,
  isRequiredWorkSettledForCompletion,
  obsolescentTodoSkipReason,
  queueHasCompletionBlockingFailedOrBlocked,
  shouldAutoSkipObsolescentReviewerWork
} from "../missions/requiredWork";
import { shouldCollapseToComplete } from "../missions/missionCompletionCollapse";
import { resolveCompletionStatus } from "../missions/LifecycleRules";
import { Mission, MissionPolicy, WorkItem } from "../types";

function mission(over: Partial<Mission> & { queue?: WorkItem[] }): Mission {
  const policy: MissionPolicy = {
    closureRequired: true,
    requireReviewerBeforeComplete: true,
    requireValidatorBeforeComplete: true,
    requireImplementerBeforeComplete: true,
    autoContinue: true,
    maxAutoRounds: 24,
    minCompletedWorkItems: 4,
    stallReplanThreshold: 3,
    policyPreset: "balanced"
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
    validationState: over.validationState ?? "pending",
    ...over
  };
}

test("isRequiredForCompletion: default true", () => {
  assert.equal(isRequiredForCompletion({ id: "a", title: "t", role: "planner", status: "todo", prompt: "p" }), true);
  assert.equal(isRequiredForCompletion({ id: "a", title: "t", role: "planner", status: "todo", prompt: "p", requiredForCompletion: false }), false);
});

test("dependencyEdgeSatisfied: done and skipped", () => {
  assert.equal(dependencyEdgeSatisfied("done"), true);
  assert.equal(dependencyEdgeSatisfied("skipped"), true);
  assert.equal(dependencyEdgeSatisfied("todo"), false);
  assert.equal(dependencyEdgeSatisfied(undefined), false);
});

test("hasRequiredUnresolvedWork", () => {
  const q: WorkItem[] = [{ id: "1", title: "x", role: "implementer", status: "todo", prompt: "p" }];
  assert.equal(hasRequiredUnresolvedWork(mission({ queue: q })), true);
  assert.equal(hasRequiredUnresolvedWork(mission({ queue: [{ ...q[0], requiredForCompletion: false }] })), false);
  assert.equal(hasRequiredUnresolvedWork(mission({ queue: [{ ...q[0], status: "skipped" }] })), false);
});

test("hasRequiredBlockingOrFailedWork: blocked/failed required items; not confused with unresolved", () => {
  const implBlocked: WorkItem[] = [
    { id: "i", title: "impl", role: "implementer", status: "blocked", prompt: "p" },
    { id: "r", title: "rev", role: "reviewer", status: "done", prompt: "p" },
    { id: "v", title: "val", role: "validator", status: "done", prompt: "p" }
  ];
  const m = mission({ queue: implBlocked, validationState: "passed" });
  assert.equal(hasRequiredUnresolvedWork(m), false);
  assert.equal(hasRequiredBlockingOrFailedWork(m), true);
  assert.equal(isRequiredWorkSettledForCompletion(m), false);
});

test("isRequiredWorkSettledForCompletion: true when all required done or skipped", () => {
  const q: WorkItem[] = [
    { id: "p", title: "plan", role: "planner", status: "done", prompt: "p" },
    { id: "i", title: "impl", role: "implementer", status: "done", prompt: "p" },
    { id: "r", title: "rev", role: "reviewer", status: "skipped", output: "superseded", prompt: "p" }
  ];
  const m = mission({ queue: q });
  assert.equal(isRequiredWorkSettledForCompletion(m), true);
  assert.equal(hasRequiredBlockingOrFailedWork(m), false);
});

test("hasRequiredBlockingOrFailedWork ignores non-required blocked rows", () => {
  const q: WorkItem[] = [
    { id: "i", title: "impl", role: "implementer", status: "done", prompt: "p" },
    {
      id: "tail",
      title: "optional",
      role: "reviewer",
      status: "blocked",
      prompt: "p",
      requiredForCompletion: false
    }
  ];
  const m = mission({ queue: q });
  assert.equal(hasRequiredBlockingOrFailedWork(m), false);
  assert.equal(isRequiredWorkSettledForCompletion(m), true);
});

test("terminal readiness vs shouldCollapseToComplete and resolveCompletionStatus", () => {
  const settledPassed: WorkItem[] = [
    { id: "p", title: "plan", role: "planner", status: "done", prompt: "p" },
    { id: "i", title: "impl", role: "implementer", status: "done", prompt: "p" },
    { id: "r", title: "rev", role: "reviewer", status: "done", prompt: "p" },
    { id: "v", title: "val", role: "validator", status: "done", prompt: "p" }
  ];
  const ok = mission({ queue: settledPassed, validationState: "passed", status: "running" });
  assert.equal(isRequiredWorkSettledForCompletion(ok), true);
  assert.equal(shouldCollapseToComplete(ok), true);
  assert.equal(resolveCompletionStatus(false, true, "passed"), "completed");

  const implFailed: WorkItem[] = [
    { id: "i", title: "impl", role: "implementer", status: "failed", prompt: "p" },
    { id: "r", title: "rev", role: "reviewer", status: "done", prompt: "p" },
    { id: "v", title: "val", role: "validator", status: "done", prompt: "p" }
  ];
  const bad = mission({ queue: implFailed, validationState: "passed" });
  assert.equal(isRequiredWorkSettledForCompletion(bad), false);
  assert.equal(hasRequiredBlockingOrFailedWork(bad), true);
  assert.equal(shouldCollapseToComplete(bad), false);
  assert.equal(resolveCompletionStatus(true, true, "passed"), "blocked");
});

test("baseWorkItemTitleForRetryMatching strips nested retry suffixes", () => {
  assert.equal(baseWorkItemTitleForRetryMatching("Phase 4 and 5 (retry 1)"), "Phase 4 and 5");
  assert.equal(baseWorkItemTitleForRetryMatching("Initial planning"), "Initial planning");
});

test("superseded failed row: history kept but does not block completion", () => {
  const q: WorkItem[] = [
    { id: "f1", title: "Initial planning", role: "planner", status: "failed", prompt: "p", output: "timeout" },
    {
      id: "d1",
      title: "Initial planning (retry 1)",
      role: "planner",
      status: "done",
      prompt: "p",
      retryCount: 1
    },
    { id: "i", title: "impl", role: "implementer", status: "done", prompt: "p" },
    { id: "r", title: "rev", role: "reviewer", status: "done", prompt: "p" },
    { id: "v", title: "val", role: "validator", status: "done", prompt: "p" }
  ];
  const m = mission({ queue: q, validationState: "passed" });
  assert.equal(isFailedWorkItemSupersededBySuccessfulRetry(m, q[0]), true);
  assert.equal(queueHasCompletionBlockingFailedOrBlocked(m), false);
  assert.equal(hasRequiredBlockingOrFailedWork(m), false);
  assert.equal(isRequiredWorkSettledForCompletion(m), true);
  assert.equal(shouldCollapseToComplete(m), true);
  assert.equal(resolveCompletionStatus(false, true, "passed"), "completed");
});

test("failed row without successful retry still blocks", () => {
  const q: WorkItem[] = [
    { id: "bad", title: "Phase 2 and 3", role: "implementer", status: "failed", prompt: "p" },
    { id: "i2", title: "later impl", role: "implementer", status: "done", prompt: "p" },
    { id: "r", title: "rev", role: "reviewer", status: "done", prompt: "p" },
    { id: "v", title: "val", role: "validator", status: "done", prompt: "p" }
  ];
  const m = mission({ queue: q, validationState: "passed" });
  assert.equal(isFailedWorkItemSupersededBySuccessfulRetry(m, q[0]), false);
  assert.equal(queueHasCompletionBlockingFailedOrBlocked(m), true);
});

test("non-required failed tail does not block completion", () => {
  const q: WorkItem[] = [
    { id: "p", title: "plan", role: "planner", status: "done", prompt: "p" },
    { id: "i", title: "impl", role: "implementer", status: "done", prompt: "p" },
    { id: "r", title: "rev", role: "reviewer", status: "done", prompt: "p" },
    { id: "v", title: "val", role: "validator", status: "done", prompt: "p" },
    {
      id: "tail",
      title: "optional probe",
      role: "researcher",
      status: "failed",
      prompt: "p",
      requiredForCompletion: false
    }
  ];
  const m = mission({ queue: q, validationState: "passed" });
  assert.equal(queueHasCompletionBlockingFailedOrBlocked(m), false);
  assert.equal(shouldCollapseToComplete(m), true);
});

test("shouldAutoSkipObsolescentReviewerWork when prior reviewer done and passed", () => {
  const q: WorkItem[] = [
    { id: "r1", title: "Review tranche", role: "reviewer", status: "done", prompt: "a" },
    { id: "r2", title: "Review latest", role: "reviewer", status: "todo", prompt: "b" }
  ];
  const m = mission({ queue: q, validationState: "passed" });
  assert.equal(shouldAutoSkipObsolescentReviewerWork(m, q[1]), true);
  assert.equal(shouldAutoSkipObsolescentReviewerWork(m, q[0]), false);
});

test("obsolescentTodoSkipReason for redundant validator", () => {
  const q: WorkItem[] = [
    { id: "v1", title: "first", role: "validator", status: "done", prompt: "p" },
    { id: "v2", title: "second", role: "validator", status: "todo", prompt: "p" }
  ];
  const m = mission({ queue: q, validationState: "passed" });
  assert.ok(obsolescentTodoSkipReason(m, q[1])?.includes("redundant validator"));
});
