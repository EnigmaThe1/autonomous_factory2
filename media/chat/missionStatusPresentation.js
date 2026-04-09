import {
  eventIndicatesMaxStepsResume,
  formatBlockedMissionBadgeLabel,
  getMissionResumeUiState,
  MISSION_BADGE_COMPLETED_HINT
} from "./missionOperatorLabelsCore.js";

export { getMissionResumeUiState };

/**
 * Single operator-facing mission status line for badges (short; raw `mission.status` unchanged in data).
 * Detailed copy remains in completion notes, non-terminal notes, events, etc.
 *
 * @param {{
 *   status?: string,
 *   completionReason?: string,
 *   blocker?: string|null,
 *   blockReasonCode?: string|null,
 *   archivedAt?: number,
 *   approvals?: Array<{ status?: string }>,
 *   events?: Array<{ message?: string }>,
 *   queue?: Array<{ status?: string, role?: string }>
 * }|null|undefined} m
 */
export function formatMissionStatusBadgeLabel(m) {
  if (!m || m.status == null || m.status === "") return "Unknown";
  const status = String(m.status);
  const archived = Boolean(m.archivedAt);
  const blocker = m.blocker != null && String(m.blocker).trim() ? String(m.blocker).trim() : "";
  const blockReasonCode =
    m.blockReasonCode != null && String(m.blockReasonCode).trim() ? String(m.blockReasonCode).trim() : "";
  const pend = (m.approvals || []).filter((a) => a.status === "pending").length;
  const events = m.events || [];
  const queue = m.queue || [];

  const arch = archived ? " (archived)" : "";

  if (status === "completed") {
    const cr = m.completionReason;
    const hint = cr != null && MISSION_BADGE_COMPLETED_HINT[cr];
    const base = hint ? `Completed — ${hint}` : "Completed";
    return `${base}${arch}`;
  }

  if (status === "awaiting_input") {
    let base = pend > 0 ? "Paused — awaiting approval" : "Paused — awaiting input";
    if (pend === 0 && blockReasonCode === "approval_gate_stale") {
      base = "Paused — approval out of sync";
    }
    return `${base}${arch}`;
  }

  if (status === "blocked") {
    return `${formatBlockedMissionBadgeLabel(blocker, blockReasonCode)}${arch}`;
  }

  if (status === "queued") {
    let base = "Queued";
    if (!blocker && eventIndicatesMaxStepsResume(events)) base = "Queued — resumable";
    return `${base}${arch}`;
  }

  if (status === "running") {
    const run = queue.find((w) => w.status === "running");
    const base = run?.role ? `Running — ${run.role}` : "Running";
    return `${base}${arch}`;
  }

  if (status === "failed") return `Failed${arch}`;
  if (status === "cancelled") return `Cancelled${arch}`;

  return status.replace(/_/g, " ");
}
