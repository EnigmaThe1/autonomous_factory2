import type { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import type { DashboardRefreshSource } from "../diagnostics/dashboardRefreshSource";
import type { SidebarSnapshot } from "./protocol";

/**
 * Host facade for full-dashboard refresh enqueue + cycle execution.
 * Implemented by `AiSidebarProvider` via bound closures (state stays on the provider).
 */
export type SidebarRefreshOrchestrationHost = {
  traceLogger: ExtensionTraceLogger;
  getBackgroundRefreshTailCoalesced: () => boolean;
  setBackgroundRefreshTailCoalesced: (v: boolean) => void;
  getBackgroundRefreshRequestGen: () => number;
  /** Increment monotonic background refresh generation; return new value. */
  nextBackgroundRefreshRequestGen: () => number;
  getRefreshQueue: () => Promise<void>;
  setRefreshQueue: (p: Promise<void>) => void;
  getIncludeArchivedMissions: () => boolean;
  /** Pre-increment dashboard refresh seq; return new seq (same as `++dashboardRefreshSeq`). */
  nextDashboardRefreshSeq: () => number;
  getDashboardRefreshSeq: () => number;
  buildSnapshot: () => Promise<SidebarSnapshot>;
  materialFingerprintFromSnapshot: (snapshot: SidebarSnapshot) => string;
  getLastPublishedFullMaterialFp: () => string | undefined;
  setLastPublishedFullMaterialFp: (v: string | undefined) => void;
  getLastFullRefreshCycleMeta: () =>
    | { materialFp: string; source: DashboardRefreshSource }
    | undefined;
  setLastFullRefreshCycleMeta: (
    v: { materialFp: string; source: DashboardRefreshSource } | undefined
  ) => void;
  scheduleDashboardFlush: () => void;
  sealSnapshotForPost: (snapshot: SidebarSnapshot, sourceRefreshSeq: number) => SidebarSnapshot;
  postSnapshotForFullRefresh: (snapshot: SidebarSnapshot, interactionId?: string) => void;
};

/**
 * Queue refresh cycles strictly one-after-another; background coalescing + supersession unchanged from in-class implementation.
 */
export async function enqueueSidebarRefreshDashboard(
  host: SidebarRefreshOrchestrationHost,
  interactionId: string | undefined,
  options?: { source?: DashboardRefreshSource }
): Promise<void> {
  const refreshSource: DashboardRefreshSource =
    options?.source ?? (interactionId ? "interaction_untagged" : "unspecified_background");
  const coalesceBackground = !interactionId;
  if (coalesceBackground && host.getBackgroundRefreshTailCoalesced()) {
    host.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "refresh_dashboard_background_coalesced_skip",
      data: { refreshSource }
    });
    return Promise.resolve();
  }
  if (coalesceBackground) {
    host.setBackgroundRefreshTailCoalesced(true);
  }
  let capturedBackgroundGen: number | undefined;
  if (!interactionId) {
    capturedBackgroundGen = host.nextBackgroundRefreshRequestGen();
  }
  const enqueuedAt = Date.now();
  const job = host.getRefreshQueue().then(async () => {
    const queueWaitMs = Date.now() - enqueuedAt;
    if (coalesceBackground) {
      host.setBackgroundRefreshTailCoalesced(false);
    }
    await runSidebarRefreshDashboardCycle(
      host,
      interactionId,
      queueWaitMs,
      capturedBackgroundGen,
      refreshSource
    );
  });
  host.setRefreshQueue(
    job.catch(() => {
      if (coalesceBackground) {
        host.setBackgroundRefreshTailCoalesced(false);
      }
    })
  );
  return job;
}

/** Single serialized refresh cycle: supersede check, build, stale drop, post, trace. */
export async function runSidebarRefreshDashboardCycle(
  host: SidebarRefreshOrchestrationHost,
  interactionId: string | undefined,
  queueWaitMs: number,
  capturedBackgroundGen: number | undefined,
  refreshSource: DashboardRefreshSource
): Promise<void> {
  if (
    capturedBackgroundGen !== undefined &&
    capturedBackgroundGen !== host.getBackgroundRefreshRequestGen()
  ) {
    host.traceLogger.log({
      level: "debug",
      side: "host",
      category: "dashboard",
      event: "refresh_dashboard_background_superseded_before_cycle",
      data: {
        capturedGen: capturedBackgroundGen,
        latestGen: host.getBackgroundRefreshRequestGen(),
        refreshSource
      }
    });
    return;
  }
  const seq = host.nextDashboardRefreshSeq();
  host.traceLogger.log({
    level: "info",
    side: "host",
    category: "dashboard",
    event: "refresh_dashboard_start",
    interactionId,
    data: {
      refreshSource,
      seq,
      includeArchived: host.getIncludeArchivedMissions(),
      serializedRefresh: true,
      queueWaitMs,
      coalescibleBackground: !interactionId
    }
  });
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "dashboard",
    event: "refresh_dashboard_cycle_enter",
    interactionId,
    data: { seq, queueWaitMs, refreshSource }
  });
  const buildStartedAt = Date.now();
  try {
    const snapshot = await host.buildSnapshot();
    const buildDurationMs = Date.now() - buildStartedAt;
    const materialFp = host.materialFingerprintFromSnapshot(snapshot);
    const unchangedFromLastPublishedFull =
      host.getLastPublishedFullMaterialFp() !== undefined && materialFp === host.getLastPublishedFullMaterialFp();
    const lastMeta = host.getLastFullRefreshCycleMeta();
    const redundantWithPreviousCycle =
      lastMeta !== undefined &&
      lastMeta.materialFp === materialFp &&
      lastMeta.source === refreshSource;
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "dashboard",
      event: "refresh_dashboard_snapshot_built",
      interactionId,
      data: {
        refreshSource,
        seq,
        buildDurationMs,
        materialFpLen: materialFp.length,
        unchangedFromLastPublishedFull,
        redundantWithPreviousCycle,
        missions: snapshot.missions.length,
        totalCount: snapshot.missionList?.totalCount ?? snapshot.missions.length,
        includeArchived: snapshot.missionList?.includeArchived ?? false,
        missionIdsHead: snapshot.missions.slice(0, 6).map((m) => m.id)
      }
    });
    if (unchangedFromLastPublishedFull) {
      host.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "refresh_dashboard_full_build_material_noop_vs_last_publish",
        interactionId,
        data: { refreshSource, seq, buildDurationMs }
      });
    }
    if (seq !== host.getDashboardRefreshSeq()) {
      host.traceLogger.log({
        level: "debug",
        side: "host",
        category: "dashboard",
        event: "refresh_dashboard_discarded",
        interactionId,
        data: {
          refreshSource,
          seq,
          latestSeq: host.getDashboardRefreshSeq(),
          reason: "superseded_before_post",
          buildRan: true,
          buildDurationMs
        }
      });
      host.scheduleDashboardFlush();
      return;
    }
    const sealed = host.sealSnapshotForPost(snapshot, seq);
    host.setLastPublishedFullMaterialFp(materialFp);
    host.setLastFullRefreshCycleMeta({ materialFp, source: refreshSource });
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "dashboard",
      event: "refresh_dashboard_posting",
      interactionId,
      data: {
        refreshSource,
        seq,
        snapshotPublishSeq: sealed.snapshotPublishSeq,
        missions: sealed.missions.length,
        includeArchived: sealed.missionList?.includeArchived ?? false,
        buildDurationMs
      }
    });
    host.postSnapshotForFullRefresh(sealed, interactionId);
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "dashboard",
      event: "refresh_dashboard_cycle_complete",
      interactionId,
      data: {
        refreshSource,
        seq,
        published: true,
        queueWaitMs,
        buildDurationMs,
        unchangedFromLastPublishedFull
      }
    });
  } catch (err) {
    host.traceLogger.log({
      level: "error",
      side: "host",
      category: "dashboard",
      event: "refresh_dashboard_error",
      interactionId,
      ok: false,
      data: {
        refreshSource,
        seq,
        buildRan: true,
        buildDurationMs: Date.now() - buildStartedAt,
        error: err instanceof Error ? err.message : String(err)
      }
    });
    host.scheduleDashboardFlush();
    throw err;
  }
}
