import { Mission, WorkItem } from "../types";
import { shouldSkipRedundantValidatorWork } from "./redundantValidatorSkip";

/** Default for legacy missions: unset means required. */
export function isRequiredForCompletion(item: WorkItem): boolean {
  return item.requiredForCompletion !== false;
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
  return mission.queue.some(
    (w) => isRequiredForCompletion(w) && (w.status === "blocked" || w.status === "failed")
  );
}

/**
 * Every required queue item is `done` or `skipped` — no todo, running, blocked, or failed on the
 * **required** lane. Still does **not** imply mission `completed`: you still need `validationState`,
 * `closureRequired` / policy gates, and (for collapse) no **non-required** blocked/failed rows —
 * see `shouldCollapseToComplete` in `missionCompletionCollapse.ts`.
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
