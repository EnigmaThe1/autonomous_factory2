import type { Mission } from "../types";
import { focusedMissionHardStopDataQualityHintForSnapshot } from "../missions/missionHardStopDataQualityPresentation";
import { focusedMissionDownstreamGatingHintForSnapshot } from "../missions/missionDownstreamGatingPresentation";
import { missionDownstreamGatingCardHint } from "../missions/missionDownstreamGatingPresentation";
import { focusedMissionLatestOperatorActionNoteForSnapshot } from "../missions/missionLatestOperatorActionPresentation";
import {
  missionListLatestOperatorActionHeadlinesForMissions,
  operatorActionHeadlinesByEventIdForMission
} from "../missions/missionOperatorActionEventPresentation";
import { focusedMissionLifecycleSummaryForSnapshot } from "../missions/missionLifecycleSummaryPresentation";
import { focusedMissionRequiredWorkHintForSnapshot } from "../missions/missionRequiredWorkPresentation";
import type { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import { routingPresetTemplatesForUi } from "../missions/missionRouting";
import { computeAllMissionProgressStats } from "./missionProgressStats";
import { buildGlobalMemoryContextHostSlice, missionAllAndVisibleForFingerprint } from "./aiSidebarSnapshotMisc";
import type { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import type { MissionStore } from "../missions/MissionStore";
import type {
  SidebarAgentLiveItem,
  SidebarAgentStatus,
  SidebarSnapshot,
  SidebarToolSummary
} from "./protocol";
import { SIDEBAR_BUILTIN_TOOLS } from "./aiSidebarConstants";
import type { McpAuxiliaryWarmMaterializedSlice, McpAuxiliaryWarmRead } from "./aiSidebarMcpAuxiliaryTypes";

/** Provider/settings chrome fields merged into full snapshot (same as `buildProviderSettingsChromeHostSliceEager` output). */
export type SidebarChromeSlice = Pick<
  SidebarSnapshot,
  | "providers"
  | "defaultProvider"
  | "defaultModel"
  | "resolvedDefaultModel"
  | "providerCredentialStatus"
  | "providerModelPresets"
  | "providerLiveModelCatalog"
  | "lastProviderTest"
  | "providerHealth"
  | "providerBaseUrls"
  | "providerSavedModels"
  | "settings"
>;

/**
 * Host facade for full `buildSnapshot` orchestration; state remains on `AiSidebarProvider`.
 */
export type AiSidebarBuildSnapshotHost = {
  traceLogger: ExtensionTraceLogger;
  resetCredResolutionProfile: () => void;
  getCredResolutionHits: () => number;
  getCredResolutionMisses: () => number;
  resolveProviderSettingsChromeHostSlice: (
    resolveFor: "build_snapshot" | "provider_section"
  ) => Promise<{ slice: SidebarChromeSlice; usedWarmCredentialCache: boolean }>;
  resolveMcpAuxiliarySlice: (
    resolveFor: "dashboard_section" | "build_snapshot",
    opts?: {
      reuseAuxiliaryWarmProbe: McpAuxiliaryWarmRead | undefined;
      reuseSameTickWarmSlice?: McpAuxiliaryWarmMaterializedSlice;
    }
  ) => Promise<{
    slice: {
      mcpOnboarding: SidebarSnapshot["mcpOnboarding"];
      mcpToolCount: number;
      mcpSessionCount: number;
    };
    usedWarmCaches: boolean;
    sameTickWarmSliceReuse?: boolean;
  }>;
  globalMemory: GlobalMemoryStore;
  missionStore: MissionStore;
  getIncludeArchivedMissions: () => boolean;
  resolveFocusedMission: (missions: Mission[]) => Mission | undefined;
  buildAgentStatus: (
    mission: Mission | undefined,
    defaultProvider: string,
    defaultModel: string
  ) => SidebarAgentStatus[];
  computeMissionDerivedSlices: (
    missions: Mission[],
    allMissions: Mission[]
  ) => {
    pendingApprovals: SidebarSnapshot["pendingApprovals"];
    approvalBundles: SidebarSnapshot["approvalBundles"];
    timeline: SidebarSnapshot["timeline"];
    recentToolEvents: NonNullable<SidebarToolSummary["recentToolEvents"]>;
    missionDerivedCacheHit: boolean;
    missionDerivedRecomputeMeta?: { singlePassPendingForBundles: boolean; toolTailReverseScan: boolean };
  };
  buildAgentLive: (mission: Mission | undefined) => SidebarAgentLiveItem[];
};

/**
 * Full sidebar snapshot build: parallel provider+MCP, then global memory, then missions (ordering invariant preserved).
 */
export async function buildSidebarDashboardSnapshot(host: AiSidebarBuildSnapshotHost): Promise<SidebarSnapshot> {
  const t0 = Date.now();
  host.resetCredResolutionProfile();
  const tParallelStart = Date.now();
  const [{ slice: chrome, usedWarmCredentialCache: providerChromeWarmBypass }, { slice: aux, usedWarmCaches: mcpAuxiliaryWarmBypass }] =
    await Promise.all([
      host.resolveProviderSettingsChromeHostSlice("build_snapshot"),
      host.resolveMcpAuxiliarySlice("build_snapshot")
    ]);
  const tAfterParallel = Date.now();
  const { settings, resolvedDefaultModel } = chrome;
  const memSlice = buildGlobalMemoryContextHostSlice(host.globalMemory);
  const tAfterMem = Date.now();
  const { allMissions, missions } = missionAllAndVisibleForFingerprint(
    host.missionStore,
    host.getIncludeArchivedMissions()
  );
  const focusedMission = host.resolveFocusedMission(missions);
  const agents = host.buildAgentStatus(focusedMission, settings.defaultProvider, resolvedDefaultModel);
  const consoleLines = (focusedMission?.events || [])
    .slice(-18)
    .map((event) => `${new Date(event.ts).toLocaleTimeString()} [${event.level}] ${event.source}: ${event.message}`);
  const {
    pendingApprovals,
    approvalBundles,
    timeline,
    recentToolEvents,
    missionDerivedCacheHit,
    missionDerivedRecomputeMeta
  } = host.computeMissionDerivedSlices(missions, allMissions);
  const agentLive = host.buildAgentLive(focusedMission);
  const tAfterMissionAgg = Date.now();
  const tLog = Date.now();
  host.traceLogger.log({
    level: "debug",
    side: "host",
    category: "dashboard",
    event: "build_snapshot_timing_ms",
    data: {
      totalMs: tLog - t0,
      providerMcpAuxParallelWallMs: tAfterParallel - tParallelStart,
      globalMemoryContextMs: tAfterMem - tAfterParallel,
      missionAggMs: tAfterMissionAgg - tAfterMem,
      providerCredCacheHits: host.getCredResolutionHits(),
      providerCredCacheMisses: host.getCredResolutionMisses(),
      missionDerivedCacheHit,
      missionDerivedSinglePassPending: missionDerivedRecomputeMeta?.singlePassPendingForBundles === true,
      missionDerivedToolTailReverseScan: missionDerivedRecomputeMeta?.toolTailReverseScan === true,
      mcpAuxiliaryWarmBypass,
      providerChromeWarmBypass,
      buildSnapshotParallelProviderMcpAux: true
    }
  });
  return {
    ...chrome,
    missions,
    focusedMissionId: focusedMission?.id,
    focusedMission,
    focusedMissionRequiredWorkHint: focusedMissionRequiredWorkHintForSnapshot(focusedMission),
    focusedMissionDownstreamGatingHint: focusedMissionDownstreamGatingHintForSnapshot(focusedMission),
    focusedMissionHardStopDataQualityHint: focusedMissionHardStopDataQualityHintForSnapshot(focusedMission),
    focusedMissionLatestOperatorActionNote: focusedMissionLatestOperatorActionNoteForSnapshot(focusedMission),
    focusedMissionLifecycleSummary: focusedMissionLifecycleSummaryForSnapshot(focusedMission),
    focusedMissionOperatorActionHeadlines: operatorActionHeadlinesByEventIdForMission(focusedMission),
    missionDownstreamGatingCardHints: Object.fromEntries(
      missions
        .map((m) => [m.id, missionDownstreamGatingCardHint(m)])
        .filter(([, v]) => typeof v === "string" && v.length > 0) as Array<[string, string]>
    ),
    missionListLatestOperatorActionHeadlines: missionListLatestOperatorActionHeadlinesForMissions(missions),
    missionProgressStats: computeAllMissionProgressStats(missions),
    ...memSlice,
    consoleLines,
    agents,
    tools: {
      builtinTools: [...SIDEBAR_BUILTIN_TOOLS],
      mcpToolCount: aux.mcpToolCount,
      mcpSessionCount: aux.mcpSessionCount,
      recentToolEvents
    },
    settings,
    pendingApprovals,
    approvalBundles,
    agentLive,
    timeline,
    mcpOnboarding: aux.mcpOnboarding,
    missionList: {
      includeArchived: host.getIncludeArchivedMissions(),
      totalCount: allMissions.length,
      archivedCount: allMissions.filter((m) => !!m.archivedAt).length
    },
    traceSessionId: host.traceLogger.sessionId,
    routingPresetTemplates: routingPresetTemplatesForUi()
  };
}
