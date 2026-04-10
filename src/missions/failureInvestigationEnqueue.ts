import type { WorkItem } from "../types";
import { uid } from "../util";
import { createRetryWorkItem } from "./workItemAutoRetry";

export interface BuildFailureInvestigationWaveOpts {
  includePlanner: boolean;
  blockerSummary: string;
  /**
   * When true (default), append recovery reviewer + validator after the retry implementer.
   * Set false to preserve minimal waves (diagnosis + retry only).
   */
  enqueueReviewValidateChain?: boolean;
}

function recoveryReviewValidatorItems(
  failedItem: WorkItem,
  chainId: string,
  shortTitle: string,
  dependsOnRetryId: string
): WorkItem[] {
  const reviewId = uid("work");
  const valId = uid("work");
  const spawned = failedItem.id;
  const reviewer: WorkItem = {
    id: reviewId,
    title: `Recovery review: ${shortTitle}`,
    role: "reviewer",
    status: "review_pending",
    prompt: [
      "This is a recovery-chain review after a tool failure and implementer retry.",
      "Read MEMORY from the researcher diagnosis and compare the retry output to the failure context.",
      "Confirm whether risks are addressed or emit concrete follow-up WORK: lines if not."
    ].join("\n"),
    dependsOn: [dependsOnRetryId],
    workItemPurpose: undefined,
    requiredForCompletion: failedItem.requiredForCompletion,
    recoveryChainId: chainId,
    spawnedFromFailureOf: spawned,
    validationScopeHint: "Recovery tranche: focus on whether the tool failure root cause was addressed."
  };
  const validator: WorkItem = {
    id: valId,
    title: `Recovery validation: ${shortTitle}`,
    role: "validator",
    status: "validation_pending",
    prompt: [
      "Validate the recovery chain: diagnosis → retry → review. Decide COMPLETE: only if closure evidence is sound.",
      "If verification tools are needed, use them and record results."
    ].join("\n"),
    dependsOn: [reviewId],
    requiredForCompletion: failedItem.requiredForCompletion,
    recoveryChainId: chainId,
    spawnedFromFailureOf: spawned,
    validationScopeHint: "Recovery tranche validation."
  };
  return [reviewer, validator];
}

/**
 * Builds researcher → optional planner → retry clone → reviewer → validator, chained with `dependsOn`
 * so diagnosis and planning run before the retry executes, then review/validate reopen downstream checks.
 */
export function buildFailureInvestigationWave(failedItem: WorkItem, opts: BuildFailureInvestigationWaveOpts): WorkItem[] {
  const withTail = opts.enqueueReviewValidateChain !== false;
  const blocker = opts.blockerSummary.slice(0, 8000);
  const chainId = uid("recovery");
  const resId = uid("work");
  const objectiveExcerpt = failedItem.prompt.slice(0, 4000);
  const shortTitle = failedItem.title.length > 70 ? `${failedItem.title.slice(0, 67)}…` : failedItem.title;
  const spawned = failedItem.id;

  const researcher: WorkItem = {
    id: resId,
    title: `Investigate failure: ${shortTitle}`,
    role: "researcher",
    status: "todo",
    prompt: [
      "A mission work item failed during tool execution.",
      "",
      `Failed work item: "${failedItem.title}" (role: ${failedItem.role}, id: ${failedItem.id}).`,
      "",
      "Failure / blocker summary:",
      blocker,
      "",
      "Original objective (excerpt):",
      objectiveExcerpt,
      "",
      "Your task: diagnose the likely root cause, what was attempted, and what should change next (environment, commands, paths, sequencing, or approach).",
      "Emit MEMORY: lines with clear, actionable findings so downstream roles can rely on them.",
      "Do not execute mutating tools unless strictly necessary for read-only diagnosis."
    ].join("\n"),
    workItemPurpose: "failure_investigation_diagnose",
    requiredForCompletion: failedItem.requiredForCompletion,
    recoveryChainId: chainId,
    spawnedFromFailureOf: spawned
  };

  if (!opts.includePlanner) {
    const retry = createRetryWorkItem(failedItem);
    retry.dependsOn = [resId];
    retry.workItemPurpose = "failure_recovery_retry";
    retry.requiredForCompletion = failedItem.requiredForCompletion;
    retry.recoveryChainId = chainId;
    retry.spawnedFromFailureOf = spawned;
    retry.status = "retry_ready";
    const tail = withTail ? recoveryReviewValidatorItems(failedItem, chainId, shortTitle, retry.id) : [];
    return [researcher, retry, ...tail];
  }

  const planId = uid("work");
  const planner: WorkItem = {
    id: planId,
    title: `Recovery plan: ${shortTitle}`,
    role: "planner",
    status: "todo",
    dependsOn: [resId],
    prompt: [
      "Read mission MEMORY from the researcher investigation about this tool failure.",
      "Then produce a concise recovery plan: either emit structured WORK: lines for new tasks, or state explicit corrected execution steps for the implementer.",
      "",
      "Failure context:",
      blocker.slice(0, 6000),
      "",
      `Original failed item title: "${failedItem.title}" (${failedItem.role}).`
    ].join("\n"),
    workItemPurpose: "failure_investigation_plan",
    requiredForCompletion: failedItem.requiredForCompletion,
    recoveryChainId: chainId,
    spawnedFromFailureOf: spawned
  };

  const retry = createRetryWorkItem(failedItem);
  retry.dependsOn = [planId];
  retry.workItemPurpose = "failure_recovery_retry";
  retry.requiredForCompletion = failedItem.requiredForCompletion;
  retry.recoveryChainId = chainId;
  retry.spawnedFromFailureOf = spawned;
  retry.status = "retry_ready";
  const tail = withTail ? recoveryReviewValidatorItems(failedItem, chainId, shortTitle, retry.id) : [];
  return [researcher, planner, retry, ...tail];
}
