import test from "node:test";
import assert from "node:assert/strict";
import { buildStallRecoveryReplanPrompt } from "../missions/stallRecoveryReplanContext";
import type { Mission } from "../types";

function miniMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    title: "T",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "queued",
    activeProviderId: "ollama",
    queue: [
      { id: "w1", title: "Impl", role: "implementer", status: "running", prompt: "x" },
      { id: "w2", title: "Rev", role: "reviewer", status: "todo", prompt: "y" }
    ],
    memory: [],
    events: [
      { id: "e1", ts: 1, level: "info", source: "tool:readFile", message: "/a.ts" },
      { id: "e2", ts: 2, level: "warn", source: "orchestrator", message: "Something" }
    ],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: {
      closureRequired: false,
      requireReviewerBeforeComplete: false,
      requireValidatorBeforeComplete: false,
      requireImplementerBeforeComplete: false,
      autoContinue: true,
      maxAutoRounds: 50,
      minCompletedWorkItems: 0,
      stallReplanThreshold: 3
    },
    ...overrides
  } as Mission;
}

test("buildStallRecoveryReplanPrompt includes stall metrics and tool tail", () => {
  const p = buildStallRecoveryReplanPrompt(miniMission(), {
    stalledHeartbeats: 5,
    threshold: 3,
    replanAttempt: 2,
    maxAutoReplans: 4
  });
  assert.match(p, /threshold 3/);
  assert.match(p, /attempt 2 of 4/);
  assert.match(p, /tool:readFile/);
  assert.match(p, /\[running\] implementer/);
  assert.match(p, /Your task/i);
});
