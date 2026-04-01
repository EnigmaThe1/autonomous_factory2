import test from "node:test";
import assert from "node:assert/strict";
import {
  presentBundleOperatorUiFeedback,
  presentResolveApprovalOutcome,
  presentResumeMissionOutcome,
  presentStartMissionOutcome
} from "../ui/missionActionOutcomePresentation";

test("presentStartMissionOutcome: scheduled_pass", () => {
  const msg = presentStartMissionOutcome({ mission: { id: "m1" } as any, pass: { kind: "scheduled_pass", missionId: "m1" } });
  assert.match(msg, /scheduled/i);
  assert.ok(!/completed/i.test(msg));
});

test("presentResumeMissionOutcome: joined_in_flight_pass", () => {
  const msg = presentResumeMissionOutcome({ kind: "joined_in_flight_pass", missionId: "m1" });
  assert.match(msg, /already running/i);
  assert.ok(!/completed/i.test(msg));
});

test("presentResumeMissionOutcome: gated_awaiting_input", () => {
  const msg = presentResumeMissionOutcome({ kind: "gated_awaiting_input", missionId: "m1" });
  assert.match(msg, /waiting for input/i);
  assert.ok(!/completed/i.test(msg));
});

test("presentResumeMissionOutcome: gated_pending_approval", () => {
  const msg = presentResumeMissionOutcome({ kind: "gated_pending_approval", missionId: "m1" });
  assert.match(msg, /waiting for approval/i);
  assert.ok(!/completed/i.test(msg));
});

test("presentResumeMissionOutcome: noop_terminal", () => {
  const msg = presentResumeMissionOutcome({ kind: "noop_terminal", missionId: "m1", status: "blocked" });
  assert.match(msg, /terminal/i);
  assert.match(msg, /no new run was started/i);
  assert.ok(!/completed/i.test(msg));
});

test("presentResolveApprovalOutcome: approved_continuation_scheduled", () => {
  const msg = presentResolveApprovalOutcome({ kind: "approved_continuation_scheduled", missionId: "m1" });
  assert.match(msg, /scheduled/i);
  assert.ok(!/completed/i.test(msg));
});

test("presentResolveApprovalOutcome: rejected_mission_blocked", () => {
  const msg = presentResolveApprovalOutcome({ kind: "rejected_mission_blocked", missionId: "m1", statusAfter: "blocked" });
  assert.match(msg, /rejected/i);
  assert.ok(!/completed/i.test(msg));
});

test("presentResolveApprovalOutcome: noop_unknown_approval", () => {
  const msg = presentResolveApprovalOutcome({ kind: "noop_unknown_approval", missionId: "m1", approvalId: "a1" });
  assert.match(msg, /not found|already resolved/i);
});

test("presentBundleOperatorUiFeedback: resolved vs noop and no completion claim", () => {
  const okApprove = presentBundleOperatorUiFeedback({ approved: true, itemCount: 3, anyResolved: true });
  assert.match(okApprove, /Bundle approved \(3 item\(s\)\)/);
  assert.match(okApprove, /not necessarily complete/i);
  assert.ok(!/completed\.?$/i.test(okApprove.trim()));

  const noopApprove = presentBundleOperatorUiFeedback({ approved: true, itemCount: 2, anyResolved: false });
  assert.match(noopApprove, /no requests resolved/i);

  const okReject = presentBundleOperatorUiFeedback({ approved: false, itemCount: 4, anyResolved: true });
  assert.match(okReject, /Bundle rejected \(4 item\(s\)\)/);
  assert.match(okReject, /not complete/i);
});

