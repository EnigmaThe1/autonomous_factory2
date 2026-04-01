export type TraceLevel = "error" | "info" | "debug" | "trace";

export type TraceSide = "host" | "webview";

/** Canonical record written to the output channel, buffer, and exports. */
export interface TraceRecord {
  ts: string;
  seq: number;
  level: TraceLevel;
  side: TraceSide;
  sessionId: string;
  interactionId?: string;
  category: string;
  event: string;
  activeTab?: string;
  messageType?: string;
  ok?: boolean;
  data?: Record<string, unknown>;
}

/** Caller supplies level/side/category/event; `ts` and `sessionId` default in the logger. */
export type TraceLogInput = Omit<TraceRecord, "seq" | "ts" | "sessionId"> & Partial<Pick<TraceRecord, "ts" | "sessionId">>;
