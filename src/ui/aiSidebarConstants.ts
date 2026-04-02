/** Built-in tool ids surfaced in the sidebar tools summary. */
export const SIDEBAR_BUILTIN_TOOLS = [
  "readFile",
  "writeFile",
  "applyPatch",
  "searchFiles",
  "listFiles",
  "getDiagnostics",
  "runTerminal",
  "listTools",
  "listMcpTools"
] as const;

/** Workspace-scoped UI preference: Missions dashboard “Show archived” filter (extension host is source of truth). */
export const MISSION_LIST_INCLUDE_ARCHIVED_KEY = "myAi.ui.missionListIncludeArchived";

export const SECTION_EVENT_COALESCE_MS = 50;
export const MISSION_HOST_TRUTH_COALESCE_MS = 50;

export const MCP_ONBOARDING_CACHE_TTL_MS = 30_000;
export const MCP_TOOLS_SESSIONS_TTL_MS = 15_000;
export const PROVIDER_CREDENTIAL_ENTRY_TTL_MS = 15_000;

/**
 * Sidebar dashboard poll interval (`myAi.ui.dashboardPollIntervalMs`).
 * Keep in sync with `package.json` contributes.configuration minimum, maximum, and default.
 */
export const DASHBOARD_POLL_INTERVAL_MS_MIN = 2000;
export const DASHBOARD_POLL_INTERVAL_MS_MAX = 120_000;
export const DASHBOARD_POLL_INTERVAL_MS_DEFAULT = 25_000;

export function clampDashboardPollIntervalMs(n: number): number {
  return Math.min(DASHBOARD_POLL_INTERVAL_MS_MAX, Math.max(DASHBOARD_POLL_INTERVAL_MS_MIN, Math.floor(n)));
}
