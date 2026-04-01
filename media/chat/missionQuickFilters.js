import { isMissionResumableForGrouping } from "./missionOperatorLabelsCore.js";
import { sortMissionsForOperatorDisplay } from "./missionListSort.js";

/** @typedef {"all"|"active"|"needs_attention"|"awaiting_approval"|"resumable"|"completed"} MissionQuickFilterId */

/** @type {ReadonlyArray<{ id: MissionQuickFilterId, label: string }>} */
export const MISSION_QUICK_FILTER_OPTIONS = Object.freeze([
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "needs_attention", label: "Needs attention" },
  { id: "awaiting_approval", label: "Awaiting approval" },
  { id: "resumable", label: "Resumable" },
  { id: "completed", label: "Completed" }
]);

const VALID = new Set(MISSION_QUICK_FILTER_OPTIONS.map((o) => o.id));

/**
 * @param {string | null | undefined} id
 * @returns {MissionQuickFilterId}
 */
export function normalizeMissionQuickFilter(id) {
  if (id != null && VALID.has(id)) return /** @type {MissionQuickFilterId} */ (id);
  return "all";
}

/**
 * @param {{ status?: string, blocker?: string|null, approvals?: Array<{ status?: string }>, events?: Array<{ message?: string }> }} m
 * @param {MissionQuickFilterId} filterId
 */
export function matchesMissionQuickFilter(m, filterId) {
  const f = normalizeMissionQuickFilter(filterId);
  if (f === "all") return true;
  const s = m.status != null ? String(m.status) : "";
  const pend = (m.approvals || []).filter((a) => a.status === "pending").length;
  const resumable = isMissionResumableForGrouping(m);

  if (f === "active") return s === "running" || s === "queued" || s === "awaiting_input";
  if (f === "needs_attention") return (s === "blocked" && !resumable) || s === "failed" || s === "cancelled";
  if (f === "awaiting_approval") return s === "awaiting_input" && pend > 0;
  if (f === "resumable") return resumable;
  if (f === "completed") return s === "completed";
  return true;
}

/**
 * @param {Array<object>|null|undefined} missions Host-visible missions (archive toggle already applied).
 * @param {MissionQuickFilterId|string|null|undefined} filterId
 */
export function filterMissionsByQuickFilter(missions, filterId) {
  const f = normalizeMissionQuickFilter(filterId);
  const arr = missions || [];
  if (f === "all") return arr.slice();
  return arr.filter((m) => matchesMissionQuickFilter(m, f));
}

/**
 * Filter then operator sort (archived missions stay at bottom via sort).
 *
 * @param {Array<object>|null|undefined} missions
 * @param {MissionQuickFilterId|string|null|undefined} filterId
 */
export function composeMissionsForMissionList(missions, filterId) {
  return sortMissionsForOperatorDisplay(filterMissionsByQuickFilter(missions, filterId));
}

/**
 * Operator-facing label for the quick filter toolbar (matches `MISSION_QUICK_FILTER_OPTIONS`).
 * @param {string|null|undefined} filterId
 */
export function getMissionQuickFilterLabel(filterId) {
  const id = normalizeMissionQuickFilter(filterId);
  const row = MISSION_QUICK_FILTER_OPTIONS.find((o) => o.id === id);
  return row ? row.label : String(filterId || "All");
}

/**
 * True when a focused mission exists but is not in the composed visible list (filter + sort).
 * @param {{ id: string }|null|undefined} focusedMission
 * @param {Array<{ id: string }>|null|undefined} composedVisibleMissions
 */
export function focusedMissionHiddenFromComposedList(focusedMission, composedVisibleMissions) {
  if (!focusedMission?.id || !composedVisibleMissions) return false;
  return !composedVisibleMissions.some((m) => m.id === focusedMission.id);
}
