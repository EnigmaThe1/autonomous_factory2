import { Mission } from "../types";
import { hasRequiredUnresolvedWork } from "./requiredWork";

/**
 * When closure is required, terminal completion needs validation passed, no blocked/failed work, and
 * no **required** todo/running items. Obsolescent tail items are demoted to `skipped` in the
 * orchestrator before this runs (see `autoDemoteObsolescentQueueItems`).
 *
 * Related: `isRequiredWorkSettledForCompletion` (required lane only) is necessary but not sufficient here,
 * because this function also rejects **any** blocked/failed row (including `requiredForCompletion: false`).
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
  if (mission.queue.some((w) => w.status === "blocked" || w.status === "failed")) return false;
  if (hasRequiredUnresolvedWork(mission)) return false;
  return true;
}
