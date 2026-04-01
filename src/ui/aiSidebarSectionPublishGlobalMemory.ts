import * as fp from "./aiSidebarFingerprints";
import { buildGlobalMemoryContextHostSlice, cloneSnapshotWithoutFastRefreshKind } from "./aiSidebarSnapshotMisc";
import type { AiSidebarSectionPublishHost } from "./aiSidebarSectionPublishHost";

/**
 * Global memory head only: merges `globalMemoryRecent` into `lastPostedSnapshot` (no missions/MCP/provider rebuild).
 */
export function postGlobalMemorySectionImmediateForHost(host: AiSidebarSectionPublishHost): void {
  if (!host.getWebviewView()?.webview) return;
  const last = host.getLastPostedSnapshot();
  if (!last) return;
  const sectionBasePublishSeq = last.snapshotPublishSeq ?? 0;
  const slice = buildGlobalMemoryContextHostSlice(host.globalMemory);
  const merged = {
    ...cloneSnapshotWithoutFastRefreshKind(last),
    ...slice
  };
  const sectionSeq = host.bumpGlobalMemorySectionSeq();
  host.traceLogger.log({
    level: "info",
    side: "host",
    category: "dashboard",
    event: "refresh_dashboard_global_memory_section_post",
    data: { sectionSeq, sectionBasePublishSeq }
  });
  host.postMessage({
    type: "snapshotSection",
    section: "globalMemory",
    snapshot: merged,
    sectionSeq,
    sectionBasePublishSeq
  });
}

export function flushGlobalMemorySectionFromEventIfNeededForHost(host: AiSidebarSectionPublishHost): void {
  if (!host.getWebviewView()?.webview) return;
  const last = host.getLastPostedSnapshot();
  if (!last) return;
  const nextFp = host.globalMemoryHeadFingerprintFromStoreHead();
  const prevFp = fp.globalMemoryHeadFingerprint(last.globalMemoryRecent);
  if (nextFp === prevFp) return;
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "dashboard",
    event: "global_memory_section_event_publish",
    data: { nextFpLen: nextFp.length, prevFpLen: prevFp.length }
  });
  postGlobalMemorySectionImmediateForHost(host);
}
