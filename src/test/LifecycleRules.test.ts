import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedMissionStatusTransition,
  isMissionTerminalLifecycleStatus,
  resolveCompletionStatus
} from "../missions/LifecycleRules";

test("allows valid and rejects invalid mission status transitions", () => {
  assert.equal(isAllowedMissionStatusTransition("queued", "running"), true);
  assert.equal(isAllowedMissionStatusTransition("running", "completed"), true);
  assert.equal(isAllowedMissionStatusTransition("completed", "running"), false);
  assert.equal(isAllowedMissionStatusTransition("failed", "queued"), true);
  assert.equal(isAllowedMissionStatusTransition("failed", "awaiting_input"), true);
  assert.equal(isAllowedMissionStatusTransition("failed", "completed"), false);
});

test("completion status resolution is deterministic", () => {
  assert.equal(resolveCompletionStatus(false, false, "pending"), "completed");
  assert.equal(resolveCompletionStatus(false, true, "passed"), "completed");
  assert.equal(resolveCompletionStatus(false, true, "failed"), "blocked");
  assert.equal(resolveCompletionStatus(true, true, "passed"), "blocked");
});

test("isMissionTerminalLifecycleStatus marks operator-stable endpoints", () => {
  assert.equal(isMissionTerminalLifecycleStatus("completed"), true);
  assert.equal(isMissionTerminalLifecycleStatus("blocked"), true);
  assert.equal(isMissionTerminalLifecycleStatus("failed"), true);
  assert.equal(isMissionTerminalLifecycleStatus("cancelled"), true);
  assert.equal(isMissionTerminalLifecycleStatus("queued"), false);
  assert.equal(isMissionTerminalLifecycleStatus("running"), false);
  assert.equal(isMissionTerminalLifecycleStatus("awaiting_input"), false);
});
