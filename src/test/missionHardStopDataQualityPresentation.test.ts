import test from "node:test";
import assert from "node:assert/strict";
import type { Mission, WorkItem } from "../types";
import { focusedMissionHardStopDataQualityHintForSnapshot } from "../missions/missionHardStopDataQualityPresentation";

function miniMission(queue: WorkItem[], overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "blocked",
    activeProviderId: "p",
    currentStep: 0,
    policy: {
      closureRequired: true,
      requireReviewerBeforeComplete: true,
      requireValidatorBeforeComplete: true,
      requireImplementerBeforeComplete: true,
      autoContinue: true,
      maxAutoRounds: 24,
      minCompletedWorkItems: 1,
      stallReplanThreshold: 3
    },
    queue,
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    validationState: "failed",
    ...overrides
  };
}

test("data quality hint when hardStopClass missing on blocked implementer", () => {
  const m = miniMission([
    { id: "wi", title: "i", role: "implementer", status: "blocked", prompt: "x" }
  ]);
  const h = focusedMissionHardStopDataQualityHintForSnapshot(m);
  assert.ok(h?.includes("no hardStopClass"));
  assert.ok(h?.includes("contract violation"));
});

test("data quality hint when hardStopClass invalid", () => {
  const m = miniMission([
    { id: "wi", title: "i", role: "implementer", status: "blocked", prompt: "x", hardStopClass: "garbage" as any }
  ]);
  const h = focusedMissionHardStopDataQualityHintForSnapshot(m);
  assert.ok(h?.includes("invalid hardStopClass"));
});

test("no hint when valid tool_failure", () => {
  const m = miniMission([
    { id: "wi", title: "i", role: "implementer", status: "failed", prompt: "x", hardStopClass: "tool_failure" }
  ]);
  assert.equal(focusedMissionHardStopDataQualityHintForSnapshot(m), undefined);
});

test("no hint for completed missions", () => {
  const m = miniMission(
    [{ id: "wi", title: "i", role: "implementer", status: "blocked", prompt: "x" }],
    { status: "completed" }
  );
  assert.equal(focusedMissionHardStopDataQualityHintForSnapshot(m), undefined);
});
