import test from "node:test";
import assert from "node:assert/strict";
import { focusedMissionLifecycleSummary } from "../missions/missionLifecycleSummaryPresentation";

const { formatMissionStatusBadgeLabel, getMissionResumeUiState } = require("../../media/chat/missionStatusPresentation.js");
const { buildNonTerminalMissionNotes, formatMissionCompletionReason } = require("../../media/chat/missionCompletionLabels.js");
const { describeMissionCurrentNext } = require("../../media/chat/missionQueueCurrentNext.js");

function mission(overrides: Record<string, unknown>) {
  return {
    id: "m1",
    title: "Mission",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "queued",
    activeProviderId: "openai",
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
      policyPreset: "balanced"
    },
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    validationState: "pending",
    ...overrides
  } as any;
}

test("cross-surface: approval pending stays approval-paused across badge, summary, note, action, and queue path", () => {
  const m = mission({
    status: "awaiting_input",
    blocker: "Awaiting approval",
    blockReasonCode: "approval_pending",
    approvals: [{ status: "pending" }],
    queue: [
      { id: "impl", status: "blocked", role: "implementer", title: "Implement tranche" },
      { id: "rev", status: "todo", role: "reviewer", title: "Review tranche" }
    ]
  });
  assert.equal(formatMissionStatusBadgeLabel(m), "Paused — awaiting approval");
  assert.equal(focusedMissionLifecycleSummary(m), "Waiting for approval to continue.");
  assert.match(buildNonTerminalMissionNotes(m)[0]?.primary || "", /approval/i);
  const resume = getMissionResumeUiState(m);
  assert.equal(resume.enabled, false);
  assert.equal(resume.label, "Awaiting approval");
  const currentNext = describeMissionCurrentNext(m.queue);
  assert.equal(currentNext.next, undefined);
  assert.equal(currentNext.pausedOn.role, "implementer");
});

test("cross-surface: operator abort resumable stays resumable across badge, summary, note, action, and queue path", () => {
  const m = mission({
    status: "blocked",
    blocker: "Model stream cancelled (operator abort). Resume when ready.",
    blockReasonCode: "operator_stream_abort",
    queue: [{ id: "impl", status: "blocked", role: "implementer", title: "Implement tranche" }]
  });
  assert.equal(formatMissionStatusBadgeLabel(m), "Paused — run stopped");
  assert.equal(focusedMissionLifecycleSummary(m), "Paused after operator abort; safe to resume when ready.");
  assert.match(buildNonTerminalMissionNotes(m)[0]?.primary || "", /safe to resume/i);
  const resume = getMissionResumeUiState(m);
  assert.equal(resume.enabled, true);
  assert.equal(resume.label, "Resume");
  const currentNext = describeMissionCurrentNext(m.queue);
  assert.equal(currentNext.next, undefined);
  assert.equal(currentNext.pausedOn.role, "implementer");
});

test("cross-surface: completed/cancelled terminal; failed shows salvage Resume consistent with lifecycle summary", () => {
  const completed = mission({
    status: "completed",
    completionReason: "already_satisfied_no_tool_run",
    queue: [{ id: "v1", status: "done", role: "validator", title: "Validate tranche" }]
  });
  assert.equal(formatMissionStatusBadgeLabel(completed), "Completed — already satisfied");
  assert.equal(focusedMissionLifecycleSummary(completed), "Completed; Already satisfied; no tool run needed.");
  assert.equal(buildNonTerminalMissionNotes(completed).length, 0);
  assert.equal(getMissionResumeUiState(completed).label, "Completed");
  assert.match(formatMissionCompletionReason(completed.completionReason), /Already satisfied/i);

  const failed = mission({ status: "failed", blocker: "uncaught error" });
  assert.equal(formatMissionStatusBadgeLabel(failed), "Failed");
  assert.equal(focusedMissionLifecycleSummary(failed), "Failed; operator attention required.");
  assert.equal(getMissionResumeUiState(failed).enabled, true);
  assert.equal(getMissionResumeUiState(failed).label, "Resume");
  assert.match(getMissionResumeUiState(failed).title, /salvage pass/i);

  const cancelled = mission({ status: "cancelled" });
  assert.equal(formatMissionStatusBadgeLabel(cancelled), "Cancelled");
  assert.equal(focusedMissionLifecycleSummary(cancelled), "Cancelled.");
  assert.equal(getMissionResumeUiState(cancelled).enabled, false);
  assert.equal(getMissionResumeUiState(cancelled).label, "Cancelled");
});
