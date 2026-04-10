import { WorkItem } from "../types";
import { isReadonlyMissionToolId } from "./readonlyMissionToolIds";
import { isRunCommandLikelyReadOnlyProbe } from "./runCommandReadOnlyProbe";
import { isActiveWorkItemStatus } from "./workItemLifecycle";

export interface QueueRecoveryResult {
  queue: WorkItem[];
  recoveredCount: number;
  replayRiskCount: number;
}

/**
 * After host interruption/restart, in-flight items can be left as "running"
 * with no live worker. Convert them back to "todo" so resume can continue.
 */
export function recoverInterruptedQueueItems(queue: WorkItem[]): QueueRecoveryResult {
  let recoveredCount = 0;
  let replayRiskCount = 0;
  const recoveredQueue = queue.map((item) => {
    if (!isActiveWorkItemStatus(item.status) && item.status !== "running") return item;
    if (item.activeMutatingToolCall) {
      const t = item.activeMutatingToolCall.tool;
      if (isReadonlyMissionToolId(t)) {
        recoveredCount += 1;
        return {
          ...item,
          status: "todo" as const,
          activeMutatingToolCall: undefined,
          output:
            (item.output || "Recovered after host interruption.").trim() +
            "\n\nRe-queued: in-flight tool was read-only (no replay-risk guard)."
        };
      }
      const preview = item.activeMutatingToolCall.commandPreview;
      if (t === "runCommand" && preview && isRunCommandLikelyReadOnlyProbe(preview)) {
        recoveredCount += 1;
        return {
          ...item,
          status: "todo" as const,
          activeMutatingToolCall: undefined,
          output:
            (item.output || "Recovered after host interruption.").trim() +
            "\n\nRe-queued: in-flight runCommand matched read-only probe heuristics (no replay-risk guard)."
        };
      }
      replayRiskCount += 1;
      return {
        ...item,
        status: "blocked" as const,
        hardStopClass: item.role === "implementer" ? ("unknown_hard_stop" as const) : item.hardStopClass,
        output: [
          item.output || "Interrupted during mutating tool execution.",
          `Recovery blocked automatic replay because ${item.activeMutatingToolCall.tool} may have already changed state.`,
          "Manual review is required before retrying this work item."
        ].join("\n\n")
      };
    }
    recoveredCount += 1;
    // Safe recovery: clear any stale mutating marker so a re-queued item is never treated as mid-mutation.
    return {
      ...item,
      status: "todo" as const,
      activeMutatingToolCall: undefined,
      output: item.output || "Recovered after host interruption. Re-queued for resume."
    };
  });
  return { queue: recoveredQueue, recoveredCount, replayRiskCount };
}

/**
 * Work items left `blocked` after an operator-driven LLM stream abort are not runnable on the next
 * `runMission` pass (only `todo` is picked). Re-queue them as `todo` on resume so ordering and
 * closure gates stay honest. Does not touch approval-blocked or policy-blocked items.
 */
export function requeueOperatorStreamAbortedWorkItems(queue: WorkItem[]): WorkItem[] {
  return queue.map((item) => {
    if (item.status === "blocked" && item.hardStopClass === "operator_abort") {
      return {
        ...item,
        status: "todo" as const,
        hardStopClass: undefined,
        output: `${item.output || "Operator abort."}\n\nRe-queued after resume following operator abort.`.trim()
      };
    }
    return item;
  });
}

export function countOperatorStreamAbortRequeues(before: WorkItem[], after: WorkItem[]): number {
  const byId = new Map(after.map((w) => [w.id, w]));
  let n = 0;
  for (const prev of before) {
    const next = byId.get(prev.id);
    if (!next) continue;
    if (prev.status === "blocked" && next.status === "todo" && prev.hardStopClass === "operator_abort") {
      n += 1;
    }
  }
  return n;
}
