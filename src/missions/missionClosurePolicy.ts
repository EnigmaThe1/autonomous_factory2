import * as vscode from "vscode";
import type { AgentRole, Mission, WorkItem } from "../types";
import { uid } from "../util";
import { shouldCollapseToComplete } from "./missionCompletionCollapse";
import type { MissionStore } from "./MissionStore";

export interface ClosurePolicyEnqueueAction {
  items: WorkItem[];
  event?: { level: "info" | "warn"; source: string; message: string };
}

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
  const _hasValidationEvidence = current.events.some((e) => e.source.includes("validator") || e.message.toLowerCase().includes("validation"))
    || current.memory.some((m) => m.kind === "checkpoint" && /validat/i.test(m.text));
  const hasPlannerDone = current.queue.some((w) => w.role === "planner" && w.status === "done");
  const coverageMissing = vscode.workspace.getConfiguration().get<boolean>("myAi.missions.requirePlannerCoverage", true)
    && computePlannerCoverageItems(current).length > 0;

  if (!hasPlannerDone) {
    const hasPlannerTodo = current.queue.some((w) => w.role === "planner" && ["todo", "running"].includes(w.status));
    if (!hasPlannerTodo) {
      await store.enqueue(current.id, [{
        id: uid("work"),
        title: "Required planning before completion",
        role: "planner",
        status: "todo",
        prompt: "Create or refresh the execution plan so the mission has explicit bounded work packages before closure."
      }]);
      await store.noteProgress(current.id);
    }
    return true;
  }

  if (coverageMissing) {
    await store.enqueue(current.id, computePlannerCoverageItems(current));
    await store.saveEvent(current.id, { level: "warn", source: "planner-contract", message: "Mission attempted closure without full planner role coverage; missing roles were injected." });
    await store.noteProgress(current.id);
    return true;
  }

  if (completedItems < current.policy.minCompletedWorkItems) {
    const hasPlannerTodo = current.queue.some((w) => w.role === "planner" && ["todo", "running"].includes(w.status));
    if (!hasPlannerTodo) {
      await store.enqueue(current.id, [{
        id: uid("work"),
        title: "Closure-gap replan",
        role: "planner",
        status: "todo",
        prompt: `The mission tried to close too early. Create the missing work needed to reach at least ${current.policy.minCompletedWorkItems} completed work items and a production-ready state.`
      }]);
      await store.noteProgress(current.id);
    }
    return true;
  }

  if (needsImplementer) {
    const hasPendingImplementer = current.queue.some((w) => w.role === "implementer" && ["todo", "running"].includes(w.status));
    if (!hasPendingImplementer) {
      await store.enqueue(current.id, [{
        id: uid("work"),
        title: "Required implementation before completion",
        role: "implementer",
        status: "todo",
        prompt: "Complete at least one bounded implementation step required for mission closure, then leave review/validation follow-ups if needed."
      }]);
      await store.noteProgress(current.id);
    }
    return true;
  }

  if (needsReviewer) {
    const hasPendingReviewer = current.queue.some((w) => w.role === "reviewer" && ["todo", "running"].includes(w.status));
    if (!hasPendingReviewer) {
      await store.enqueue(current.id, [
        {
          id: uid("work"),
          title: "Required review before completion",
          role: "reviewer",
          status: "todo",
          prompt: "Perform the mandatory review before mission completion and raise any remaining follow-up work."
        }
      ]);
      await store.noteProgress(current.id);
    }
    return true;
  }

  if (needsValidator) {
    const hasPendingValidator = current.queue.some((w) => w.role === "validator" && ["todo", "running"].includes(w.status));
    if (!hasPendingValidator) {
      await store.enqueue(current.id, [
        {
          id: uid("work"),
          title: "Required validation before completion",
          role: "validator",
          status: "todo",
          prompt: "Validate whether the mission is truly complete. Emit COMPLETE: only if done, or WORK lines for more follow-ups."
        }
      ]);
      await store.noteProgress(current.id);
    }
    return true;
  }

  return false;
}
