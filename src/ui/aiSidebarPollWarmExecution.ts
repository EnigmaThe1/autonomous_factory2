import type { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import type { DashboardRefreshSource } from "../diagnostics/dashboardRefreshSource";
import { decidePollDashboardRoute } from "./aiSidebarPollDecision";

/**
 * Host facade for warm poll tick execution (fingerprints already computed vs baseline).
 * Effectful section posts + `refreshDashboard` stay as host callbacks.
 */
export type SidebarPollWarmExecutionHost = {
  traceLogger: ExtensionTraceLogger;
  computeMissionFingerprintForPollRoute: () => {
    missionFp: string;
    usedPollMissionFingerprintCache: boolean;
    recomputeReason?: string;
  };
  computeGlobalMemoryHeadFingerprintForPollRoute: () => {
    memFp: string;
    usedPollGlobalMemoryHeadCache: boolean;
  };
  computeProviderChromeFingerprintLive: () => Promise<{
    fingerprint: string;
    usedWarmCredentialPath: boolean;
    providerSyncShortcut?: boolean;
  }>;
  postAuxiliarySectionImmediate: () => Promise<{
    published: boolean;
    usedWarmAuxiliaryCache: boolean;
    auxiliaryPollStableFpNoop?: boolean;
    auxiliaryPollWarmProbeDeduped?: boolean;
    auxiliarySameTickWarmSliceReuse?: boolean;
  }>;
  postGlobalMemorySectionImmediate: () => void;
  postMissionDashboardSnapshotImmediate: (interactionId?: string) => void;
  postProviderSettingsChromeSectionImmediate: (
    interactionId: string | undefined,
    traceEvent: string,
    extraTrace?: Record<string, unknown>
  ) => Promise<void>;
  refreshDashboard: (
    interactionId?: string,
    options?: { source?: DashboardRefreshSource }
  ) => Promise<void>;
};

/**
 * Warm poll path: fingerprint probes, route decision, sectional or full refresh (cold path handled by caller).
 */
export async function runSidebarPollWarmExecution(
  host: SidebarPollWarmExecutionHost,
  pollKind: "interval" | "visibility" | "reveal",
  baseline: {
    missionFp: string;
    globalMemFp: string;
    providerChromeFp: string;
  }
): Promise<void> {
  const b = baseline;
  const tTickStart = performance.now();
  let missionMs = 0;
  let memMs = 0;
  let providerMs = 0;

  let tSeg = performance.now();
  const missionPoll = host.computeMissionFingerprintForPollRoute();
  missionMs = performance.now() - tSeg;

  tSeg = performance.now();
  const memPoll = host.computeGlobalMemoryHeadFingerprintForPollRoute();
  memMs = performance.now() - tSeg;

  tSeg = performance.now();
  const providerPoll = await host.computeProviderChromeFingerprintLive();
  providerMs = performance.now() - tSeg;

  const missionFpNow = missionPoll.missionFp;
  const memFpNow = memPoll.memFp;
  const providerFpNow = providerPoll.fingerprint;
  const missionOk = missionFpNow === b.missionFp;
  const memOk = memFpNow === b.globalMemFp;
  const providerOk = providerFpNow === b.providerChromeFp;

  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const mkWarmBudget = (extra?: {
    auxMs?: number;
    auxiliaryPublished?: boolean;
    auxiliaryWarmCache?: boolean;
    auxiliaryPollStableFpNoop?: boolean;
    auxiliaryPollWarmProbeDeduped?: boolean;
    auxiliarySameTickWarmSliceReuse?: boolean;
  }) => ({
    totalMs: r3(performance.now() - tTickStart),
    missionMs: r3(missionMs),
    memMs: r3(memMs),
    providerMs: r3(providerMs),
    auxMs: r3(extra?.auxMs ?? 0),
    missionFpShortcut: missionPoll.usedPollMissionFingerprintCache,
    memHeadFpShortcut: memPoll.usedPollGlobalMemoryHeadCache,
    providerCredShortcut: providerPoll.usedWarmCredentialPath,
    providerSyncShortcut: providerPoll.providerSyncShortcut === true,
    dominantNonProviderMsLeg:
      missionMs > memMs ? "mission" : missionMs < memMs ? "memory" : "tie",
    mmFpBothShortcut: missionPoll.usedPollMissionFingerprintCache && memPoll.usedPollGlobalMemoryHeadCache,
    auxiliaryPublished: extra?.auxiliaryPublished,
    auxiliaryWarmCache: extra?.auxiliaryWarmCache,
    auxiliaryPollStableFpNoop: extra?.auxiliaryPollStableFpNoop,
    auxiliaryPollWarmProbeDeduped: extra?.auxiliaryPollWarmProbeDeduped,
    auxiliarySameTickWarmSliceReuse: extra?.auxiliarySameTickWarmSliceReuse
  });

  const route = decidePollDashboardRoute(missionOk, memOk, providerOk);
  if (route.kind === "auxiliary_section") {
    tSeg = performance.now();
    const auxRes = await host.postAuxiliarySectionImmediate();
    const auxMs = performance.now() - tSeg;
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "dashboard",
      event: "poll_tick_route",
      data: {
        pollKind,
        outcome: auxRes.published ? "auxiliary_section" : "auxiliary_section_noop",
        buildSnapshot: false,
        auxiliaryPublished: auxRes.published,
        warmBudget: mkWarmBudget({
          auxMs,
          auxiliaryPublished: auxRes.published,
          auxiliaryWarmCache: auxRes.usedWarmAuxiliaryCache,
          auxiliaryPollStableFpNoop: auxRes.auxiliaryPollStableFpNoop,
          auxiliaryPollWarmProbeDeduped: auxRes.auxiliaryPollWarmProbeDeduped,
          auxiliarySameTickWarmSliceReuse: auxRes.auxiliarySameTickWarmSliceReuse
        })
      }
    });
    return;
  }
  if (route.kind === "global_memory_section") {
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "dashboard",
      event: "poll_tick_route",
      data: { pollKind, outcome: "global_memory_section", buildSnapshot: false, warmBudget: mkWarmBudget() }
    });
    await host.postGlobalMemorySectionImmediate();
    return;
  }
  if (route.kind === "missions_section") {
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "dashboard",
      event: "poll_tick_route",
      data: {
        pollKind,
        outcome: "missions_section",
        buildSnapshot: false,
        reason: route.reason,
        warmBudget: mkWarmBudget()
      }
    });
    host.postMissionDashboardSnapshotImmediate(undefined);
    return;
  }
  if (route.kind === "provider_chrome_section") {
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "dashboard",
      event: "poll_tick_route",
      data: {
        pollKind,
        outcome: "provider_chrome_section",
        buildSnapshot: false,
        reason: route.reason,
        warmBudget: mkWarmBudget()
      }
    });
    await host.postProviderSettingsChromeSectionImmediate(undefined, "refresh_dashboard_provider_chrome_poll_section_post", {
      reason: "poll_baseline_provider_only_drift"
    });
    return;
  }
  if (route.kind === "multi_section") {
    host.traceLogger.log({
      level: "info",
      side: "host",
      category: "dashboard",
      event: "poll_tick_route",
      data: {
        pollKind,
        outcome: "multi_section",
        buildSnapshot: false,
        reason: route.reason,
        sections: route.sections,
        warmBudget: mkWarmBudget()
      }
    });
    if (route.reason === "mission_and_global_memory_drift") {
      host.postMissionDashboardSnapshotImmediate(undefined);
      host.postGlobalMemorySectionImmediate();
      return;
    }
    if (route.reason === "mission_and_provider_drift") {
      await host.postProviderSettingsChromeSectionImmediate(undefined, "refresh_dashboard_provider_chrome_poll_section_post", {
        reason: "poll_multiaxis_before_missions_merge"
      });
      host.postMissionDashboardSnapshotImmediate(undefined);
      return;
    }
    if (route.reason === "global_memory_and_provider_drift") {
      host.postGlobalMemorySectionImmediate();
      await host.postProviderSettingsChromeSectionImmediate(undefined, "refresh_dashboard_provider_chrome_poll_section_post", {
        reason: "poll_multiaxis_memory_then_provider"
      });
      return;
    }
    await host.postProviderSettingsChromeSectionImmediate(undefined, "refresh_dashboard_provider_chrome_poll_section_post", {
      reason: "poll_multiaxis_all_three_provider_first"
    });
    host.postMissionDashboardSnapshotImmediate(undefined);
    host.postGlobalMemorySectionImmediate();
    return;
  }
  host.traceLogger.log({
    level: "info",
    side: "host",
    category: "dashboard",
    event: "poll_tick_route",
    data: {
      pollKind,
      outcome: "full_refresh",
      reason: route.reason,
      buildSnapshot: true,
      missionOk: route.missionOk,
      memOk: route.memOk,
      providerOk: route.providerOk,
      warmBudget: mkWarmBudget()
    }
  });
  await host.refreshDashboard(undefined, { source: "poll_fallback_full" });
}
