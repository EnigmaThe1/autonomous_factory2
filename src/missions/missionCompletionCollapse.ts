import { Mission } from "../types";
import { hasRequiredUnresolvedWork, queueHasCompletionBlockingFailedOrBlocked } from "./requiredWork";

/**
 * When closure is required, terminal completion needs validation passed, no **completion-blocking**
 * blocked/failed work, and no **required** todo/running items. Obsolescent tail items are demoted to
 * `skipped` in the orchestrator before this runs (see `autoDemoteObsolescentQueueItems`).
 *
 * **Failed history:** required `failed` rows that are **superseded** by a successful same-line retry
 * (`title (retry N)` / `retryCount`, same role + base title) do not block collapse; the failed row
 * stays on the queue for audit. Non-required `failed` rows do not block. Required `blocked` still blocks.
 *
 * Call sites: `MissionOrchestrator` checks this at loop start and again after each `runWorkItem`
 * so the final loop iteration can collapse without needing another header pass (maxSteps boundary).
 */
export function shouldCollapseToComplete(mission: Mission): boolean {
  if (!mission.policy.closureRequired) return false;
  if (mission.validationState !== "passed") return false;
  if (mission.policy.requireValidationEvidence) {
    const lastMut = mission.runtime?.lastImplementerMutationAt;
    if (typeof lastMut === "number") {
      const lastVer = mission.runtime?.lastVerificationAt;
      if (typeof lastVer !== "number" || lastVer < lastMut) return false;
    }
  }
  if (mission.queue.some((w) => w.status === "running")) return false;
  if (queueHasCompletionBlockingFailedOrBlocked(mission)) return false;
  if (hasRequiredUnresolvedWork(mission)) return false;
  return true;
}
