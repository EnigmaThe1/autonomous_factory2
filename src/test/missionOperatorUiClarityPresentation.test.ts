import test from "node:test";
import assert from "node:assert/strict";

const { formatMissionStatusBadgeLabel, getMissionResumeUiState } = require("../../media/chat/missionStatusPresentation.js");
const { buildNonTerminalMissionNotes } = require("../../media/chat/missionCompletionLabels.js");

test("operator UI: guarded anti-replay stop surfaces explicit manual-review copy and disables resume", () => {
  const mission = {
    status: "blocked",
    blocker: "Blocked: manual review required before retrying interrupted mutating work",
    blockReasonCode: "manual_review_required",
    approvals: [],
    events: [],
    queue: []
  };
  assert.equal(formatMissionStatusBadgeLabel(mission), "Stopped — manual review required");
  assert.match(buildNonTerminalMissionNotes(mission)[0]?.primary || "", /manual review required/i);
  const resumeUi = getMissionResumeUiState(mission);
  assert.equal(resumeUi.enabled, false);
  assert.equal(resumeUi.label, "Review required");
  assert.match(resumeUi.title, /manual review/i);
});

test("operator UI: safe resumable queued mission still looks resumable", () => {
  const mission = {
    status: "queued",
    blocker: undefined,
    approvals: [],
    queue: [],
    events: [{ message: "Run reached maxStepsPerRun. Mission remains resumable." }]
  };
  assert.equal(formatMissionStatusBadgeLabel(mission), "Queued — resumable");
  const notes = buildNonTerminalMissionNotes(mission);
  assert.match(notes[0]?.primary || "", /click Resume to continue/i);
  const resumeUi = getMissionResumeUiState(mission);
  assert.equal(resumeUi.enabled, true);
  assert.equal(resumeUi.label, "Resume");
  assert.match(resumeUi.title, /resumable/i);
});

test("operator UI: approval-paused mission is distinct from manual-review blocked state", () => {
  const mission = {
    status: "awaiting_input",
    blocker: "Awaiting approval",
    blockReasonCode: "approval_pending",
    approvals: [{ status: "pending" }],
    events: [],
    queue: []
  };
  assert.equal(formatMissionStatusBadgeLabel(mission), "Paused — awaiting approval");
  assert.match(buildNonTerminalMissionNotes(mission)[0]?.primary || "", /approval/i);
  const resumeUi = getMissionResumeUiState(mission);
  assert.equal(resumeUi.enabled, false);
  assert.equal(resumeUi.label, "Awaiting approval");
  assert.match(resumeUi.title, /Approvals/i);
});

test("operator UI: approval-rejected mission is blocked and does not present a normal resume path", () => {
  const mission = {
    status: "blocked",
    blocker: "Tool request rejected",
    blockReasonCode: "approval_rejected",
    approvals: [{ status: "rejected" }],
    events: [],
    queue: []
  };
  assert.equal(formatMissionStatusBadgeLabel(mission), "Needs attention — approval rejected");
  assert.match(buildNonTerminalMissionNotes(mission)[0]?.primary || "", /approval was rejected/i);
  const resumeUi = getMissionResumeUiState(mission);
  assert.equal(resumeUi.enabled, false);
  assert.equal(resumeUi.label, "Approval rejected");
  assert.match(resumeUi.title, /blocked after approval rejection/i);
});

test("operator UI: operator-abort blocked mission remains safely resumable", () => {
  const mission = {
    status: "blocked",
    blocker: "Model stream cancelled (operator abort). Resume when ready.",
    blockReasonCode: "operator_stream_abort",
    approvals: [],
    events: [],
    queue: []
  };
  assert.equal(formatMissionStatusBadgeLabel(mission), "Paused — run stopped");
  const resumeUi = getMissionResumeUiState(mission);
  assert.equal(resumeUi.enabled, true);
  assert.equal(resumeUi.label, "Resume");
  assert.match(resumeUi.title, /Safe to resume/i);
});

test("operator UI: failed mission offers salvage Resume (aligned with orchestrator resumeMission)", () => {
  const mission = {
    status: "failed",
    blocker: "uncaught error",
    failureReasonCode: "orchestrator_uncaught_error",
    approvals: [],
    events: [],
    queue: []
  };
  assert.equal(formatMissionStatusBadgeLabel(mission), "Failed");
  const resumeUi = getMissionResumeUiState(mission);
  assert.equal(resumeUi.enabled, true);
  assert.equal(resumeUi.label, "Resume");
  assert.match(resumeUi.title, /salvage pass/i);
});
