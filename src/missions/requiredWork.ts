import { Mission, WorkItem } from "../types";
import { shouldSkipRedundantValidatorWork } from "./redundantValidatorSkip";

/** Default for legacy missions: unset means required. */
export function isRequiredForCompletion(item: WorkItem): boolean {
  return item.requiredForCompletion !== false;
}

/**
 * Normalizes titles like `Phase (retry 2)` → `Phase` for matching auto-retry follow-ups from
 * `createRetryWorkItem` (`${title} (retry N)`).
 */
export function baseWorkItemTitleForRetryMatching(title: string): string {
  let t = title.trim();
  for (;;) {
    const next = t.replace(/\s*\(retry\s+\d+\)\s*$/i, "").trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

/**
 * True when a **failed** row is followed by a **done** retry for the same role and logical title
 * (same base after stripping `(retry N)` suffixes). Keeps the failed row in the queue for history
 * while allowing completion to proceed.
 */
export function isFailedWorkItemSupersededBySuccessfulRetry(mission: Mission, item: WorkItem): boolean {
  if (item.status !== "failed") return false;
  const base = baseWorkItemTitleForRetryMatching(item.title);
  return mission.queue.some((w) => {
    if (w.id === item.id) return false;
    if (w.role !== item.role) return false;
    if (w.status !== "done") return false;
    if (baseWorkItemTitleForRetryMatching(w.title) !== base) return false;
    const doneLooksLikeRetry =
      /\s*\(retry\s+\d+\)\s*$/i.test(w.title) || (typeof w.retryCount === "number" && w.retryCount > 0);
    return doneLooksLikeRetry;
  });
}

/**
 * True if any queue row should prevent mission **completed** / collapse: required **blocked**, or
 * required **failed** that is not superseded by a successful same-line retry (`isFailedWorkItemSupersededBySuccessfulRetry`).
 * Non-required failed rows do not block (history only).
 */
export function queueHasCompletionBlockingFailedOrBlocked(mission: Mission): boolean {
  return mission.queue.some((w) => {
    if (!isRequiredForCompletion(w)) return false;
    if (w.status === "blocked") return true;
    if (w.status === "failed") return !isFailedWorkItemSupersededBySuccessfulRetry(mission, w);
    return false;
  });
}

/** Dependency edges treat skipped like done (work will not run). */
export function dependencyEdgeSatisfied(status: WorkItem["status"] | undefined): boolean {
  return status === "done" || status === "skipped";
}

export function hasRequiredUnresolvedWork(mission: Mission): boolean {
  // `done` covers normal completion, `completionKind: "already_satisfied"`, and `apply_patch_noop`.
  return mission.queue.some((w) => (w.status === "todo" || w.status === "running") && isRequiredForCompletion(w));
}

/**
 * Required work item is in a failure or human-gate state (approval reject, tool failure, policy block,
 * operator abort on stream, etc.). Differs from `hasRequiredUnresolvedWork`, which only sees
 * `todo` / `running`. Callers must not infer “nothing left to fix” from
 * `!hasRequiredUnresolvedWork` alone.
 */
export function hasRequiredBlockingOrFailedWork(mission: Mission): boolean {
  return queueHasCompletionBlockingFailedOrBlocked(mission);
}

/**
 * Every required queue item is `done` or `skipped`, or `failed` only when superseded by a successful
 * retry. Still does **not** imply mission `completed`: you still need `validationState`,
 * `closureRequired` / policy gates, and `shouldCollapseToComplete` (no completion-blocking blocked rows).
 */
export function isRequiredWorkSettledForCompletion(mission: Mission): boolean {
  return !hasRequiredUnresolvedWork(mission) && !hasRequiredBlockingOrFailedWork(mission);
}

/**
 * Extra reviewer todo after validation passed and some reviewer work already completed — tail from
 * "Review latest" / planner overlap, not a fresh required gate.
 */
export function shouldAutoSkipObsolescentReviewerWork(mission: Mission, item: WorkItem): boolean {
  if (item.role !== "reviewer") return false;
  if (mission.validationState !== "passed") return false;
  if (!isRequiredForCompletion(item)) return false;
  return mission.queue.some((w) => w.role === "reviewer" && w.id !== item.id && w.status === "done");
}

/**
 * Earlier validator attempt left `blocked`/`failed` while a later validator completed `done` and
 * `validationState === "passed"`. That terminal row is obsolete for collapse/closure (mirrors redundant
 * validator demotion for todos in `shouldSkipRedundantValidatorWork`).
 */
function supersededTerminalSkipReason(mission: Mission, item: WorkItem, role: "validator" | "reviewer"): string | null {
  if (item.role !== role) return null;
  if (item.status !== "blocked" && item.status !== "failed") return null;
  if (mission.validationState !== "passed") return null;
  if (!mission.queue.some((w) => w.role === role && w.status === "done")) return null;
  return `Skipped: superseded ${role} attempt after validation passed (later ${role === "validator" ? "validator" : "review"} completed).`;
}

export function supersededValidatorTerminalSkipReason(mission: Mission, item: WorkItem): string | null {
  return supersededTerminalSkipReason(mission, item, "validator");
}

export function supersededReviewerTerminalSkipReason(mission: Mission, item: WorkItem): string | null {
  return supersededTerminalSkipReason(mission, item, "reviewer");
}

export function obsolescentTodoSkipReason(mission: Mission, item: WorkItem): string | null {
  if (shouldSkipRedundantValidatorWork(mission, item)) {
    return "Skipped: redundant validator after validation already passed.";
  }
  if (shouldAutoSkipObsolescentReviewerWork(mission, item)) {
    return "Skipped: superseded reviewer todo after validation passed (prior review completed).";
  }
  return null;
}

/**
 * Pure queue transform mirroring `MissionOrchestrator.autoDemoteObsolescentQueueItems`: every `todo`
 * with a non-null `obsolescentTodoSkipReason` becomes `skipped` with that output until stable.
 * Used for regression tests; keep in sync with the orchestrator demotion loop.
 */
export function applyObsolescentTodoDemotions(mission: Mission, queue: WorkItem[]): WorkItem[] {
  let q = queue;
  for (;;) {
    const m: Mission = { ...mission, queue: q };
    const todo = q.find((w) => w.status === "todo" && obsolescentTodoSkipReason(m, w));
    if (!todo) return q;
    const reason = obsolescentTodoSkipReason(m, todo)!;
    q = q.map((w) => (w.id === todo.id ? { ...w, status: "skipped" as const, output: reason } : w));
  }
}

/** Pure queue transform mirroring `MissionOrchestrator.autoDemoteSupersededValidatorTerminalItems`. */
export function applySupersededValidatorTerminalDemotions(mission: Mission, queue: WorkItem[]): WorkItem[] {
  let q = queue;
  for (;;) {
    const m: Mission = { ...mission, queue: q };
    const row = q.find((w) => supersededValidatorTerminalSkipReason(m, w));
    if (!row) return q;
    const reason = supersededValidatorTerminalSkipReason(m, row)!;
    q = q.map((w) => (w.id === row.id ? { ...w, status: "skipped" as const, output: reason } : w));
  }
}

/** Pure queue transform mirroring orchestrator demotion of stale reviewer/validator terminal rows. */
export function applySupersededTerminalDemotions(mission: Mission, queue: WorkItem[]): WorkItem[] {
  let q = queue;
  for (;;) {
    const m: Mission = { ...mission, queue: q };
    const row = q.find(
      (w) => supersededValidatorTerminalSkipReason(m, w) || supersededReviewerTerminalSkipReason(m, w)
    );
    if (!row) return q;
    const reason =
      supersededValidatorTerminalSkipReason(m, row) || supersededReviewerTerminalSkipReason(m, row)!;
    q = q.map((w) => (w.id === row.id ? { ...w, status: "skipped" as const, output: reason } : w));
  }
}
