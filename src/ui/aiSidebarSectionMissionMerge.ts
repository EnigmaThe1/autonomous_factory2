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
import { focusedMissionAutonomyObservabilityForSnapshot } from "../missions/missionAutonomyObservabilityPresentation";
import { resolveModelForProvider } from "../providers/providerModelResolution";
import { missionAllAndVisibleForFingerprint } from "./aiSidebarSnapshotMisc";
import type { SidebarSnapshot } from "./protocol";
import type { AiSidebarSectionPublishHost } from "./aiSidebarSectionPublishHost";

/**
 * Recompute mission-scoped fields from current store + `includeArchived` using non-mission fields
 * from a recent full snapshot (avoids MCP / secret / onboarding I/O).
 */
export function mergeMissionListIntoSnapshotForHost(
  host: AiSidebarSectionPublishHost,
  base: SidebarSnapshot
): SidebarSnapshot {
  const settings = base.settings;
  const cfg = host.getWorkspaceConfiguration();
  const cfgGet = (k: string, d: unknown) => cfg.get(k, d as never);
  const resolvedDefaultModel = resolveModelForProvider(settings.defaultProvider, undefined, (k, d) => cfg.get(k, d));
  const { allMissions, missions } = missionAllAndVisibleForFingerprint(
    host.missionStore,
    host.getIncludeArchivedMissions()
  );
  const focusedMission = host.resolveFocusedMission(missions);
  const agents = host.buildAgentStatus(focusedMission, settings.defaultProvider, resolvedDefaultModel);
  const consoleLines = (focusedMission?.events || [])
    .slice(-18)
    .map((event) => `${new Date(event.ts).toLocaleTimeString()} [${event.level}] ${event.source}: ${event.message}`);
  const { pendingApprovals, approvalBundles, timeline, recentToolEvents } = host.computeMissionDerivedSlices(
    missions,
    allMissions
  );
  const agentLive = host.buildAgentLive(focusedMission);
  const missionPrograms = host.programDirectory.list();
  const focusedMissionProgram = focusedMission?.programId
    ? host.programDirectory.get(focusedMission.programId) ?? null
    : null;
  return {
    ...base,
    resolvedDefaultModel,
    missions,
    focusedMissionId: focusedMission?.id,
    focusedMission,
    missionPrograms,
    focusedMissionProgram,
    focusedMissionRequiredWorkHint: focusedMissionRequiredWorkHintForSnapshot(focusedMission),
    focusedMissionDownstreamGatingHint: focusedMissionDownstreamGatingHintForSnapshot(focusedMission),
    focusedMissionHardStopDataQualityHint: focusedMissionHardStopDataQualityHintForSnapshot(focusedMission),
    focusedMissionLatestOperatorActionNote: focusedMissionLatestOperatorActionNoteForSnapshot(focusedMission),
    focusedMissionLifecycleSummary: focusedMissionLifecycleSummaryForSnapshot(focusedMission),
    focusedMissionOperatorActionHeadlines: operatorActionHeadlinesByEventIdForMission(focusedMission),
    focusedMissionAutonomyObservability: focusedMissionAutonomyObservabilityForSnapshot(focusedMission, cfgGet),
    missionDownstreamGatingCardHints: Object.fromEntries(
      missions
        .map((m) => [m.id, missionDownstreamGatingCardHint(m)])
        .filter(([, v]) => typeof v === "string" && v.length > 0) as Array<[string, string]>
    ),
    missionListLatestOperatorActionHeadlines: missionListLatestOperatorActionHeadlinesForMissions(missions),
    consoleLines,
    agents,
    tools: {
      ...base.tools,
      recentToolEvents
    },
    pendingApprovals,
    approvalBundles,
    agentLive,
    timeline,
    missionList: {
      includeArchived: host.getIncludeArchivedMissions(),
      totalCount: allMissions.length,
      archivedCount: allMissions.filter((m) => !!m.archivedAt).length
    },
    traceSessionId: host.getTraceSessionId(),
    fastRefreshKind: "mission"
  };
}

/**
 * Immediate mission-scoped snapshot (list, focus, approvals slice, timeline, agents for focused mission).
 * Skips slow `buildSnapshot` I/O so the UI updates without waiting on `refreshQueue`.
 */
export function postMissionDashboardSnapshotImmediateForHost(
  host: AiSidebarSectionPublishHost,
  interactionId?: string
): void {
  const last = host.getLastPostedSnapshot();
  if (!last) return;
  const merged = mergeMissionListIntoSnapshotForHost(host, last);
  const sectionBasePublishSeq = last.snapshotPublishSeq ?? 0;
  const missionsSectionSeq = host.bumpMissionsSectionSeq();
  host.traceLogger.log({
    level: "info",
    side: "host",
    category: "dashboard",
    event: "refresh_dashboard_missions_section_post",
    interactionId,
    data: {
      missions: merged.missions.length,
      includeArchived: merged.missionList?.includeArchived ?? false,
      totalCount: merged.missionList?.totalCount,
      sectionSeq: missionsSectionSeq,
      sectionBasePublishSeq
    }
  });
  host.postMessage(
    {
      type: "snapshotSection",
      section: "missions",
      snapshot: merged,
      sectionSeq: missionsSectionSeq,
      sectionBasePublishSeq
    },
    { interactionId }
  );
}
