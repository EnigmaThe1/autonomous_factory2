import * as vscode from "vscode";
import { MissionStore } from "../missions/MissionStore";
import { ApprovalBundle, ApprovalRequest, Mission, WorkItem } from "../types";

export async function chooseMission(store: MissionStore, placeHolder: string, filter?: (status: string) => boolean) {
  const missions = store.listVisible(false).filter((m) => !filter || filter(m.status));
  return vscode.window.showQuickPick(
    missions.map((m) => ({ label: m.title, detail: `${m.status} • ${new Date(m.updatedAt).toLocaleString()}`, missionId: m.id })),
    { placeHolder }
  );
}

export function buildApprovalBundles(store: MissionStore): ApprovalBundle[] {
  return store.list().flatMap((mission) => {
    const pending = mission.approvals.filter((a) => a.status === "pending");
    if (!pending.length) return [];
    const byKind = new Map<string, typeof pending>();
    for (const approval of pending) {
      const key = `${approval.kind}::${approval.diffPreview?.targetPath || approval.toolCall.tool}`;
      const list = byKind.get(key) || [];
      list.push(approval);
      byKind.set(key, list);
    }
    return [...byKind.entries()].map(([key, approvals]) => ({
      id: `${mission.id}::${key}`,
      missionId: mission.id,
      title: approvals.length > 1 ? `${approvals[0].title} (+${approvals.length - 1} more)` : approvals[0].title,
      status: (approvals.every((a) => a.status === "pending") ? "pending" : "mixed") as ApprovalBundle["status"],
      approvalIds: approvals.map((a) => a.id),
      kinds: [...new Set(approvals.map((a) => a.kind))],
      createdAt: Math.min(...approvals.map((a) => a.createdAt)),
      targetPaths: approvals.map((a) => a.diffPreview?.targetPath).filter(Boolean) as string[]
    }));
  }).sort((a, b) => b.createdAt - a.createdAt);
}

export async function chooseApprovalBundle(store: MissionStore, placeHolder: string) {
  const bundles = buildApprovalBundles(store);
  return vscode.window.showQuickPick(
    bundles.map((b) => ({ label: b.title, detail: `${store.get(b.missionId)?.title || b.missionId} • ${b.approvalIds.length} item(s) • ${b.kinds.join(', ')}`, bundleId: b.id })),
    { placeHolder }
  );
}

export function pickPendingApprovals(store: MissionStore, filter?: (a: ApprovalRequest) => boolean) {
  return store.list().flatMap((m) =>
    m.approvals
      .filter((a) => a.status === "pending" && (!filter || filter(a)))
      .map((a) => ({ mission: m, approval: a }))
  );
}

export function workItemQuickLabel(work: WorkItem): string {
  return `${work.title} [${work.role} • ${work.status}]`;
}

export async function pickWorkItem(mission: Mission, placeHolder: string, filter?: (w: WorkItem) => boolean) {
  const items = mission.queue.filter((w) => !filter || filter(w));
  return vscode.window.showQuickPick(items.map((w) => ({ label: workItemQuickLabel(w), detail: w.prompt.slice(0, 140), workId: w.id })), { placeHolder });
}
