import test from "node:test";
import assert from "node:assert/strict";
import { computeEffectiveMaxAutoRounds } from "../missions/adaptiveMissionScaling";
import type { Mission, MissionPolicy } from "../types";

const policy = (max: number): MissionPolicy => ({
  closureRequired: true,
  requireReviewerBeforeComplete: true,
  requireValidatorBeforeComplete: true,
  requireImplementerBeforeComplete: true,
  autoContinue: true,
  maxAutoRounds: max,
  minCompletedWorkItems: 2,
  stallReplanThreshold: 3
});

function miniMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "running",
    activeProviderId: "x",
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: policy(24),
    ...overrides
  } as Mission;
}

test("computeEffectiveMaxAutoRounds: fixed mode uses policy max", () => {
  const cfg = {
    get<T>(k: string, d?: T): T {
      if (k === "myAi.missions.scalingMode") return "fixed" as T;
      return d as T;
    }
  };
  const m = miniMission({ queue: [{ id: "a", title: "x", role: "implementer", status: "todo", prompt: "p" }] });
  assert.equal(computeEffectiveMaxAutoRounds(m, cfg), 24);
});

test("computeEffectiveMaxAutoRounds: adaptive grows with queue", () => {
  const cfg = {
    get<T>(k: string, d?: T): T {
      if (k === "myAi.missions.scalingMode") return "adaptive" as T;
      if (k === "myAi.missions.adaptiveMaxRounds") return 500 as T;
      if (k === "myAi.missions.adaptiveFailurePenaltyRounds") return 4 as T;
      if (k === "myAi.missions.adaptiveLoopGuardPenaltyRounds") return 8 as T;
      return d as T;
    }
  };
  const q = Array.from({ length: 5 }, (_, i) => ({
    id: `w${i}`,
    title: "t",
    role: "implementer" as const,
    status: "todo" as const,
    prompt: "p"
  }));
  const m = miniMission({ queue: q });
  assert.equal(computeEffectiveMaxAutoRounds(m, cfg), 24 + 5 * 2);
});

test("computeEffectiveMaxAutoRounds: adaptive penalizes failures and loop trips", () => {
  const cfg = {
    get<T>(k: string, d?: T): T {
      if (k === "myAi.missions.scalingMode") return "adaptive" as T;
      if (k === "myAi.missions.adaptiveMaxRounds") return 500 as T;
      if (k === "myAi.missions.adaptiveFailurePenaltyRounds") return 10 as T;
      if (k === "myAi.missions.adaptiveLoopGuardPenaltyRounds") return 5 as T;
      return d as T;
    }
  };
  const q = [
    { id: "w0", title: "t", role: "implementer" as const, status: "failed" as const, prompt: "p" },
    { id: "w1", title: "t", role: "implementer" as const, status: "todo" as const, prompt: "p" }
  ];
  const m = miniMission({ queue: q, runtime: { stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 2 } });
  const base = 24;
  const bonus = 2 * 2;
  const pen = 1 * 10 + 2 * 5;
  const raw = base + bonus - pen;
  assert.equal(computeEffectiveMaxAutoRounds(m, cfg), Math.min(Math.max(raw, base), 500));
});

test("computeEffectiveMaxAutoRounds: adaptive never below base", () => {
  const cfg = {
    get<T>(k: string, d?: T): T {
      if (k === "myAi.missions.scalingMode") return "adaptive" as T;
      if (k === "myAi.missions.adaptiveMaxRounds") return 900 as T;
      if (k === "myAi.missions.adaptiveFailurePenaltyRounds") return 50 as T;
      if (k === "myAi.missions.adaptiveLoopGuardPenaltyRounds") return 50 as T;
      return d as T;
    }
  };
  const q = Array.from({ length: 3 }, (_, i) => ({
    id: `w${i}`,
    title: "t",
    role: "implementer" as const,
    status: "failed" as const,
    prompt: "p"
  }));
  const m = miniMission({ queue: q, runtime: { stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 5 } });
  assert.equal(computeEffectiveMaxAutoRounds(m, cfg), 24);
});
