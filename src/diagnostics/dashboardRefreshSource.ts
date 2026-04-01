/**
 * Attributable origin of a queued full-dashboard refresh (`buildSnapshot` → `snapshot` post).
 * Used for trace churn analysis: filter JSONL by `event` + `data.refreshSource`.
 */
export type DashboardRefreshSource =
  /** Caller did not tag (legacy); treat as background in metrics. */
  | "unspecified_background"
  /** `reveal()` while webview not yet attached — full refresh still queued for eventual post. */
  | "reveal_before_webview"
  /** `maybePollDashboardRefresh` fell back to full build (baseline drift or cold state). */
  | "poll_fallback_full"
  /** Superseded cycle or build error follow-up (`setTimeout(..., 0)`). */
  | "dashboard_flush_followup"
  /** After mission section / focus tail (`scheduleBackgroundDashboardReconciliation`). */
  | "background_reconcile"
  /** Webview Refresh control (`refreshDashboard` message). */
  | "manual_refresh"
  /** Default post-handler `await refreshDashboard(msgInteractionId)` for messages that did not suppress. */
  | "handler_tail"
  /**
   * `refreshDashboard(interactionId)` without an explicit `source` option (e.g. external or future call sites).
   */
  | "interaction_untagged"
  /** Webview `ready` → first `init` snapshot (not queued via `refreshDashboard`). */
  | "init_ready";
