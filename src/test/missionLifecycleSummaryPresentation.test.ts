import test from "node:test";
import assert from "node:assert/strict";
import type { Mission, WorkItem } from "../types";
import {
  focusedMissionLifecycleSummary,
  focusedMissionLifecycleSummaryForSnapshot,
  missionEventsIndicateMaxStepsResume
} from "../missions/missionLifecycleSummaryPresentation";

const basePolicy: Mission["policy"] = {
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

function miniMission(overrides: Partial<Mission> & { queue?: WorkItem[] }): Mission {
  return {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "queued",
    activeProviderId: "p",
    currentStep: 0,
    policy: basePolicy,
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    validationState: "pending",
    ...overrides
  };
}

function reqImpl(
  status: WorkItem["status"],
  hardStopClass?: WorkItem["hardStopClass"],
  output?: string
): WorkItem {
  return {
    id: "wi-impl",
    title: "Implementation",
    role: "implementer",
    status,
    prompt: "x",
    ...(hardStopClass !== undefined ? { hardStopClass } : {}),
    ...(output ? { output } : {})
  };
}

const DOWNSTREAM_LINE =
  "Blocked on required implementer work; review and validation are paused.";

test("focusedMissionLifecycleSummaryForSnapshot: undefined without mission", () => {
  assert.equal(focusedMissionLifecycleSummaryForSnapshot(undefined), undefined);
});

test("lifecycle: completed generic and each completionReason", () => {
  assert.equal(focusedMissionLifecycleSummary(miniMission({ status: "completed" })), "Completed.");
  assert.equal(
    focusedMissionLifecycleSummary(miniMission({ status: "completed", completionReason: "already_satisfied_no_tool_run" })),
    "Completed; Already satisfied; no tool run needed."
  );
  assert.equal(
    focusedMissionLifecycleSummary(miniMission({ status: "completed", completionReason: "apply_patch_noop_success" })),
    "Completed; Patch not needed; desired content already present."
  );
  assert.equal(
    focusedMissionLifecycleSummary(miniMission({ status: "completed", completionReason: "stale_patch_but_goal_already_met" })),
    "Completed; Patch was stale; goal already validated as met."
  );
});

test("lifecycle: completed unknown completionReason falls back to generic Completed", () => {
  const m = miniMission({ status: "completed", completionReason: "future_reason_xyz" as Mission["completionReason"] });
  assert.equal(focusedMissionLifecycleSummary(m), "Completed.");
});

test("lifecycle: failed and cancelled", () => {
  assert.equal(focusedMissionLifecycleSummary(miniMission({ status: "failed" })), "Failed; operator attention required.");
  assert.equal(
    focusedMissionLifecycleSummary(
      miniMission({ status: "failed", failureReasonCode: "orchestrator_uncaught_error" })
    ),
    "Failed after an internal automation error; check Timeline and Trace. You can try Resume for a salvage pass once the cause is understood."
  );
  assert.equal(focusedMissionLifecycleSummary(miniMission({ status: "cancelled" })), "Cancelled.");
});

test("lifecycle: awaiting approval vs other input", () => {
  const appr = miniMission({
    status: "awaiting_input",
    approvals: [
      {
        id: "a1",
        createdAt: 1,
        missionId: "m1",
        kind: "write_file",
        title: "A",
        details: "d",
        toolCall: { tool: "write_file", args: {} },
        status: "pending"
      }
    ]
  });
  assert.equal(focusedMissionLifecycleSummary(appr), "Waiting for approval to continue.");
  assert.equal(focusedMissionLifecycleSummary(miniMission({ status: "awaiting_input", approvals: [] })), "Waiting for required input.");
  assert.equal(
    focusedMissionLifecycleSummary(
      miniMission({ status: "awaiting_input", approvals: [], blockReasonCode: "post_validator_checkpoint" })
    ),
    "Validator finished; resume the mission to continue."
  );
  assert.equal(
    focusedMissionLifecycleSummary(
      miniMission({ status: "awaiting_input", approvals: [], blockReasonCode: "awaiting_pre_blueprint_answers" })
    ),
    "Pre-blueprint questions need answers; submit from the inspector or command palette."
  );
  assert.match(
    focusedMissionLifecycleSummary(
      miniMission({ status: "awaiting_input", approvals: [], blockReasonCode: "approval_gate_stale" })
    ),
    /out of sync|Approvals/i
  );
});

test("lifecycle: running with role and without", () => {
  const q: WorkItem[] = [
    { id: "w1", title: "W", role: "implementer", status: "running", prompt: "p" }
  ];
  assert.equal(
    focusedMissionLifecycleSummary(miniMission({ status: "running", queue: q })),
    "Running now; implementer is active."
  );
  assert.equal(
    focusedMissionLifecycleSummary(miniMission({ status: "running", queue: [] })),
    "Running now; automation is in progress."
  );
});

test("lifecycle: blocked downstream-gated (known hardStop) and malformed hardStop", () => {
  const gated = miniMission({
    status: "blocked",
    queue: [reqImpl("blocked", "approval_pending")]
  });
  assert.equal(focusedMissionLifecycleSummary(gated), DOWNSTREAM_LINE);

  const malformed = miniMission({
    status: "blocked",
    queue: [reqImpl("blocked" /* no hardStopClass */)]
  });
  assert.equal(focusedMissionLifecycleSummary(malformed), DOWNSTREAM_LINE);
});

test("lifecycle: blocked generic (no implementer hard-stop gate)", () => {
  const m = miniMission({
    status: "blocked",
    blocker: "Closure policy not satisfied",
    queue: [{ id: "r1", title: "R", role: "reviewer", status: "blocked", prompt: "p" }]
  });
  assert.equal(focusedMissionLifecycleSummary(m), "Blocked; operator attention required.");
});

test("lifecycle: blocked guarded anti-replay stop is explicit manual review required", () => {
  const m = miniMission({
    status: "blocked",
    blockReasonCode: "manual_review_required",
    blocker: "Blocked: manual review required before retrying interrupted mutating work",
    queue: [
      {
        ...reqImpl(
          "blocked",
          "unknown_hard_stop",
          "Interrupted during mutating tool execution.\n\nManual review is required before retrying this work item."
        ),
        activeMutatingToolCall: { tool: "writeFile", target: "x.txt", startedAt: 1 }
      } as any
    ]
  });
  assert.equal(
    focusedMissionLifecycleSummary(m),
    "Blocked intentionally; manual review is required before retrying interrupted mutating work."
  );
});

test("lifecycle: blocked approval rejection, tool failure, and operator abort are distinct", () => {
  const rejected = miniMission({
    status: "blocked",
    blockReasonCode: "approval_rejected",
    queue: [reqImpl("blocked", "approval_rejected")]
  });
  assert.equal(
    focusedMissionLifecycleSummary(rejected),
    "Blocked after approval rejection; implementer recovery is required before the mission can continue."
  );

  const toolFailure = miniMission({
    status: "blocked",
    blockReasonCode: "tool_failure",
    queue: [reqImpl("failed", "tool_failure")]
  });
  assert.equal(
    focusedMissionLifecycleSummary(toolFailure),
    "Blocked after tool failure; operator attention is required before the mission can continue."
  );

  const operatorAbort = miniMission({
    status: "blocked",
    blockReasonCode: "operator_stream_abort",
    queue: [reqImpl("blocked", "operator_abort")]
  });
  assert.equal(focusedMissionLifecycleSummary(operatorAbort), "Paused after operator abort; safe to resume when ready.");
});

test("lifecycle: queued resumable vs generic", () => {
  const resumable = miniMission({
    status: "queued",
    events: [{ id: "e1", ts: 1, level: "warn", source: "orchestrator", message: "Run reached maxStepsPerRun. Mission remains resumable." }]
  });
  assert.equal(focusedMissionLifecycleSummary(resumable), "Paused between run passes; resumable.");
  assert.ok(missionEventsIndicateMaxStepsResume(resumable.events));

  assert.equal(focusedMissionLifecycleSummary(miniMission({ status: "queued" })), "In queue; not running now.");
  assert.equal(
    focusedMissionLifecycleSummary(miniMission({ status: "queued", blocker: "something" })),
    "In queue; not running now."
  );
});
