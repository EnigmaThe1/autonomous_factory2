import type { WorkItem, WorkItemStatus } from "../types";

/** All persisted work-item lifecycle states (Phase 3 + legacy). */
export const ALL_WORK_ITEM_STATUSES: readonly WorkItemStatus[] = [
  "todo",
  "in_progress",
  "running",
  "diagnosing",
  "repairing",
  "review_pending",
  "validation_pending",
  "retry_ready",
  "awaiting_approval",
  "blocked",
  "dead_letter",
  "failed",
  "skipped",
  "done"
] as const;

function isKnownWorkItemStatus(s: string): s is WorkItemStatus {
  return (ALL_WORK_ITEM_STATUSES as readonly string[]).includes(s);
}

const RUNNABLE = new Set<WorkItemStatus>([
  "todo",
  "retry_ready",
  "review_pending",
  "validation_pending"
]);

const ACTIVE = new Set<WorkItemStatus>(["in_progress", "running", "diagnosing", "repairing"]);

/** Items the scheduler may pick next (dependencies + gates permitting). */
export function isRunnableWorkItemStatus(status: WorkItemStatus): boolean {
  return RUNNABLE.has(status);
}

/** Item is currently executing agent work. */
export function isActiveWorkItemStatus(status: WorkItemStatus): boolean {
  return ACTIVE.has(status);
}

/** Status set when `runWorkItem` starts, based on recovery role / purpose. */
export function resolveActiveStatusForWorkItem(item: WorkItem): WorkItemStatus {
  if (item.workItemPurpose === "failure_investigation_diagnose") return "diagnosing";
  if (item.workItemPurpose === "failure_recovery_retry") return "repairing";
  return "in_progress";
}

/**
 * Coerce legacy / unknown persisted values. `running` maps to `in_progress`.
 * `deadLetter` flag upgrades failed/blocked rows to `dead_letter` status.
 */
export function normalizeWorkItem(item: WorkItem): WorkItem {
  const raw = String(item.status ?? "");
  let status: WorkItemStatus = isKnownWorkItemStatus(raw) ? (raw as WorkItemStatus) : "todo";
  if (status === "running") {
    status = "in_progress";
  }
  if (item.deadLetter && (status === "failed" || status === "blocked")) {
    status = "dead_letter";
  }
  return { ...item, status };
}

export function normalizeWorkItemQueue(queue: WorkItem[]): WorkItem[] {
  return queue.map(normalizeWorkItem);
}

/**
 * Directed transitions the orchestrator may apply. Intentionally permissive so repair / resume
 * paths are not over-constrained; unknown pairs return false (caller may still apply for edge cases).
 */
const ALLOWED = new Map<WorkItemStatus, Set<WorkItemStatus>>();

function allow(from: WorkItemStatus, to: WorkItemStatus): void {
  if (!ALLOWED.has(from)) ALLOWED.set(from, new Set());
  ALLOWED.get(from)!.add(to);
}

(function buildTransitionTable(): void {
  const terminalish: WorkItemStatus[] = ["done", "skipped", "failed", "blocked", "dead_letter", "awaiting_approval"];
  const active: WorkItemStatus[] = ["in_progress", "diagnosing", "repairing"];
  const queued: WorkItemStatus[] = ["todo", "retry_ready", "review_pending", "validation_pending"];

  for (const q of queued) {
    for (const a of active) allow(q, a);
  }
  for (const a of active) {
    for (const t of terminalish) allow(a, t);
    allow(a, "todo");
    allow(a, "retry_ready");
    allow(a, "review_pending");
    allow(a, "validation_pending");
  }
  for (const q of queued) {
    for (const t of terminalish) allow(q, t);
  }
  for (const t of terminalish) {
    for (const q of queued) allow(t, q);
    for (const a of active) allow(t, a);
  }
  allow("failed", "diagnosing");
  allow("failed", "repairing");
  allow("blocked", "todo");
  allow("blocked", "retry_ready");
  allow("awaiting_approval", "todo");
  allow("awaiting_approval", "blocked");
  allow("dead_letter", "todo");
  allow("dead_letter", "retry_ready");
})();

export function canTransitionWorkItemStatus(from: WorkItemStatus, to: WorkItemStatus): boolean {
  if (from === to) return true;
  return ALLOWED.get(from)?.has(to) ?? false;
}

/** Human-readable label for mission cards / inspector (not for model prompts). */
export function displayLabelForWorkItemStatus(status: WorkItemStatus): string {
  switch (status) {
    case "in_progress":
      return "In progress";
    case "diagnosing":
      return "Diagnosing";
    case "repairing":
      return "Repairing";
    case "review_pending":
      return "Review pending";
    case "validation_pending":
      return "Validation pending";
    case "retry_ready":
      return "Retry ready";
    case "awaiting_approval":
      return "Awaiting approval";
    case "dead_letter":
      return "Dead letter";
    default:
      return status.replace(/_/g, " ");
  }
}
