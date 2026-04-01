import test from "node:test";
import assert from "node:assert/strict";
import type { Mission, WorkItem } from "../types";
import {
  focusedMissionRequiredWorkHintForSnapshot,
  missionRequiredWorkOperatorHint
} from "../missions/missionRequiredWorkPresentation";

const basePolicy = {
  closureRequired: true,
  requireReviewerBeforeComplete: true,
  requireValidatorBeforeComplete: true,
  requireImplementerBeforeComplete: true,
  autoContinue: true,
  maxAutoRounds: 24,
  minCompletedWorkItems: 4,
  stallReplanThreshold: 3
};

function miniMission(overrides: Partial<Mission> & { queue?: WorkItem[] }): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "running",
    activeProviderId: "p",
    currentStep: 0,
    policy: basePolicy,
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    validationState: "pending",
    ...overrides
  };
}

test("missionRequiredWorkOperatorHint: open required work", () => {
  const m = miniMission({
    queue: [
      {
        id: "w1",
        title: "do",
        role: "implementer",
        status: "todo",
        prompt: "x"
      }
    ]
  });
  assert.equal(missionRequiredWorkOperatorHint(m), "Required work: still open (todo or in progress).");
});

test("missionRequiredWorkOperatorHint: blocked/failed takes precedence over open", () => {
  const m = miniMission({
    queue: [
      {
        id: "w1",
        title: "fix",
        role: "implementer",
        status: "failed",
        prompt: "x"
      },
      {
        id: "w2",
        title: "next",
        role: "reviewer",
        status: "todo",
        prompt: "y"
      }
    ]
  });
  const h = missionRequiredWorkOperatorHint(m);
  assert.match(h, /blocked or failed/);
  assert.ok(!h.includes("still open"));
});

test("missionRequiredWorkOperatorHint: validation passed + required implementer blocked adds honesty clause", () => {
  const m = miniMission({
    validationState: "passed",
    queue: [
      {
        id: "w1",
        title: "impl",
        role: "implementer",
        status: "blocked",
        prompt: "x"
      }
    ]
  });
  const h = missionRequiredWorkOperatorHint(m);
  assert.match(h, /blocked or failed/);
  assert.match(h, /Validation passed does not clear blocked or failed required implementer work/);
});

test("missionRequiredWorkOperatorHint: settled when required lane is done or skipped", () => {
  const m = miniMission({
    queue: [
      {
        id: "w1",
        title: "done",
        role: "implementer",
        status: "done",
        prompt: "x"
      },
      {
        id: "w2",
        title: "skip",
        role: "reviewer",
        status: "skipped",
        prompt: "y",
        output: "skipped"
      }
    ]
  });
  const h = missionRequiredWorkOperatorHint(m);
  assert.match(h, /^Required work: settled/);
  assert.match(h, /Mission completion still depends on validation and policy/);
});

test("focusedMissionRequiredWorkHintForSnapshot: undefined for completed/cancelled", () => {
  assert.equal(
    focusedMissionRequiredWorkHintForSnapshot(miniMission({ status: "completed", queue: [] })),
    undefined
  );
  assert.equal(
    focusedMissionRequiredWorkHintForSnapshot(miniMission({ status: "cancelled", queue: [] })),
    undefined
  );
});

test("focusedMissionRequiredWorkHintForSnapshot: mirrors operator hint for non-terminal", () => {
  const m = miniMission({
    queue: [{ id: "w1", title: "t", role: "planner", status: "running", prompt: "p" }]
  });
  assert.equal(focusedMissionRequiredWorkHintForSnapshot(m), missionRequiredWorkOperatorHint(m));
});

test("missionRequiredWorkOperatorHint: optional blocked work does not trigger blocked copy", () => {
  const m = miniMission({
    queue: [
      {
        id: "w1",
        title: "opt",
        role: "reviewer",
        status: "blocked",
        prompt: "x",
        requiredForCompletion: false
      },
      {
        id: "w2",
        title: "req",
        role: "implementer",
        status: "todo",
        prompt: "y"
      }
    ]
  });
  assert.equal(missionRequiredWorkOperatorHint(m), "Required work: still open (todo or in progress).");
});
