import test from "node:test";
import assert from "node:assert/strict";
import {
  OPERATOR_ACTION_BUNDLE_APPROVED_MESSAGE,
  OPERATOR_ACTION_BUNDLE_REJECTED_MESSAGE,
  presentResolveApprovalOutcomeEvent,
  presentResumeMissionOutcomeEvent,
  presentStartMissionOutcomeEvent
} from "../missions/missionActionOutcomeEventPresentation";
import type { Mission } from "../types";
import type { StartMissionResult } from "../missions/missionActionResult";
import {
  MISSION_CARD_OPERATOR_ACTION_HEADLINE_MAX_AGE_MS,
  missionCardLatestOperatorActionHeadline,
  missionListLatestOperatorActionHeadlinesForMissions,
  operatorActionEventTimelineHeadline,
  operatorActionHeadlinesByEventIdForMission
} from "../missions/missionOperatorActionEventPresentation";

const dummyMission = { id: "m" } as Mission;
const startOut: StartMissionResult = {
  mission: dummyMission,
  pass: { kind: "scheduled_pass", missionId: "m" }
};

test("operatorActionEventTimelineHeadline: start, resume static, approval, bundle", () => {
  assert.equal(operatorActionEventTimelineHeadline(presentStartMissionOutcomeEvent(startOut)), "Start: execution scheduled");
  assert.equal(
    operatorActionEventTimelineHeadline(presentResumeMissionOutcomeEvent({ kind: "joined_in_flight_pass", missionId: "m" })!),
    "Resume: joined active pass"
  );
  assert.equal(
    operatorActionEventTimelineHeadline(
      presentResumeMissionOutcomeEvent({ kind: "gated_awaiting_input", missionId: "m" })!
    ),
    "Resume: gated — waiting for input"
  );
  assert.equal(
    operatorActionEventTimelineHeadline(
      presentResumeMissionOutcomeEvent({ kind: "gated_pending_approval", missionId: "m" })!
    ),
    "Resume: gated — waiting for approval"
  );
  assert.equal(
    operatorActionEventTimelineHeadline(presentResolveApprovalOutcomeEvent({ kind: "approved_continuation_scheduled", missionId: "m" })!),
    "Approval: continuation scheduled"
  );
  assert.equal(
    operatorActionEventTimelineHeadline(
      presentResolveApprovalOutcomeEvent({ kind: "rejected_mission_blocked", missionId: "m", statusAfter: "blocked" })!
    ),
    "Approval: rejected — mission blocked"
  );
  assert.equal(operatorActionEventTimelineHeadline(OPERATOR_ACTION_BUNDLE_APPROVED_MESSAGE), "Bundle: continuation scheduled");
  assert.equal(operatorActionEventTimelineHeadline(OPERATOR_ACTION_BUNDLE_REJECTED_MESSAGE), "Bundle: rejected — mission blocked");
});

test("operatorActionEventTimelineHeadline: dynamic resume pass + terminal noop", () => {
  assert.equal(
    operatorActionEventTimelineHeadline(
      presentResumeMissionOutcomeEvent({ kind: "ran_pass", missionId: "m", statusAfterPass: "blocked" })!
    ),
    "Resume: pass ended (blocked)"
  );
  assert.equal(
    operatorActionEventTimelineHeadline(
      presentResumeMissionOutcomeEvent({ kind: "noop_terminal", missionId: "m", status: "completed" })!
    ),
    "Resume: no-op (already completed)"
  );
});

test("operatorActionEventTimelineHeadline: unknown operator message returns undefined", () => {
  assert.equal(operatorActionEventTimelineHeadline("Custom future operator-action copy"), undefined);
  assert.equal(operatorActionEventTimelineHeadline(""), undefined);
});

test("operatorActionHeadlinesByEventIdForMission: maps known operator-action events by id", () => {
  const msg = "Resume requested; joined the active run pass.";
  const m: Mission = {
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
      stallReplanThreshold: 3,
      policyPreset: "balanced",
      requireValidationEvidence: true
    },
    queue: [],
    memory: [],
    events: [
      { id: "e-op", ts: 1, level: "info", source: "operator-action", message: msg },
      { id: "e-or", ts: 2, level: "info", source: "orchestrator", message: "Something happened." }
    ],
    checkpoints: [],
    approvals: []
  };
  const map = operatorActionHeadlinesByEventIdForMission(m);
  assert.deepEqual(map, { "e-op": "Resume: joined active pass" });
});

test("operatorActionHeadlinesByEventIdForMission: skips operator-action without usable event id", () => {
  const msg = "Resume requested; joined the active run pass.";
  const base = {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "running" as const,
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
      stallReplanThreshold: 3,
      policyPreset: "balanced" as const,
      requireValidationEvidence: true
    },
    queue: [],
    memory: [],
    checkpoints: [],
    approvals: []
  };
  assert.equal(
    operatorActionHeadlinesByEventIdForMission({
      ...base,
      events: [{ id: "", ts: 1, level: "info", source: "operator-action", message: msg }]
    }),
    undefined
  );
  assert.equal(
    operatorActionHeadlinesByEventIdForMission({
      ...base,
      events: [{ id: "   ", ts: 1, level: "info", source: "operator-action", message: msg }]
    }),
    undefined
  );
  const map = operatorActionHeadlinesByEventIdForMission({
    ...base,
    events: [
      { id: "good", ts: 1, level: "info", source: "operator-action", message: msg },
      { id: "", ts: 2, level: "info", source: "operator-action", message: msg }
    ]
  });
  assert.deepEqual(map, { good: "Resume: joined active pass" });
});

test("operatorActionHeadlinesByEventIdForMission: undefined when no mappable operator-action", () => {
  assert.equal(operatorActionHeadlinesByEventIdForMission(undefined), undefined);
  const m: Mission = {
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
      stallReplanThreshold: 3,
      policyPreset: "balanced",
      requireValidationEvidence: true
    },
    queue: [],
    memory: [],
    events: [{ id: "e1", ts: 1, level: "info", source: "operator-action", message: "Totally unknown copy." }],
    checkpoints: [],
    approvals: []
  };
  assert.equal(operatorActionHeadlinesByEventIdForMission(m), undefined);
});

const policyBase: Mission["policy"] = {
  closureRequired: true,
  requireReviewerBeforeComplete: true,
  requireValidatorBeforeComplete: true,
  requireImplementerBeforeComplete: true,
  autoContinue: true,
  maxAutoRounds: 24,
  minCompletedWorkItems: 1,
  stallReplanThreshold: 3,
  policyPreset: "balanced",
  requireValidationEvidence: true
};

function miniMissionForCard(overrides: Partial<Mission>): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "queued",
    activeProviderId: "p",
    currentStep: 0,
    policy: policyBase,
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    ...overrides
  };
}

test("missionCardLatestOperatorActionHeadline: latest mappable operator-action only", () => {
  const t0 = 5_000_000;
  const joined = presentResumeMissionOutcomeEvent({ kind: "joined_in_flight_pass", missionId: "m1" })!;
  const m = miniMissionForCard({
    status: "running",
    events: [
      { id: "e0", ts: t0, level: "info", source: "orchestrator", message: "noise" },
      { id: "e1", ts: t0 + 1, level: "info", source: "operator-action", message: joined }
    ]
  });
  assert.equal(missionCardLatestOperatorActionHeadline(m, t0 + 10_000), "Resume: joined active pass");
});

test("missionCardLatestOperatorActionHeadline: unknown latest operator-action message returns undefined", () => {
  const m = miniMissionForCard({
    events: [{ id: "e1", ts: 100, level: "info", source: "operator-action", message: "Unknown operator copy." }]
  });
  assert.equal(missionCardLatestOperatorActionHeadline(m, 200), undefined);
});

test("missionCardLatestOperatorActionHeadline: terminal missions omitted", () => {
  const msg = presentStartMissionOutcomeEvent(startOut);
  const mDone = miniMissionForCard({
    status: "completed",
    events: [{ id: "e1", ts: 100, level: "info", source: "operator-action", message: msg }]
  });
  assert.equal(missionCardLatestOperatorActionHeadline(mDone, 200), undefined);
});

test("missionCardLatestOperatorActionHeadline: stale operator-action omitted", () => {
  const msg = presentStartMissionOutcomeEvent(startOut);
  const oldTs = 1_000_000;
  const now = oldTs + MISSION_CARD_OPERATOR_ACTION_HEADLINE_MAX_AGE_MS + 1;
  const m = miniMissionForCard({
    events: [{ id: "e1", ts: oldTs, level: "info", source: "operator-action", message: msg }]
  });
  assert.equal(missionCardLatestOperatorActionHeadline(m, now), undefined);
});

test("missionListLatestOperatorActionHeadlinesForMissions: per-mission map", () => {
  const t0 = 10_000_000;
  const a = miniMissionForCard({
    id: "a",
    events: [
      {
        id: "e1",
        ts: t0,
        level: "info",
        source: "operator-action",
        message: presentResolveApprovalOutcomeEvent({ kind: "approved_continuation_scheduled", missionId: "a" })!
      }
    ]
  });
  const b = miniMissionForCard({ id: "b", events: [] });
  const map = missionListLatestOperatorActionHeadlinesForMissions([a, b], t0 + 1000);
  assert.deepEqual(map, { a: "Approval: continuation scheduled" });
});
