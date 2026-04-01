import {
  MISSION_COMPLETION_REASON_LABELS,
  WORK_ITEM_COMPLETION_KIND_LABELS,
  describeMissionBlocker,
  eventIndicatesMaxStepsResume,
  OPERATOR_FREE_TEXT
} from "./missionOperatorLabelsCore.js";

export { eventIndicatesMaxStepsResume };

/**
 * Human-readable mission terminal outcome. Unknown values return the raw string (safe fallback).
 * @param {string | null | undefined} reason
 * @returns {string}
 */
export function formatMissionCompletionReason(reason) {
  if (reason == null || reason === "") return "";
  const mapped = MISSION_COMPLETION_REASON_LABELS[reason];
  return mapped != null ? mapped : String(reason);
}

/**
 * Human-readable work-item completion hint. Unknown values return the raw string.
 * @param {string | null | undefined} kind
 * @returns {string}
 */
export function formatWorkItemCompletionKind(kind) {
  if (kind == null || kind === "") return "";
  const mapped = WORK_ITEM_COMPLETION_KIND_LABELS[kind];
  return mapped != null ? mapped : String(kind);
}

/**
 * Operator-facing lines for missions that are not completed (and not purely “done” success).
 * Does not run for status === "completed". Unknown blockers surface as a single raw primary line.
 *
 * @param {{ status?: string, blocker?: string|null|undefined, blockReasonCode?: string|null|undefined, approvals?: Array<{status: string}>, events?: Array<{ message?: string }> }} m
 * @returns {Array<{ primary: string, detail?: string }>}
 */
export function buildNonTerminalMissionNotes(m) {
  const status = m.status || "";
  if (status === "completed") return [];

  const notes = [];
  const blockerTrim = m.blocker != null && String(m.blocker).trim() ? String(m.blocker).trim() : "";
  const blockReasonCode =
    m.blockReasonCode != null && String(m.blockReasonCode).trim() ? String(m.blockReasonCode).trim() : "";
  const pendingCount = (m.approvals || []).filter((a) => a.status === "pending").length;

  if (status === "queued" && !blockerTrim && eventIndicatesMaxStepsResume(m.events || [])) {
    notes.push({
      primary: OPERATOR_FREE_TEXT.maxStepsQueuedCard
    });
  }

  if (blockerTrim) {
    const mapped = describeMissionBlocker(blockerTrim, status, pendingCount, blockReasonCode);
    if (mapped) notes.push(mapped);
    else notes.push({ primary: blockerTrim });
  } else if (status === "awaiting_input" && pendingCount > 0) {
    notes.push({
      primary: "Waiting for your approval — use the Approvals tab to continue."
    });
  }

  return notes;
}

/**
 * @param {{ status?: string, blocker?: string|null|undefined, blockReasonCode?: string|null|undefined, approvals?: Array<{status: string}>, events?: Array<{ message?: string }> }} m
 * @param {(s: string) => string} escapeHtml
 */
export function formatNonTerminalMissionNotesHtml(m, escapeHtml) {
  return buildNonTerminalMissionNotes(m)
    .map(
      (n) =>
        `<div class="meta mission-status-note">${escapeHtml(n.primary)}${
          n.detail ? `<div class="meta mission-status-note-detail">${escapeHtml(n.detail)}</div>` : ""
        }</div>`
    )
    .join("");
}
