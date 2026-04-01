import test from "node:test";
import assert from "node:assert/strict";
import { missionBlockReasonFromDownstreamGate } from "../missions/missionBlockReasonCode";

test("missionBlockReasonFromDownstreamGate: awaiting_input maps to approval_pending", () => {
  assert.equal(missionBlockReasonFromDownstreamGate("policy_blocked", "awaiting_input"), "approval_pending");
});

test("missionBlockReasonFromDownstreamGate: blocked maps failure classes", () => {
  assert.equal(missionBlockReasonFromDownstreamGate("approval_rejected", "blocked"), "approval_rejected");
  assert.equal(missionBlockReasonFromDownstreamGate("policy_blocked", "blocked"), "policy_blocked");
  assert.equal(missionBlockReasonFromDownstreamGate("tool_failure", "blocked"), "tool_failure");
  assert.equal(missionBlockReasonFromDownstreamGate("operator_abort", "blocked"), "operator_stream_abort");
  assert.equal(missionBlockReasonFromDownstreamGate("unknown", "blocked"), "generic_blocked");
  assert.equal(
    missionBlockReasonFromDownstreamGate(
      "unknown",
      "blocked",
      "manual review required before retrying interrupted mutating work"
    ),
    "manual_review_required"
  );
  assert.equal(missionBlockReasonFromDownstreamGate("timeout_or_system_abort", "blocked"), "generic_blocked");
  assert.equal(missionBlockReasonFromDownstreamGate(undefined, "blocked"), "generic_blocked");
});
