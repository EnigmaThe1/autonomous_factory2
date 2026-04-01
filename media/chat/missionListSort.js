import { isMissionResumableForGrouping } from "./missionOperatorLabelsCore.js";

/**
 * Latest activity hint for tie-breaking (existing mission fields only).
 * @param {{ runtime?: { lastProgressAt?: number, lastRunnerHeartbeatAt?: number }, updatedAt?: number }} m
 */
export function missionActivityTimestamp(m) {
  const rt = m.runtime || {};
  const lp = typeof rt.lastProgressAt === "number" ? rt.lastProgressAt : 0;
  const hb = typeof rt.lastRunnerHeartbeatAt === "number" ? rt.lastRunnerHeartbeatAt : 0;
  const ua = typeof m.updatedAt === "number" ? m.updatedAt : 0;
  return Math.max(lp, hb, ua);
}

/**
 * Lower = higher operator priority (non-archived). Archived missions are sorted separately (always after non-archived).
 * Uses status plus shared resumable grouping semantics only — no note parsing.
 *
 * @param {{ status?: string, archivedAt?: number, blocker?: string|null, approvals?: Array<{ status?: string }>, events?: Array<{ message?: string }> }} m
 */
export function operatorMissionPriorityBucket(m) {
  const s = m.status != null ? String(m.status) : "";
  const pend = (m.approvals || []).filter((a) => a.status === "pending").length;
  const resumable = isMissionResumableForGrouping(m);

  if (s === "running") return 0;
  if (s === "awaiting_input") return pend > 0 ? 1 : 2;
  if (s === "blocked") return resumable ? 4 : 3;
  if (s === "queued") {
    return resumable ? 4 : 5;
  }
  if (s === "failed" || s === "cancelled") return 6;
  if (s === "completed") return 8;
  // Unknown / future statuses: below actionable queues, not above running/blocked/awaiting_input.
  return 7;
}

/**
 * Presentation-only sort: actionable missions first; archived at bottom; deterministic ties.
 *
 * @param {Array<object>|null|undefined} missions
 * @returns {object[]}
 */
export function sortMissionsForOperatorDisplay(missions) {
  const arr = (missions || []).slice();
  const indexMap = new Map();
  arr.forEach((m, i) => indexMap.set(m.id, i));

  arr.sort((a, b) => {
    const archA = a.archivedAt ? 1 : 0;
    const archB = b.archivedAt ? 1 : 0;
    if (archA !== archB) return archA - archB;

    const ba = operatorMissionPriorityBucket(a);
    const bb = operatorMissionPriorityBucket(b);
    if (ba !== bb) return ba - bb;

    const ta = missionActivityTimestamp(a);
    const tb = missionActivityTimestamp(b);
    if (ta !== tb) return tb - ta;

    return (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0);
  });
  return arr;
}
