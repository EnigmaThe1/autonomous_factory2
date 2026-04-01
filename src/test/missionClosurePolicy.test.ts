import test from "node:test";
import assert from "node:assert/strict";
import { computePlannerCoverageItems } from "../missions/missionClosurePolicy";
import type { Mission, WorkItem } from "../types";

function makeMission(queue: Partial<WorkItem>[] = []): Mission {
  return {
    id: "m1",
    title: "test",
    prompt: "test",
    createdAt: 1,
    updatedAt: 1,
    status: "running",
    activeProviderId: "openai",
    queue: queue.map((w, i) => ({
      id: `w${i}`,
      title: `work ${i}`,
      role: "planner" as const,
      status: "todo" as const,
      prompt: "do something",
      ...w
    })),
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: {
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
    },
    validationState: "pending",
    roundsCompleted: 0,
    runtime: {
      lastProgressAt: undefined,
      lastRunnerHeartbeatAt: undefined,
      stalledHeartbeats: 0,
      autoReplans: 0,
      loopGuardTrips: 0,
      runnerOwnerId: undefined,
      runnerLeaseExpiresAt: undefined
    }
  } as Mission;
}

test("computePlannerCoverageItems: returns all 3 roles when queue is empty", () => {
  const items = computePlannerCoverageItems(makeMission());
  assert.equal(items.length, 3);
  const roles = items.map((i) => i.role).sort();
  assert.deepEqual(roles, ["implementer", "reviewer", "validator"]);
  for (const item of items) {
    assert.equal(item.status, "todo");
    assert.ok(item.id.startsWith("work_"));
  }
});

test("computePlannerCoverageItems: skips roles already present with non-failed status", () => {
  const items = computePlannerCoverageItems(makeMission([
    { role: "implementer", status: "done" },
    { role: "reviewer", status: "running" }
  ]));
  assert.equal(items.length, 1);
  assert.equal(items[0].role, "validator");
});

test("computePlannerCoverageItems: failed roles are not counted as covered", () => {
  const items = computePlannerCoverageItems(makeMission([
    { role: "implementer", status: "failed" },
    { role: "reviewer", status: "done" },
    { role: "validator", status: "done" }
  ]));
  assert.equal(items.length, 1);
  assert.equal(items[0].role, "implementer");
});

test("computePlannerCoverageItems: returns empty when all roles present", () => {
  const items = computePlannerCoverageItems(makeMission([
    { role: "implementer", status: "todo" },
    { role: "reviewer", status: "done" },
    { role: "validator", status: "running" }
  ]));
  assert.equal(items.length, 0);
});

test("computePlannerCoverageItems: planner in queue does not satisfy implementer/reviewer/validator", () => {
  const items = computePlannerCoverageItems(makeMission([
    { role: "planner", status: "done" }
  ]));
  assert.equal(items.length, 3);
});

test("computePlannerCoverageItems: skipped status counts as covered", () => {
  const items = computePlannerCoverageItems(makeMission([
    { role: "implementer", status: "skipped" },
    { role: "reviewer", status: "skipped" },
    { role: "validator", status: "skipped" }
  ]));
  assert.equal(items.length, 0);
});
