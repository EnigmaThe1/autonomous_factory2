/**
 * Canonical operator-facing label copy and free-text classification for missions.
 * Surface modules (completion / event / memory) wrap this without duplicating rules.
 */

/** @type {Readonly<Record<string, string>>} */
export const MISSION_COMPLETION_REASON_LABELS = Object.freeze({
  already_satisfied_no_tool_run: "Already satisfied; no tool run needed",
  apply_patch_noop_success: "Patch not needed; desired content already present",
  stale_patch_but_goal_already_met: "Patch was stale; goal already validated as met"
});

/** @type {Readonly<Record<string, string>>} */
export const WORK_ITEM_COMPLETION_KIND_LABELS = Object.freeze({
  already_satisfied: "Already satisfied (no tool run)",
  apply_patch_noop: "Patch not needed (desired content already present)"
});

/**
 * Short em-dash hints for mission status badges when `status === "completed"` (keys = completionReason).
 * Full sentences stay on MISSION_COMPLETION_REASON_LABELS / card notes below.
 */
export const MISSION_BADGE_COMPLETED_HINT = Object.freeze({
  already_satisfied_no_tool_run: "already satisfied",
  apply_patch_noop_success: "patch not needed",
  stale_patch_but_goal_already_met: "stale patch OK"
});

/** Shared phrases for free-text lines (events, memory, tool summaries). */
export const OPERATOR_FREE_TEXT = Object.freeze({
  approvalRequired: "Approval required before the mission can continue.",
  approvalAccepted: "Approval accepted; mission continuation was scheduled.",
  approvalRejected: "Approval rejected; mission remains blocked.",
  maxStepsResumable: "Paused after reaching the run step limit; resumable.",
  maxStepsQueuedCard: "Paused after reaching the run step limit for this session; click Resume to continue.",
  stalePatchGoalMet: "Stale patch skipped; validation already showed the goal was met (no further edit applied).",
  applyPatchNoopPrefix: "Patch not needed; desired content was already present.",
  alreadySatisfiedBracket: "Work item was already satisfied; no tool run was needed.",
  recoveredInterrupted: "Recovered interrupted work and queued it to resume.",
  normalizedRunning: 'Normalized stuck "running" work items back to todo so the mission can continue.',
  workItemAlreadySatisfiedEvent: "Work item completed as already satisfied (no tools run).",
  missionPausedPolicy: "Mission paused: a tool action was blocked by policy.",
  missionPausedToolFailed: "Mission paused: a tool call failed.",
  recoveryReplanInjected: "Automatic recovery replan injected after stall detection.",
  policyBlockedToolExecution: "A tool action was blocked by workspace policy.",
  toolRunFailedStep: "A tool run failed during this step."
});

/** @type {Readonly<Record<string, { primary: string }>>} */
export const EXACT_BLOCKER_NOTES = Object.freeze({
  "Reached maxAutoRounds safety limit": {
    primary:
      "Stopped: hit the configured maximum autonomous rounds safety limit (mission policy). Adjust maxAutoRounds or policy, then resume when ready."
  },
  "Mission cannot complete while required work items are still todo or running.": {
    primary: "Cannot complete yet — required work items are still todo or running."
  },
  "Closure policy not satisfied": {
    primary:
      "Cannot complete yet — closure policy is not satisfied (reviewer, validator, evidence, minimum completed work, etc.)."
  },
  "Model stream cancelled (operator abort). Resume when ready.": {
    primary: "Paused: the model stream was cancelled by the operator; safe to resume when ready."
  },
  "Mission exceeded automatic recovery attempts": {
    primary: "Stopped: automatic stall recovery limit reached. Inspect queue and events before resuming."
  },
  "Tool request rejected": {
    primary: "Approval was rejected; the mission is blocked until implementer recovery or mission changes are made."
  }
});

/** Badge labels keyed by `Mission.blockReasonCode` (host/orchestrator-owned). */
/** @type {Readonly<Record<string, string>>} */
export const MISSION_BLOCK_REASON_BADGE_LABEL = Object.freeze({
  policy_blocked: "Needs attention — policy block",
  tool_failure: "Paused — tool failure",
  manual_review_required: "Stopped — manual review required",
  max_auto_rounds: "Paused — max auto rounds",
  closure_not_satisfied: "Needs attention — closure pending",
  required_work_open: "Needs attention — work still open",
  operator_stream_abort: "Paused — run stopped",
  approval_rejected: "Needs attention — approval rejected",
  approval_pending: "Paused — awaiting approval",
  stall_recovery_limit: "Paused — recovery limit",
  generic_blocked: "Needs attention"
});

/** Non-terminal note primary lines keyed by `Mission.blockReasonCode` (aligned with EXACT_BLOCKER_NOTES intent). */
/** @type {Readonly<Record<string, string>>} */
export const MISSION_BLOCK_REASON_NOTE_PRIMARY = Object.freeze({
  policy_blocked: OPERATOR_FREE_TEXT.policyBlockedToolExecution,
  tool_failure: OPERATOR_FREE_TEXT.toolRunFailedStep,
  manual_review_required:
    "Manual review required — interrupted mutating work may already have executed. Inspect the mission and queue before any retry.",
  max_auto_rounds: EXACT_BLOCKER_NOTES["Reached maxAutoRounds safety limit"].primary,
  closure_not_satisfied: EXACT_BLOCKER_NOTES["Closure policy not satisfied"].primary,
  required_work_open: EXACT_BLOCKER_NOTES["Mission cannot complete while required work items are still todo or running."].primary,
  operator_stream_abort: EXACT_BLOCKER_NOTES["Model stream cancelled (operator abort). Resume when ready."].primary,
  approval_rejected: EXACT_BLOCKER_NOTES["Tool request rejected"].primary,
  approval_pending: "Awaiting your approval — open the Approvals tab to continue.",
  stall_recovery_limit: EXACT_BLOCKER_NOTES["Mission exceeded automatic recovery attempts"].primary,
  generic_blocked: "Blocked — review mission details and queue before continuing."
});

/** Event message (distinct from blocker EXACT_BLOCKER_NOTES wording). */
const EVENT_PAUSE_AFTER_EXCEEDING_RECOVERY = "Paused after repeated automatic stall recovery; needs operator review before resuming.";

/**
 * Short mission-card / inspector badge line when `status === "blocked"` (raw `blocker` unchanged in data).
 * When `blockReasonCode` is set, it wins over `blocker` string shape. Otherwise prefix checks follow
 * exact strings produced in `MissionOrchestrator` / `BackgroundMissionRunner`.
 *
 * @param {string | null | undefined} blocker
 * @param {string | null | undefined} [blockReasonCode]
 * @returns {string}
 */
export function formatBlockedMissionBadgeLabel(blocker, blockReasonCode) {
  const code =
    blockReasonCode != null && String(blockReasonCode).trim() ? String(blockReasonCode).trim() : "";
  if (code && MISSION_BLOCK_REASON_BADGE_LABEL[code]) return MISSION_BLOCK_REASON_BADGE_LABEL[code];
  const b = blocker != null ? String(blocker).trim() : "";
  if (!b) return "Needs attention";
  if (b.startsWith("Policy blocked mission progress")) return "Needs attention — policy block";
  if (b.startsWith("Mission halted after tool failure")) return "Paused — tool failure";
  if (b === "Reached maxAutoRounds safety limit") return "Paused — max auto rounds";
  if (b === "Mission exceeded automatic recovery attempts") return "Paused — recovery limit";
  if (b === "Mission cannot complete while required work items are still todo or running.") {
    return "Needs attention — work still open";
  }
  if (b === "Closure policy not satisfied") return "Needs attention — closure pending";
  if (b === "Model stream cancelled (operator abort). Resume when ready.") return "Paused — run stopped";
  if (b === "Tool request rejected") return "Needs attention — approval rejected";
  if (/manual review required before retrying interrupted mutating work/i.test(b)) {
    return "Stopped — manual review required";
  }
  return "Needs attention";
}

/**
 * @param {{ status?: string, blocker?: string|null, blockReasonCode?: string|null, approvals?: Array<{ status?: string }>, events?: Array<{ message?: string }> }|null|undefined} m
 */
export function getMissionResumeUiState(m) {
  if (!m || m.status == null || m.status === "") {
    return { enabled: false, label: "Resume unavailable", title: "No resumable mission is focused." };
  }
  const status = String(m.status);
  const blocker = m.blocker != null && String(m.blocker).trim() ? String(m.blocker).trim() : "";
  const code =
    m.blockReasonCode != null && String(m.blockReasonCode).trim() ? String(m.blockReasonCode).trim() : "";
  const pendingApprovals = (m.approvals || []).filter((a) => a.status === "pending").length;

  if (status === "awaiting_input") {
    if (pendingApprovals > 0) {
      return { enabled: false, label: "Awaiting approval", title: "Open Approvals to continue this mission." };
    }
    return { enabled: false, label: "Awaiting input", title: "Provide the required operator input before continuing." };
  }

  if (status === "blocked") {
    if (code === "approval_rejected") {
      return {
        enabled: false,
        label: "Approval rejected",
        title: "The mission is blocked after approval rejection. Implementer recovery or mission changes are required before continuing."
      };
    }
    if (code === "manual_review_required" || /manual review required before retrying interrupted mutating work/i.test(blocker)) {
      return {
        enabled: false,
        label: "Review required",
        title: "Interrupted mutating work may already have executed. Manual review is required before any retry."
      };
    }
    if (code === "operator_stream_abort" || blocker === "Model stream cancelled (operator abort). Resume when ready.") {
      return { enabled: true, label: "Resume", title: "Safe to resume after the operator-aborted run." };
    }
    return { enabled: false, label: "Resume blocked", title: "Resolve the blocked mission state before trying to continue." };
  }

  if (status === "queued") {
    if (!blocker && eventIndicatesMaxStepsResume(m.events || [])) {
      return { enabled: true, label: "Resume", title: "Paused between safe run passes; resumable." };
    }
    return { enabled: true, label: "Resume", title: "Resume this queued mission." };
  }

  if (status === "running") {
    return { enabled: false, label: "Running", title: "This mission is already running." };
  }

  if (status === "failed") {
    return {
      enabled: true,
      label: "Resume",
      title:
        "Mission status is failed. Resume runs a salvage pass: failure metadata is cleared and the mission is re-queued. Review Timeline, queue, and Trace before relying on automatic execution."
    };
  }

  if (status === "completed") {
    return { enabled: false, label: "Completed", title: "This mission is already completed." };
  }

  if (status === "cancelled") {
    return { enabled: false, label: "Cancelled", title: "This mission was cancelled and is not resumable." };
  }

  return { enabled: false, label: "Resume unavailable", title: "This mission is not in a resumable state." };
}

/**
 * Shared grouping semantics for "resumable" mission buckets.
 * Narrow by design: includes safe resumed-pass queues and operator-aborted blocked runs,
 * but excludes approval/manual-review/tool-failure blocked states.
 *
 * @param {{ status?: string, blocker?: string|null, blockReasonCode?: string|null, events?: Array<{ message?: string }> }|null|undefined} m
 */
export function isMissionResumableForGrouping(m) {
  if (!m || m.status == null || m.status === "") return false;
  const status = String(m.status);
  const blocker = m.blocker != null && String(m.blocker).trim() ? String(m.blocker).trim() : "";
  const code =
    m.blockReasonCode != null && String(m.blockReasonCode).trim() ? String(m.blockReasonCode).trim() : "";

  if (status === "queued") {
    return !blocker && eventIndicatesMaxStepsResume(m.events || []);
  }

  if (status === "blocked") {
    return code === "operator_stream_abort" || blocker === "Model stream cancelled (operator abort). Resume when ready.";
  }

  return false;
}

/**
 * @param {string} blocker
 * @param {string} status
 * @param {number} [pendingApprovalCount] pending `approvals[].status === "pending"` (for awaiting_input nuance)
 * @param {string | null | undefined} [blockReasonCode]
 * @returns {{ primary: string, detail?: string } | null}
 */
export function describeMissionBlocker(blocker, status, pendingApprovalCount = 0, blockReasonCode) {
  const code =
    blockReasonCode != null && String(blockReasonCode).trim() ? String(blockReasonCode).trim() : "";
  if (code && MISSION_BLOCK_REASON_NOTE_PRIMARY[code]) {
    return { primary: MISSION_BLOCK_REASON_NOTE_PRIMARY[code], detail: blocker || undefined };
  }
  const exact = EXACT_BLOCKER_NOTES[blocker];
  if (exact) return exact;

  if (status === "awaiting_input") {
    const pend = pendingApprovalCount > 0;
    return {
      primary: pend
        ? "Awaiting your approval — open the Approvals tab to continue."
        : "Awaiting operator input before the mission can continue.",
      detail: blocker || undefined
    };
  }

  if (blocker.startsWith("Policy blocked mission progress")) {
    return { primary: OPERATOR_FREE_TEXT.policyBlockedToolExecution, detail: blocker };
  }
  if (blocker.startsWith("Mission halted after tool failure")) {
    return { primary: OPERATOR_FREE_TEXT.toolRunFailedStep, detail: blocker };
  }

  return null;
}

/**
 * True when recent mission events include the orchestrator maxStepsPerRun pause.
 * @param {Array<{ message?: string }>|null|undefined} events
 */
export function eventIndicatesMaxStepsResume(events) {
  if (!events || !events.length) return false;
  return events.slice(-8).some(
    (e) =>
      typeof e.message === "string" &&
      /maxStepsPerRun/i.test(e.message) &&
      /resumable/i.test(e.message)
  );
}

/**
 * Single classification path for raw host-generated lines shown in timeline, console (non-tool), memory, and tool cards.
 * @param {string | null | undefined} text
 * @returns {{ primary: string, detail?: string }}
 */
export function describeOperatorFreeText(text) {
  if (text == null || text === "") return { primary: "" };
  const raw = String(text);

  if (raw.startsWith("[apply_patch_noop] ")) {
    return { primary: OPERATOR_FREE_TEXT.applyPatchNoopPrefix, detail: raw };
  }

  if (raw.startsWith("[already_satisfied]")) {
    return { primary: OPERATOR_FREE_TEXT.alreadySatisfiedBracket, detail: raw };
  }

  if (raw === "Run reached maxStepsPerRun. Mission remains resumable.") {
    return { primary: OPERATOR_FREE_TEXT.maxStepsResumable, detail: raw };
  }

  if (raw.startsWith("Approval required:")) {
    return { primary: OPERATOR_FREE_TEXT.approvalRequired, detail: raw };
  }

  if (raw.startsWith("Approved:")) {
    return { primary: OPERATOR_FREE_TEXT.approvalAccepted, detail: raw };
  }

  if (raw.startsWith("Rejected:")) {
    return { primary: OPERATOR_FREE_TEXT.approvalRejected, detail: raw };
  }

  if (/^Recovered \d+ interrupted running work item\(s\) and re-queued them for resume\.$/.test(raw)) {
    return { primary: OPERATOR_FREE_TEXT.recoveredInterrupted, detail: raw };
  }

  if (
    /^Normalized \d+ stale running work item\(s\) to todo \(no eligible next while queue showed running\)\.$/.test(raw)
  ) {
    return { primary: OPERATOR_FREE_TEXT.normalizedRunning, detail: raw };
  }

  if (raw.includes("stale_patch_but_goal_already_met")) {
    return { primary: OPERATOR_FREE_TEXT.stalePatchGoalMet, detail: raw };
  }

  if (raw.startsWith("Work item completed without tools (already_satisfied):")) {
    return { primary: OPERATOR_FREE_TEXT.workItemAlreadySatisfiedEvent, detail: raw };
  }

  if (raw.startsWith("Mission paused: tool call blocked by policy")) {
    return { primary: OPERATOR_FREE_TEXT.missionPausedPolicy, detail: raw };
  }

  if (raw.startsWith("Mission paused: tool call failed")) {
    return { primary: OPERATOR_FREE_TEXT.missionPausedToolFailed, detail: raw };
  }

  if (raw === "Injected automatic recovery replan after stall detection") {
    return { primary: OPERATOR_FREE_TEXT.recoveryReplanInjected, detail: raw };
  }

  if (raw === "Mission paused after exceeding automatic recovery attempts") {
    return { primary: EVENT_PAUSE_AFTER_EXCEEDING_RECOVERY, detail: raw };
  }

  if (raw.includes("Policy blocked tool execution:")) {
    return { primary: OPERATOR_FREE_TEXT.policyBlockedToolExecution, detail: raw };
  }
  if (raw.includes("Tool execution failed:")) {
    return { primary: OPERATOR_FREE_TEXT.toolRunFailedStep, detail: raw };
  }

  return { primary: raw };
}

const SURFACE_HTML_CLASS = Object.freeze({
  event: Object.freeze({
    body: "mission-event-body",
    primary: "mission-event-primary",
    raw: "mission-event-raw"
  }),
  memory: Object.freeze({
    body: "mission-memory-body",
    primary: "mission-memory-primary",
    raw: "mission-memory-raw"
  })
});

/**
 * @param {"event" | "memory"} surface
 * @param {string | null | undefined} text
 * @param {(s: string) => string} escapeHtml
 */
export function formatOperatorFreeTextHtml(surface, text, escapeHtml) {
  const { primary, detail } = describeOperatorFreeText(text);
  if (!primary) return "";
  const c = SURFACE_HTML_CLASS[surface];
  if (!detail || detail === primary) {
    return `<div class="${c.body}">${escapeHtml(primary)}</div>`;
  }
  return `<div class="${c.body}"><div class="${c.primary}">${escapeHtml(primary)}</div><div class="meta ${c.raw}">${escapeHtml(detail)}</div></div>`;
}
