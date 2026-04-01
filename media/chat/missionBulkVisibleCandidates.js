/**
 * Bulk-action candidate sets from the composed visible mission list (after archive toggle + quick filter + sort).
 * Host re-validates each id before mutating.
 *
 * @param {Array<{ id: string, status?: string, archivedAt?: number }>|null|undefined} composedVisibleMissions
 */
export function computeVisibleBulkMissionCandidates(composedVisibleMissions) {
  const missions = composedVisibleMissions || [];
  const archiveCompletedIds = missions
    .filter((m) => m.status === "completed" && !m.archivedAt)
    .map((m) => m.id);
  const deleteFailedOrCancelledIds = missions
    .filter((m) => m.status === "failed" || m.status === "cancelled")
    .map((m) => m.id);
  const deleteBlockedIds = missions.filter((m) => m.status === "blocked").map((m) => m.id);
  return {
    archiveCompletedIds,
    deleteFailedOrCancelledIds,
    deleteBlockedIds,
    counts: {
      archiveCompleted: archiveCompletedIds.length,
      deleteFailedOrCancelled: deleteFailedOrCancelledIds.length,
      deleteBlocked: deleteBlockedIds.length
    }
  };
}
