/**
 * Numeric clamps aligned with `package.json` contributes.configuration (and runner invariants).
 * When schema min/max/default change, update here and the manifest together.
 */

/** `myAi.ui.dashboardPollIntervalMs` */
export const DASHBOARD_POLL_INTERVAL_MS_MIN = 2000;
export const DASHBOARD_POLL_INTERVAL_MS_MAX = 120_000;
export const DASHBOARD_POLL_INTERVAL_MS_DEFAULT = 25_000;

export function clampDashboardPollIntervalMs(n: number): number {
  return Math.min(DASHBOARD_POLL_INTERVAL_MS_MAX, Math.max(DASHBOARD_POLL_INTERVAL_MS_MIN, Math.floor(n)));
}

/** `myAi.ui.traceAutoRefreshIntervalMs` */
export const TRACE_AUTO_REFRESH_INTERVAL_MS_MIN = 3000;
export const TRACE_AUTO_REFRESH_INTERVAL_MS_MAX = 120_000;
export const TRACE_AUTO_REFRESH_INTERVAL_MS_DEFAULT = 10_000;

export function clampTraceAutoRefreshIntervalMs(n: number): number {
  return Math.min(TRACE_AUTO_REFRESH_INTERVAL_MS_MAX, Math.max(TRACE_AUTO_REFRESH_INTERVAL_MS_MIN, Math.floor(n)));
}

/** `myAi.index.incrementalSaveDebounceMs` */
export const INDEX_INCREMENTAL_SAVE_DEBOUNCE_MS_MIN = 200;
export const INDEX_INCREMENTAL_SAVE_DEBOUNCE_MS_MAX = 30_000;
export const INDEX_INCREMENTAL_SAVE_DEBOUNCE_MS_DEFAULT = 2000;

export function clampIndexIncrementalSaveDebounceMs(n: number): number {
  return Math.min(INDEX_INCREMENTAL_SAVE_DEBOUNCE_MS_MAX, Math.max(INDEX_INCREMENTAL_SAVE_DEBOUNCE_MS_MIN, Math.floor(n)));
}

/** Background runner floor (seconds); `myAi.missions.heartbeatSeconds` has no package.json minimum. */
export const MISSION_HEARTBEAT_SECONDS_MIN = 3;
export const MISSION_HEARTBEAT_SECONDS_DEFAULT = 12;

export function clampMissionHeartbeatSeconds(n: number): number {
  return Math.max(MISSION_HEARTBEAT_SECONDS_MIN, Math.floor(n));
}

/** `myAi.mcp.sessionWarmupStaggerMs` */
export const MCP_SESSION_WARMUP_STAGGER_MS_MAX = 60_000;

export function clampMcpSessionWarmupStaggerMs(n: number): number {
  return Math.max(0, Math.min(MCP_SESSION_WARMUP_STAGGER_MS_MAX, Math.floor(Number.isFinite(n) ? n : 0)));
}
