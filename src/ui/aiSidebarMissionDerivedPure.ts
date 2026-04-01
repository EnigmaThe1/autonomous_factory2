import type { ApprovalRequest, Mission, MissionEvent } from "../types";
import type { SidebarApprovalBundleSummary, SidebarSnapshot } from "./protocol";

/**
 * Bundle summaries for one mission from an already-filtered pending list (same grouping as legacy
 * `buildApprovalBundles` per mission). Caller sorts globally by `createdAt`.
 */
export function approvalBundleSummariesForMissionPending(
  mission: Mission,
  pending: ApprovalRequest[]
): SidebarApprovalBundleSummary[] {
  const groups = new Map<string, ApprovalRequest[]>();
  for (const approval of pending) {
    const target = approval.diffPreview?.targetPath || approval.kind;
    const key = `${approval.kind}::${target}`;
    const arr = groups.get(key) || [];
    arr.push(approval);
    groups.set(key, arr);
  }
  return Array.from(groups.entries()).map(([key, approvals], idx) => {
    const targets = Array.from(new Set(approvals.map((a) => a.diffPreview?.targetPath).filter(Boolean) as string[]));
    const kinds = Array.from(new Set(approvals.map((a) => a.kind)));
    const createdAt = Math.min(...approvals.map((a) => a.createdAt));
    const title =
      approvals.length > 1
        ? `${approvals[0].kind} bundle • ${targets[0] || mission.title}`
        : approvals[0].title;
    return {
      id: `${mission.id}::bundle::${idx}::${key}`,
      missionId: mission.id,
      missionTitle: mission.title,
      title,
      status: approvals.every((a) => a.status === "pending") ? "pending" : "mixed",
      approvalCount: approvals.length,
      kinds,
      targetPaths: targets,
      createdAt,
      approvalIds: approvals.map((a) => a.id)
    };
  });
}

/**
 * Last six `tool:` events for a mission in chronological order (same as `filter(...).slice(-6)` on append-only logs).
 * Single backward scan avoids allocating the intermediate filtered array.
 */
export function recentToolEventRowsForMissionTail(mission: Mission): {
  missionId: string;
  missionTitle: string;
  ts: number;
  source: string;
  message: string;
  level: string;
}[] {
  const ev = mission.events || [];
  const picked: MissionEvent[] = [];
  for (let i = ev.length - 1; i >= 0 && picked.length < 6; i--) {
    if (ev[i].source.startsWith("tool:")) picked.push(ev[i]);
  }
  picked.reverse();
  return picked.map((event) => ({
    missionId: mission.id,
    missionTitle: mission.title,
    ts: event.ts,
    source: event.source,
    message: event.message,
    level: event.level
  }));
}

export type MissionDerivedCacheRow = {
  fp: string;
  pendingApprovals: SidebarSnapshot["pendingApprovals"];
  approvalBundles: SidebarApprovalBundleSummary[];
  timeline: SidebarSnapshot["timeline"];
  recentToolEvents: NonNullable<SidebarSnapshot["tools"]["recentToolEvents"]>;
};
