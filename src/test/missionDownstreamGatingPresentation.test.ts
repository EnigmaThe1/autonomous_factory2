import test from "node:test";
import assert from "node:assert/strict";
import type { Mission, WorkItem } from "../types";
import {
  focusedMissionDownstreamGatingHintForSnapshot,
  missionDownstreamGatingOperatorHint
} from "../missions/missionDownstreamGatingPresentation";

const basePolicy = {
  closureRequired: true,
  requireReviewerBeforeComplete: true,
  requireValidatorBeforeComplete: true,
  requireImplementerBeforeComplete: true,
  autoContinue: true,
  maxAutoRounds: 24,
  minCompletedWorkItems: 1,
  stallReplanThreshold: 3
};

function miniMission(overrides: Partial<Mission> & { queue?: WorkItem[] }): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "blocked",
    activeProviderId: "p",
    currentStep: 0,
    policy: basePolicy,
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    validationState: "failed",
    ...overrides
  };
}

function reqImpl(status: WorkItem["status"], output?: string, hardStopClass?: WorkItem["hardStopClass"]): WorkItem {
  return {
    id: "wi-impl",
    title: "Implementation",
    role: "implementer",
    status,
    prompt: "x",
    ...(hardStopClass ? { hardStopClass } : {}),
    ...(output ? { output } : {})
  };
}

test("downstream gating hint: approval pending", () => {
  const m = miniMission({
    status: "awaiting_input",
    approvals: [{ id: "a1", createdAt: 1, missionId: "m1", kind: "write_file", title: "A", details: "d", toolCall: { tool: "write_file", args: {} } as any, status: "pending" }],
    queue: [reqImpl("blocked", "Pending approval: A", "approval_pending")]
  } as any);
  const h = missionDownstreamGatingOperatorHint(m);
  assert.ok(h?.includes("Approval is still required"));
});

test("downstream gating hint: approval rejected", () => {
  const m = miniMission({
    approvals: [{ id: "a1", createdAt: 1, missionId: "m1", kind: "write_file", title: "A", details: "d", toolCall: { tool: "write_file", args: {} } as any, status: "rejected" }],
    queue: [reqImpl("blocked", "Rejected.", "approval_rejected")]
  } as any);
  const h = missionDownstreamGatingOperatorHint(m);
  assert.ok(h?.includes("approval was rejected") || h?.includes("rejected"));
});

test("downstream gating hint: policy blocked", () => {
  const m = miniMission({
    blocker: "Policy blocked mission progress (write_file: nope)",
    queue: [reqImpl("blocked", "Policy blocked tool execution: write_file: nope", "policy_blocked")]
  });
  const h = missionDownstreamGatingOperatorHint(m);
  assert.ok(h?.includes("policy"));
});

test("downstream gating hint: tool failure", () => {
  const m = miniMission({
    blocker: "Mission halted after tool failure (write_file: nope)",
    queue: [reqImpl("failed", "Tool execution failed: write_file: nope", "tool_failure")]
  });
  const h = missionDownstreamGatingOperatorHint(m);
  assert.ok(h?.includes("tool failure") || h?.includes("Tool failure"));
});

test("downstream gating hint: operator abort", () => {
  const m = miniMission({
    queue: [reqImpl("blocked", "Model stream cancelled (operator abort).", "operator_abort")]
  });
  const h = missionDownstreamGatingOperatorHint(m);
  assert.ok(h?.includes("aborted by the operator"));
});

test("downstream gating hint: unknown hard-stop", () => {
  const m = miniMission({
    queue: [reqImpl("failed", "some other failure", "unknown_hard_stop")]
  });
  const h = missionDownstreamGatingOperatorHint(m);
  assert.ok(h?.includes("unknown"));
});

test("downstream gating hint: guarded anti-replay stop is explicit manual review, not vague unknown", () => {
  const m = miniMission({
    queue: [
      {
        ...reqImpl(
          "blocked",
          "Interrupted during mutating tool execution.\n\nManual review is required before retrying this work item.",
          "unknown_hard_stop"
        ),
        activeMutatingToolCall: { tool: "writeFile", target: "x.txt", startedAt: 1 }
      } as any
    ]
  });
  const h = missionDownstreamGatingOperatorHint(m);
  assert.match(h || "", /manual review is required/i);
  assert.doesNotMatch(h || "", /unknown hard-stop/i);
  assert.doesNotMatch(h || "", /Approval is still required/i);
});

test("downstream gating hint: no hint for timeout/system abort (non-gated)", () => {
  const m = miniMission({
    queue: [reqImpl("failed", "Model stream cancelled (request timeout).", "timeout_or_system_abort")]
  });
  assert.equal(missionDownstreamGatingOperatorHint(m), undefined);
});

test("downstream gating hint: missing hardStopClass surfaces contract violation (not generic unknown)", () => {
  const m = miniMission({
    status: "awaiting_input",
    approvals: [{ id: "a1", createdAt: 1, missionId: "m1", kind: "write_file", title: "A", details: "d", toolCall: { tool: "write_file", args: {} } as any, status: "pending" }],
    queue: [reqImpl("blocked", "no structured class")]
  } as any);
  const h = missionDownstreamGatingOperatorHint(m);
  assert.ok(h?.includes("contract violation"));
  assert.ok(h?.includes("missing"));
});

test("downstream gating hint: invalid hardStopClass surfaces contract violation", () => {
  const m = miniMission({
    queue: [reqImpl("blocked", "x", "not_valid" as any)]
  } as any);
  const h = missionDownstreamGatingOperatorHint(m);
  assert.ok(h?.includes("contract violation"));
  assert.ok(h?.includes("invalid"));
});

test("downstream gating hint: no hint for completed/cancelled in snapshot", () => {
  assert.equal(focusedMissionDownstreamGatingHintForSnapshot(miniMission({ status: "completed" })), undefined);
  assert.equal(focusedMissionDownstreamGatingHintForSnapshot(miniMission({ status: "cancelled" })), undefined);
});

