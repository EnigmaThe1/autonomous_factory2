import type { TraceLevel, TraceRecord } from "../diagnostics/traceTypes";
import type { UiToExtMessage } from "./protocol";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";
import { TRACE_UI_TAIL_MAX } from "./webviewStabilityConstants";

function traceLogSnapshotForUi(full: readonly TraceRecord[], traceLevel: TraceLevel) {
  const totalBuffered = full.length;
  const traceUiTruncated = totalBuffered > TRACE_UI_TAIL_MAX;
  const entries = traceUiTruncated ? [...full.slice(-TRACE_UI_TAIL_MAX)] : [...full];
  return {
    type: "traceLogSnapshot" as const,
    entries,
    traceLevel,
    totalBuffered,
    traceUiTailMax: TRACE_UI_TAIL_MAX,
    traceUiTruncated
  };
}

export async function dispatchUi_searchGlobalMemory(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "searchGlobalMemory" }>
): Promise<boolean> {
  const results = host.globalMemory
    .search(msg.query, 12)
    .map((item) => ({ id: item.id, ts: item.ts, kind: item.kind, text: item.text }));
  host.postMessage({ type: "memorySearchResults", query: msg.query, results });
  return true;
}

export async function dispatchUi_requestTraceLog(host: AiSidebarUiDispatchHost): Promise<boolean> {
  const entries = host.traceLogger.getBufferSnapshot();
  host.postMessage(traceLogSnapshotForUi(entries, host.traceLogger.getConfiguredLevel()));
  return true;
}

export async function dispatchUi_clearTraceLogFromUi(host: AiSidebarUiDispatchHost): Promise<boolean> {
  host.traceLogger.clear();
  host.postMessage(traceLogSnapshotForUi([], host.traceLogger.getConfiguredLevel()));
  host.postMessage({ type: "info", message: "Autonomous Factory: trace log cleared." });
  return true;
}

export async function dispatchUi_exportTraceLogFromUi(host: AiSidebarUiDispatchHost): Promise<boolean> {
  const fp = await host.traceLogger.exportBufferToFile();
  host.postMessage({ type: "traceExportResult", path: fp });
  host.postMessage({ type: "info", message: `Autonomous Factory: trace exported to ${fp}` });
  return true;
}

export async function dispatchUi_setTraceLevelFromUi(
  host: AiSidebarUiDispatchHost,
  msg: Extract<UiToExtMessage, { type: "setTraceLevelFromUi" }>
): Promise<boolean> {
  await host.traceLogger.setConfiguredLevel(msg.level);
  const after = host.traceLogger.getBufferSnapshot();
  host.postMessage(traceLogSnapshotForUi(after, host.traceLogger.getConfiguredLevel()));
  return true;
}

export async function dispatchUi_openTraceOutputChannel(host: AiSidebarUiDispatchHost): Promise<boolean> {
  host.traceLogger.show();
  return true;
}
