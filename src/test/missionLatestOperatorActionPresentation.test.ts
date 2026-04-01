import test from "node:test";
import assert from "node:assert/strict";
import type { Mission } from "../types";
import { focusedMissionLatestOperatorActionNoteForSnapshot } from "../missions/missionLatestOperatorActionPresentation";

function miniMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "running",
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
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    validationState: "pending",
    ...overrides
  };
}

test("latest operator action note: shows compact note when operator-action event present", () => {
  const m = miniMission({
    events: [
      { id: "e1", ts: 1, level: "info", source: "other", message: "x" },
      { id: "e2", ts: 2, level: "info", source: "operator-action", message: "Resume requested; joined the active run pass." }
    ] as any
  });
  const note = focusedMissionLatestOperatorActionNoteForSnapshot(m);
  assert.ok(note?.startsWith("Latest operator action:"));
  assert.match(note || "", /joined the active run pass/i);
});

test("latest operator action note: none when no operator-action event", () => {
  const m = miniMission({ events: [{ id: "e1", ts: 1, level: "info", source: "x", message: "y" }] as any });
  assert.equal(focusedMissionLatestOperatorActionNoteForSnapshot(m), undefined);
});

test("latest operator action note: no note for completed/cancelled", () => {
  const base = { events: [{ id: "e2", ts: 2, level: "info", source: "operator-action", message: "Approval accepted; mission continuation was scheduled." }] as any };
  assert.equal(focusedMissionLatestOperatorActionNoteForSnapshot(miniMission({ ...base, status: "completed" })), undefined);
  assert.equal(focusedMissionLatestOperatorActionNoteForSnapshot(miniMission({ ...base, status: "cancelled" })), undefined);
});

