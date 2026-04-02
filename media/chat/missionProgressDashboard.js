/**
 * One-line missions summary for the dashboard header (`#summaryMissions`).
 * @param {object|undefined} snapshot
 */
export function formatDashboardMissionSummaryText(snapshot) {
  const total = snapshot?.missionList?.totalCount ?? snapshot?.missions?.length ?? 0;
  const ms = snapshot?.missions || [];
  const running = ms.filter((m) => m.status === "running").length;
  const queued = ms.filter((m) => m.status === "queued").length;
  const awaiting = ms.filter((m) => m.status === "awaiting_input").length;
  const parts = [String(total)];
  if (running) parts.push(`${running} running`);
  if (queued) parts.push(`${queued} queued`);
  if (awaiting) parts.push(`${awaiting} awaiting`);
  return parts.join(" • ");
}

/**
 * Renders `SidebarSnapshot.missionProgressStats[id]` for mission cards and inspector.
 * @param {object|undefined} stats
 * @param {(s: string) => string} escapeHtml
 * @returns {string} HTML fragment or empty string
 */
export function formatMissionProgressStatsLineHtml(stats, escapeHtml) {
  if (!stats || typeof stats.total !== "number" || stats.total < 1) {
    return "";
  }
  const closed = (stats.done || 0) + (stats.skipped || 0);
  const parts = [`${stats.completionPercent}%`, `${closed}/${stats.total} closed`];
  if ((stats.running || 0) > 0) parts.push(`${stats.running} running`);
  if ((stats.blocked || 0) > 0) parts.push(`${stats.blocked} blocked`);
  if ((stats.failed || 0) > 0) parts.push(`${stats.failed} failed`);
  parts.push(`pass ${stats.roundsCompleted}/${stats.maxAutoRounds}`);
  const etaMs = stats.estimatedRemainingMs;
  if (typeof etaMs === "number" && etaMs > 5000 && (stats.avgStepMs || 0) > 0) {
    const sec = Math.round(etaMs / 1000);
    if (sec < 120) parts.push(`~${sec}s est.`);
    else if (sec < 7200) parts.push(`~${Math.round(sec / 60)}m est.`);
    else parts.push(`~${Math.round(sec / 3600)}h est.`);
  }
  if (stats.dryRun) parts.push("dry run");
  return `<div class="meta mission-progress-dashboard" title="Progress from host snapshot">${escapeHtml(parts.join(" • "))}</div>`;
}
