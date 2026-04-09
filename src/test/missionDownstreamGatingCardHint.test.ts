import test from "node:test";
import assert from "node:assert/strict";
import type { Mission, WorkItem } from "../types";
import {
  missionDownstreamGatingCardHint,
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

function reqImpl(status: WorkItem["status"], output?: string): WorkItem {
  return { id: "wi", title: "i", role: "implementer", status, prompt: "x", ...(output ? { output } : {}) };
}

test("card hint: approval required/rejected", () => {
  const pending = miniMission({
    status: "awaiting_input",
    approvals: [{ id: "a1", createdAt: 1, missionId: "m1", kind: "write_file", title: "A", details: "d", toolCall: { tool: "write_file", args: {} } as any, status: "pending" }],
    queue: [{ ...reqImpl("blocked", "no text"), hardStopClass: "approval_pending" } as any, { id: "p1", title: "plan", role: "planner", status: "todo", prompt: "p" }]
  } as any);
  assert.equal(missionDownstreamGatingCardHint(pending), "Implementer blocked: approval required");

  const stale = miniMission({
    status: "awaiting_input",
    blockReasonCode: "approval_gate_stale",
    approvals: [],
    queue: [{ ...reqImpl("blocked", "no text"), hardStopClass: "approval_pending" } as any, { id: "p1", title: "plan", role: "planner", status: "todo", prompt: "p" }]
  } as any);
  assert.equal(missionDownstreamGatingCardHint(stale), "Implementer blocked: approval gate stale (no pending row)");

  const rej = miniMission({
    approvals: [{ id: "a1", createdAt: 1, missionId: "m1", kind: "write_file", title: "A", details: "d", toolCall: { tool: "write_file", args: {} } as any, status: "rejected" }],
    queue: [{ ...reqImpl("blocked", "no text"), hardStopClass: "approval_rejected" } as any, { id: "p1", title: "plan", role: "planner", status: "todo", prompt: "p" }]
  } as any);
  assert.equal(missionDownstreamGatingCardHint(rej), "Implementer blocked: approval rejected");
});

test("card hint: policy/tool/operator abort", () => {
  assert.equal(
    missionDownstreamGatingCardHint(miniMission({ blocker: "Policy blocked mission progress (x)", queue: [{ ...reqImpl("blocked", "no text"), hardStopClass: "policy_blocked" } as any, { id: "p1", title: "plan", role: "planner", status: "todo", prompt: "p" }] })),
    "Implementer blocked: policy blocked"
  );
  assert.equal(
    missionDownstreamGatingCardHint(miniMission({ blocker: "Mission halted after tool failure (x)", queue: [{ ...reqImpl("failed", "no text"), hardStopClass: "tool_failure" } as any, { id: "p1", title: "plan", role: "planner", status: "todo", prompt: "p" }] })),
    "Implementer blocked: tool failure"
  );
  assert.equal(
    missionDownstreamGatingCardHint(miniMission({ queue: [{ ...reqImpl("blocked", "no text"), hardStopClass: "operator_abort" } as any, { id: "p1", title: "plan", role: "planner", status: "todo", prompt: "p" }] })),
    "Implementer blocked: operator abort"
  );
});

test("card hint: malformed missing or invalid hardStopClass", () => {
  assert.equal(
    missionDownstreamGatingCardHint(miniMission({ queue: [reqImpl("blocked", "x")] })),
    "Implementer blocked: data error (missing class)"
  );
  assert.equal(
    missionDownstreamGatingCardHint(miniMission({ queue: [{ ...reqImpl("failed", "x"), hardStopClass: "nope" as any }] })),
    "Implementer blocked: data error (invalid class)"
  );
});

test("card hint: no runnable recovery work overrides failure class", () => {
  const m = miniMission({
    approvals: [{ id: "a1", createdAt: 1, missionId: "m1", kind: "write_file", title: "A", details: "d", toolCall: { tool: "write_file", args: {} } as any, status: "pending" }],
    queue: [{ ...reqImpl("blocked", "no text"), hardStopClass: "approval_pending" } as any]
  } as any);
  assert.equal(missionDownstreamGatingCardHint(m), "Implementer blocked: no runnable recovery work");
});

test("card hint: guarded anti-replay stop stays manual-review-required even with no runnable recovery work", () => {
  const m = miniMission({
    queue: [
      {
        ...reqImpl(
          "blocked",
          "Interrupted during mutating tool execution.\n\nManual review is required before retrying this work item."
        ),
        hardStopClass: "unknown_hard_stop",
        activeMutatingToolCall: { tool: "writeFile", target: "x.txt", startedAt: 1 }
      } as any
    ]
  });
  assert.equal(missionDownstreamGatingCardHint(m), "Implementer blocked: manual review required");
});

test("card hint: no hint for completed/cancelled", () => {
  assert.equal(missionDownstreamGatingCardHint(miniMission({ status: "completed" })), undefined);
  assert.equal(missionDownstreamGatingCardHint(miniMission({ status: "cancelled" })), undefined);
});

test("card hint: no hint for timeout/system abort (non-gated)", () => {
  assert.equal(
    missionDownstreamGatingCardHint(
      miniMission({ queue: [{ ...reqImpl("failed", "no text"), hardStopClass: "timeout_or_system_abort" } as any] })
    ),
    undefined
  );
});

test("card hint: shorter than inspector copy", () => {
  const m = miniMission({
    blocker: "Mission halted after tool failure (x)",
    queue: [{ ...reqImpl("failed", "detail"), hardStopClass: "tool_failure" } as WorkItem]
  });
  const card = missionDownstreamGatingCardHint(m)!;
  const ins = missionDownstreamGatingOperatorHint(m)!;
  assert.ok(card.length < ins.length);
});

