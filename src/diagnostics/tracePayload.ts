import type { TraceRecord, TraceSide } from "./traceTypes";
import { parseTraceLevel } from "./traceLevel";

/** Validate and normalize a webview-emitted trace payload before host logging. */
export function normalizeWebviewTracePayload(
  raw: unknown,
  fallbackSessionId: string
): { ok: true; record: Omit<TraceRecord, "ts" | "seq"> } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "payload_not_object" };
  }
  const o = raw as Record<string, unknown>;
  const event = o.event;
  if (typeof event !== "string" || !event.trim()) {
    return { ok: false, reason: "missing_event" };
  }
  const level = parseTraceLevel(typeof o.level === "string" ? o.level : undefined) ?? "debug";
  const category = typeof o.category === "string" && o.category.trim() ? o.category : "webview";
  const sessionId = typeof o.sessionId === "string" && o.sessionId.trim() ? o.sessionId : fallbackSessionId;
  const side: TraceSide = "webview";
  const interactionId = typeof o.interactionId === "string" && o.interactionId.trim() ? o.interactionId : undefined;
  const activeTab = typeof o.activeTab === "string" ? o.activeTab : undefined;
  const messageType = typeof o.messageType === "string" ? o.messageType : undefined;
  const okField = typeof o.ok === "boolean" ? o.ok : undefined;
  let data: Record<string, unknown> | undefined;
  if (o.data !== undefined) {
    if (!o.data || typeof o.data !== "object" || Array.isArray(o.data)) {
      return { ok: false, reason: "invalid_data" };
    }
    data = { ...(o.data as Record<string, unknown>) };
  }
  return {
    ok: true,
    record: {
      level,
      side,
      sessionId,
      interactionId,
      category,
      event: event.trim(),
      activeTab,
      messageType,
      ok: okField,
      data
    }
  };
}
