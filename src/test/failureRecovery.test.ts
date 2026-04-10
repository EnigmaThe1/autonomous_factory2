import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyBlueprintFailure,
  classifyPolicyDenial,
  classifyRuntimeStreamAbort,
  classifyToolFailureStructured,
  classifyValidationFailure,
  computeRecoveryFingerprint,
  nextRecoveryStreakState,
  routeStructuredRecovery,
  MAX_RECOVERY_SAME_FINGERPRINT_STREAK
} from "../missions/failure";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";

test("classifyPolicyDenial: host-risk wording is hard_deny", () => {
  const s = classifyPolicyDenial("Host-risk command pattern detected (central policy).", "runCommand");
  assert.equal(s.class, "hard_deny");
  assert.equal(s.domain, "policy");
  assert.equal(s.code, "host_or_outside_workspace_denial");
});

test("classifyPolicyDenial: outside workspace is hard_deny", () => {
  const s = classifyPolicyDenial("Path is outside workspace: /etc/passwd", "writeFile");
  assert.equal(s.class, "hard_deny");
});

test("classifyToolFailureStructured: crashed summary is hard_deny", () => {
  const call: ToolCall = { tool: "writeFile", args: { path: "x", content: "y" } };
  const result: ToolResult = { ok: false, summary: "writeFile crashed: boom" };
  const s = classifyToolFailureStructured({ kind: "blocked", category: "tool_failure" }, call, result);
  assert.equal(s.class, "hard_deny");
  assert.equal(s.domain, "tool");
});

test("classifyToolFailureStructured: timeout wording is transient", () => {
  const call: ToolCall = { tool: "runCommand", args: { command: "x" } };
  const result: ToolResult = { ok: false, summary: "Command timed out after 30s" };
  const s = classifyToolFailureStructured({ kind: "blocked", category: "tool_failure" }, call, result);
  assert.equal(s.class, "transient");
});

test("classifyValidationFailure: generic test failure is repairable", () => {
  const s = classifyValidationFailure({ tool: "runTests", summary: "exit 1: AssertionError" });
  assert.equal(s.class, "repairable");
  assert.equal(s.domain, "validation");
});

test("classifyValidationFailure: missing module is environmental", () => {
  const s = classifyValidationFailure({ tool: "runTests", summary: "Error: Cannot find module 'jest-runtime'" });
  assert.equal(s.class, "environmental");
});

test("classifyBlueprintFailure: parse errors are repairable", () => {
  const s = classifyBlueprintFailure(["Invalid JSON", "missing steps"]);
  assert.equal(s.class, "repairable");
  assert.equal(s.domain, "blueprint");
});

test("classifyRuntimeStreamAbort: timeout is transient", () => {
  const s = classifyRuntimeStreamAbort("timeout");
  assert.equal(s.class, "transient");
  assert.equal(s.domain, "runtime");
});

test("classifyRuntimeStreamAbort: operator is hard_deny", () => {
  const s = classifyRuntimeStreamAbort("operator");
  assert.equal(s.class, "hard_deny");
});

test("routeStructuredRecovery: repairable validation + waves spawns recovery work", () => {
  const d = routeStructuredRecovery(
    { class: "repairable", domain: "validation", code: "x", message: "m" },
    {
      sameFingerprintStreak: 1,
      failureInvestigationEnabled: true,
      failureInvestigationWavesRemaining: 1,
      workItemRole: "implementer"
    }
  );
  assert.equal(d.route, "spawn_recovery_work");
});

test("routeStructuredRecovery: hard_deny policy blocks", () => {
  const d = routeStructuredRecovery(
    { class: "hard_deny", domain: "policy", code: "host_or_outside_workspace_denial", message: "m" },
    {
      sameFingerprintStreak: 1,
      failureInvestigationEnabled: true,
      failureInvestigationWavesRemaining: 2,
      workItemRole: "implementer"
    }
  );
  assert.equal(d.route, "block");
});

test("routeStructuredRecovery: repeated fingerprint escalates to fail when allowed", () => {
  const d = routeStructuredRecovery(
    { class: "repairable", domain: "tool", code: "x", message: "m" },
    {
      sameFingerprintStreak: MAX_RECOVERY_SAME_FINGERPRINT_STREAK,
      failureInvestigationEnabled: true,
      failureInvestigationWavesRemaining: 2,
      workItemRole: "implementer",
      allowTerminalMissionFail: true
    }
  );
  assert.equal(d.route, "fail");
});

test("computeRecoveryFingerprint: changes when queue length changes", () => {
  const f = (q: number) =>
    computeRecoveryFingerprint({
      missionId: "m",
      workItemId: "w",
      failure: { class: "repairable", domain: "tool", code: "c", message: "msg" },
      missionQueueLength: q,
      missionValidationState: "pending"
    });
  assert.notEqual(f(3), f(4));
});

test("nextRecoveryStreakState: increments on same fingerprint", () => {
  const a = nextRecoveryStreakState("abc", 2, "abc");
  assert.equal(a.streak, 3);
  const b = nextRecoveryStreakState("abc", 2, "def");
  assert.equal(b.streak, 1);
});
