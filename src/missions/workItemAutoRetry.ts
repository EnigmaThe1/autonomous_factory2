import type { WorkItem } from "../types";
import { uid } from "../util";

/**
 * Hard-stop classes that should never be auto-retried (require human intervention).
 */
const NON_RETRYABLE_HARD_STOPS = new Set<WorkItem["hardStopClass"]>([
  "approval_pending",
  "approval_rejected",
  "policy_blocked",
  "operator_abort",
]);

export interface AutoRetryDecision {
  shouldRetry: boolean;
  reason: string;
}

/**
 * Determines whether a failed work item should be auto-retried.
 */
export function shouldAutoRetry(
  item: WorkItem,
  maxRetries: number
): AutoRetryDecision {
  if (item.status !== "failed") {
    return { shouldRetry: false, reason: "Item is not failed" };
  }

  if (item.hardStopClass && NON_RETRYABLE_HARD_STOPS.has(item.hardStopClass)) {
    return { shouldRetry: false, reason: `Hard-stop class ${item.hardStopClass} requires human intervention` };
  }

  const retryCount = item.retryCount || 0;
  if (retryCount >= maxRetries) {
    return { shouldRetry: false, reason: `Max retries reached (${retryCount}/${maxRetries})` };
  }

  if (item.activeMutatingToolCall) {
    return { shouldRetry: false, reason: "Item has an active mutating tool call — manual review required" };
  }

  return { shouldRetry: true, reason: `Retry ${retryCount + 1}/${maxRetries}` };
}

/**
 * When auto-retry will not run, decide whether the failure is due to exhausted retry budget (dead letter)
 * rather than a non-retryable hard-stop or manual-review state.
 */
export function shouldMarkWorkItemDeadLetter(item: WorkItem, decision: AutoRetryDecision): boolean {
  if (decision.shouldRetry) return false;
  if (item.status !== "failed") return false;
  if (item.deadLetter) return false;
  if (item.hardStopClass && NON_RETRYABLE_HARD_STOPS.has(item.hardStopClass)) return false;
  if (item.activeMutatingToolCall) return false;
  return decision.reason.startsWith("Max retries reached");
}

/**
 * Creates a retry clone of a failed work item with error context injected into the prompt.
 */
export function createRetryWorkItem(failedItem: WorkItem): WorkItem {
  const retryCount = (failedItem.retryCount || 0) + 1;
  const errorContext = failedItem.output
    ? `\n\n[RETRY ${retryCount}] Previous attempt failed with:\n${failedItem.output.slice(0, 2000)}\n\nPlease analyze the error above and try a different approach. Do not repeat the same actions that caused the failure.`
    : `\n\n[RETRY ${retryCount}] Previous attempt failed. Try a different approach.`;

  return {
    id: uid("retry"),
    title: `${failedItem.title} (retry ${retryCount})`,
    role: failedItem.role,
    status: "todo",
    prompt: failedItem.prompt + errorContext,
    retryCount,
    previousError: failedItem.output?.slice(0, 2000),
    dependsOn: failedItem.dependsOn,
    providerId: failedItem.providerId,
    model: failedItem.model,
    requiredForCompletion: failedItem.requiredForCompletion,
    parentWorkItemId: failedItem.parentWorkItemId,
  };
}
