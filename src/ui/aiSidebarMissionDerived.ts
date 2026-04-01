import type { Mission } from "../types";
import type { SidebarApprovalBundleSummary, SidebarSnapshot, SidebarToolSummary } from "./protocol";
import { approvalBundleSummariesForMissionPending, recentToolEventRowsForMissionTail } from "./aiSidebarMissionDerivedPure";
import { operatorActionEventTimelineHeadline } from "../missions/missionOperatorActionEventPresentation";

export interface MissionDerivedSlices {
  pendingApprovals: SidebarSnapshot["pendingApprovals"];
  approvalBundles: SidebarApprovalBundleSummary[];
  timeline: SidebarSnapshot["timeline"];
  recentToolEvents: NonNullable<SidebarToolSummary["recentToolEvents"]>;
}

/**
 * Pure computation of mission-derived UI slices: pending approvals, bundles,
 * timeline events, and recent tool events. No instance state required.
 */
export function computeMissionDerivedSlicesPure(missions: Mission[]): MissionDerivedSlices {
  const pendingApprovalsUi: SidebarSnapshot["pendingApprovals"] = [];
  const bundleParts: SidebarApprovalBundleSummary[] = [];
  for (const mission of missions) {
    const pending = (mission.approvals || []).filter((approval) => approval.status === "pending");
    for (const approval of pending) {
      pendingApprovalsUi.push({
        missionId: mission.id,
        missionTitle: mission.title,
        approvalId: approval.id,
        title: approval.title,
        kind: approval.kind,
        createdAt: approval.createdAt,
        details: approval.details ?? "",
        targetPath: approval.diffPreview?.targetPath,
        beforeText: approval.diffPreview?.beforeText,
        afterText: approval.diffPreview?.afterText,
        hunkCount: approval.diffPreview?.hunks?.length || 0,
        hunks: (approval.diffPreview?.hunks || []).map((hunk) => ({
          header: hunk.header,
          beforeStart: hunk.beforeStart,
          beforeEnd: hunk.beforeEnd,
          afterStart: hunk.afterStart,
          afterEnd: hunk.afterEnd,
          beforeLines: hunk.beforeLines,
          afterLines: hunk.afterLines
        }))
      });
    }
    bundleParts.push(...approvalBundleSummariesForMissionPending(mission, pending));
  }
  const pendingApprovals = pendingApprovalsUi.sort((a, b) => b.createdAt - a.createdAt);
  const approvalBundles = bundleParts.sort((a, b) => b.createdAt - a.createdAt);
  const timeline = missions
    .flatMap((mission) =>
      (mission.events || []).slice(-12).map((event) => {
        const base = {
          missionId: mission.id,
          missionTitle: mission.title,
          id: event.id,
          ts: event.ts,
          level: event.level,
          source: event.source,
          message: event.message
        };
        const headline =
          event.source === "operator-action" ? operatorActionEventTimelineHeadline(event.message) : undefined;
        return headline ? { ...base, operatorActionHeadline: headline } : base;
      })
    )
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 60);
  const recentToolEvents = missions
    .flatMap((mission) => recentToolEventRowsForMissionTail(mission))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 12) as NonNullable<SidebarToolSummary["recentToolEvents"]>;
  return { pendingApprovals, approvalBundles, timeline, recentToolEvents };
}
