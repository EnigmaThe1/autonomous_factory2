import test from "node:test";
import assert from "node:assert/strict";
import type { Mission } from "../types";
import {
  presentResolveApprovalOutcomeEvent,
  presentResumeMissionOutcomeEvent,
  presentStartMissionOutcomeEvent
} from "../missions/missionActionOutcomeEventPresentation";
import { saveOperatorActionMissionEventIfChanged } from "../missions/missionActionOutcomeEventLogging";

function miniMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "queued",
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

test("event mapping: startMission scheduled_pass logs event text", async () => {
  const store = {
    get: (_: string) => miniMission(),
    saveEvent: async (_: string, e: any) => events.push(e)
  } as any;
  const events: any[] = [];
  const started = { mission: { id: "m1" } as any, pass: { kind: "scheduled_pass", missionId: "m1" } };
  const msg = presentStartMissionOutcomeEvent(started as any);
  await saveOperatorActionMissionEventIfChanged({ store, missionId: "m1", message: msg });
  assert.equal(events.length, 1);
  assert.match(events[0].message, /start requested/i);
});

test("event mapping: resumeMission joined_in_flight_pass", () => {
  const msg = presentResumeMissionOutcomeEvent({ kind: "joined_in_flight_pass", missionId: "m1" });
  assert.match(msg || "", /joined/i);
  assert.ok(!/completed/i.test(msg || ""));
});

test("event mapping: resumeMission gated_awaiting_input", () => {
  const msg = presentResumeMissionOutcomeEvent({ kind: "gated_awaiting_input", missionId: "m1" });
  assert.match(msg || "", /waiting for input/i);
});

test("event mapping: resumeMission noop_terminal", () => {
  const msg = presentResumeMissionOutcomeEvent({ kind: "noop_terminal", missionId: "m1", status: "blocked" });
  assert.match(msg || "", /terminal/i);
});

test("event mapping: resolveApproval approved/rejected", () => {
  assert.match(presentResolveApprovalOutcomeEvent({ kind: "approved_continuation_scheduled", missionId: "m1" }) || "", /scheduled/i);
  assert.match(presentResolveApprovalOutcomeEvent({ kind: "rejected_mission_blocked", missionId: "m1", statusAfter: "blocked" }) || "", /remains blocked/i);
});

test("event mapping: unknown approval produces no event", () => {
  assert.equal(presentResolveApprovalOutcomeEvent({ kind: "noop_unknown_approval", missionId: "m1", approvalId: "a1" }), null);
});

test("anti-spam: identical consecutive event is not duplicated", async () => {
  const mission = miniMission({
    events: [{ id: "e1", ts: 1, level: "info", source: "operator-action", message: "X" }]
  });
  const events: any[] = [];
  const store = {
    get: (_: string) => mission,
    saveEvent: async (_: string, e: any) => events.push(e)
  } as any;
  await saveOperatorActionMissionEventIfChanged({ store, missionId: "m1", message: "X" });
  assert.equal(events.length, 0);
});

