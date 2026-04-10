import type { WorkItem } from "../types";
import { uid } from "../util";
import { createRetryWorkItem } from "./workItemAutoRetry";

export interface BuildFailureInvestigationWaveOpts {
  includePlanner: boolean;
  blockerSummary: string;
}

/**
 * Builds researcher → optional planner → retry clone of the failed item, chained with `dependsOn`
 * so diagnosis and planning run before the retry executes.
 */
export function buildFailureInvestigationWave(failedItem: WorkItem, opts: BuildFailureInvestigationWaveOpts): WorkItem[] {
  const blocker = opts.blockerSummary.slice(0, 8000);
  const resId = uid("work");
  const objectiveExcerpt = failedItem.prompt.slice(0, 4000);
  const shortTitle = failedItem.title.length > 70 ? `${failedItem.title.slice(0, 67)}…` : failedItem.title;

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
    requiredForCompletion: failedItem.requiredForCompletion
  };

  if (!opts.includePlanner) {
    const retry = createRetryWorkItem(failedItem);
    retry.dependsOn = [resId];
    retry.workItemPurpose = "failure_recovery_retry";
    retry.requiredForCompletion = failedItem.requiredForCompletion;
    return [researcher, retry];
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
    requiredForCompletion: failedItem.requiredForCompletion
  };

  const retry = createRetryWorkItem(failedItem);
  retry.dependsOn = [planId];
  retry.workItemPurpose = "failure_recovery_retry";
  retry.requiredForCompletion = failedItem.requiredForCompletion;
  return [researcher, planner, retry];
}
