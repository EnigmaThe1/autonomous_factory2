import type { ApprovalRequest, WorkItem } from "../types";

/**
 * Work items can retain `hardStopClass: "approval_pending"` while `mission.approvals` has no matching
 * pending row (cleared UI, persistence edge cases). Resume uses this to clear the stale gate so the
 * step can run again.
 */
export function reconcileStaleApprovalPendingHardStops(
  queue: WorkItem[],
  approvals: ApprovalRequest[]
): { queue: WorkItem[]; changedIds: string[] } {
  const pendingForWorkItem = new Set(
    approvals.filter((a) => a.status === "pending" && a.workItemId).map((a) => a.workItemId as string)
  );
  const changedIds: string[] = [];
  const queueNext = queue.map((w) => {
    if (w.hardStopClass !== "approval_pending") return w;
    if (pendingForWorkItem.has(w.id)) return w;
    changedIds.push(w.id);
    const note =
      "\n\n[Orchestrator] Cleared stale approval_pending gate (no matching pending approval row). Work item was reset to retry.";
    const next: WorkItem = {
      ...w,
      hardStopClass: undefined,
      activeMutatingToolCall: undefined,
      output: `${w.output || ""}${note}`.trim()
    };
    if (w.status === "blocked") {
      next.status = "todo";
    }
    return next;
  });
  return { queue: queueNext, changedIds };
}
