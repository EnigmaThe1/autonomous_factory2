/** Max trace rows sent to the webview for live display (full buffer stays on host for export). */
export const TRACE_UI_TAIL_MAX = 800;

/** Max characters retained in the sidebar chat buffer (streaming tail; markdown render cost bounded). */
export const CHAT_SIDEBAR_MAX_CHARS = 120_000;

/** Rough estimated serialized snapshot size (bytes) at/above which we log an info-level pressure event. */
export const SNAPSHOT_PAYLOAD_WARN_ROUGH_BYTES = 2_500_000;
