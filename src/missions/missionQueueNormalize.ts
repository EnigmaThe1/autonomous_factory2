import type { ApprovalRequest, WorkItem } from "../types";
import { isRunnableWorkItemStatus } from "./workItemLifecycle";

function queueStructurallyChanged(before: WorkItem[], after: WorkItem[]): boolean {
  if (before.length !== after.length) return true;
  const prev = new Map(before.map((w) => [w.id, w]));
  for (const w of after) {
    const o = prev.get(w.id);
    if (!o) return true;
    if (o.status !== w.status || o.hardStopClass !== w.hardStopClass) return true;
  }
  return false;
}

/**
 * Collapse duplicate runnable retry branches (same parent) before the runner declares blocked/stuck or
 * picks the next item (Phase 5).
 *
 * **Stale `approval_pending` hard-stops** are intentionally **not** cleared here: `resumeMission` and
 * `handleEmptyQueue` use `approval_gate_stale` / operator-visible paths first; eager reconcile would
 * skip that signal (see missionOrchestratorDownstreamGating tests).
 */
export function normalizeMissionQueueForRunner(
  queue: WorkItem[],
  _approvals: ApprovalRequest[]
): { queue: WorkItem[]; staleApprovalIds: string[]; mutated: boolean } {
  const collapsed = collapseDuplicateRetryBranches(queue);
  const mutated = queueStructurallyChanged(queue, collapsed);
  return { queue: collapsed, staleApprovalIds: [], mutated };
}

/**
 * When multiple runnable implementer retries share the same `parentWorkItemId`, keep the highest
 * `retryCount` and skip the others to avoid parallel duplicate repair branches.
 */
export function collapseDuplicateRetryBranches(queue: WorkItem[]): WorkItem[] {
  const parentKey = (w: WorkItem): string =>
    w.parentWorkItemId && w.role === "implementer" ? `${w.role}:${w.parentWorkItemId}` : "";
  const keepIdByKey = new Map<string, string>();
  for (const w of queue) {
    const k = parentKey(w);
    if (!k || !isRunnableWorkItemStatus(w.status)) continue;
    const prevId = keepIdByKey.get(k);
    if (!prevId) {
      keepIdByKey.set(k, w.id);
      continue;
    }
    const prev = queue.find((x) => x.id === prevId);
    if (!prev) {
      keepIdByKey.set(k, w.id);
      continue;
    }
    if ((w.retryCount || 0) > (prev.retryCount || 0)) keepIdByKey.set(k, w.id);
  }
  return queue.map((w) => {
    const k = parentKey(w);
    if (!k || !isRunnableWorkItemStatus(w.status)) return w;
    const keep = keepIdByKey.get(k);
    if (keep && keep !== w.id) {
      return {
        ...w,
        status: "skipped" as const,
        output: `${w.output || ""}\n[orchestrator] Superseded duplicate retry branch (same parent work item).`.trim()
      };
    }
    return w;
  });
}
