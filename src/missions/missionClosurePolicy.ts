import * as vscode from "vscode";
import type { AgentRole, Mission, WorkItem } from "../types";
import { uid } from "../util";
import { shouldCollapseToComplete } from "./missionCompletionCollapse";
import type { MissionStore } from "./MissionStore";
import { isActiveWorkItemStatus, isRunnableWorkItemStatus } from "./workItemLifecycle";

/**
 * Computes the set of work items missing for planner role coverage.
 * Returns an empty array when all required roles are already represented.
 */
export function computePlannerCoverageItems(mission: Mission): WorkItem[] {
  const required: Array<{ role: AgentRole; title: string; prompt: string }> = [
    { role: "implementer", title: "Implementation tranche", prompt: "Implement the highest-value bounded change justified by current findings and prior plan." },
    { role: "reviewer", title: "Review tranche", prompt: "Review the latest implementation, identify concrete defects, and emit fix tasks where needed." },
    { role: "validator", title: "Validation tranche", prompt: "Validate the current mission state, require evidence, and emit follow-up work until closure requirements are truly satisfied." }
  ];
  const existingRoles = new Set(mission.queue.filter((w) => w.status !== "failed").map((w) => w.role));
  return required
    .filter((r) => !existingRoles.has(r.role))
    .map((r) => ({ id: uid("work"), title: r.title, role: r.role, status: "todo" as const, prompt: r.prompt }));
}

/**
 * Evaluates the mission closure policy and returns whether work was injected.
 * The orchestrator should call this when the queue is empty to decide whether
 * to inject more work or allow terminal status.
 */
export async function enforceClosurePolicy(
  mission: Mission,
  store: MissionStore
): Promise<boolean> {
  if (!mission.policy.closureRequired) return false;
  const current = store.get(mission.id)!;
  if (shouldCollapseToComplete(current)) return false;

  const completedItems = current.queue.filter((w) => w.status === "done" || w.status === "skipped").length;
  const hasImplementerDone = current.queue.some((w) => w.role === "implementer" && w.status === "done");
  const needsImplementer = current.policy.requireImplementerBeforeComplete && !hasImplementerDone;
  const needsReviewer = current.policy.requireReviewerBeforeComplete && !current.queue.some((w) => w.role === "reviewer" && w.status === "done");
  const needsValidator = current.policy.requireValidatorBeforeComplete && current.validationState !== "passed";
  const needsVerificationEvidence = Boolean(current.policy.requireValidationEvidence)
    && typeof current.runtime?.lastImplementerMutationAt === "number"
    && (typeof current.runtime?.lastVerificationAt !== "number" || (current.runtime.lastVerificationAt < current.runtime.lastImplementerMutationAt));
  const hasPlannerDone = current.queue.some((w) => w.role === "planner" && w.status === "done");
  const coverageMissing = vscode.workspace.getConfiguration().get<boolean>("myAi.missions.requirePlannerCoverage", true)
    && computePlannerCoverageItems(current).length > 0;

  const enqueueIfMissing = async (role: AgentRole, title: string, prompt: string): Promise<boolean> => {
    const hasPending = current.queue.some(
      (w) => w.role === role && (isRunnableWorkItemStatus(w.status) || isActiveWorkItemStatus(w.status))
    );
    if (!hasPending) {
      await store.enqueue(current.id, [{ id: uid("work"), title, role, status: "todo" as const, prompt }]);
      await store.noteProgress(current.id);
    }
    return true;
  };

  if (!hasPlannerDone) {
    return enqueueIfMissing("planner", "Required planning before completion",
      "Create or refresh the execution plan so the mission has explicit bounded work packages before closure.");
  }

  if (coverageMissing) {
    await store.enqueue(current.id, computePlannerCoverageItems(current));
    await store.saveEvent(current.id, { level: "warn", source: "planner-contract", message: "Mission attempted closure without full planner role coverage; missing roles were injected." });
    await store.noteProgress(current.id);
    return true;
  }

  if (completedItems < current.policy.minCompletedWorkItems) {
    return enqueueIfMissing("planner", "Closure-gap replan",
      `The mission tried to close too early. Create the missing work needed to reach at least ${current.policy.minCompletedWorkItems} completed work items and a production-ready state.`);
  }

  if (needsImplementer) {
    return enqueueIfMissing("implementer", "Required implementation before completion",
      "Complete at least one bounded implementation step required for mission closure, then leave review/validation follow-ups if needed.");
  }

  if (needsReviewer) {
    return enqueueIfMissing("reviewer", "Required review before completion",
      "Perform the mandatory review before mission completion and raise any remaining follow-up work.");
  }

  if (needsValidator) {
    return enqueueIfMissing("validator", "Required validation before completion",
      "Validate whether the mission is truly complete. Emit COMPLETE: only if done, or WORK lines for more follow-ups.");
  }

  if (needsVerificationEvidence) {
    return enqueueIfMissing(
      "implementer",
      "Verification obligations (lint/tests)",
      "Run deterministic verification: emit TOOL calls for runLinter and runTests. Summarize results and any failures. Do not make unrelated changes."
    );
  }

  return false;
}
