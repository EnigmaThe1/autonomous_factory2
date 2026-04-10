import type { Mission, WorkItem } from "../types";
import type { BlueprintStepStatus, MissionBlueprint } from "./missionBlueprintTypes";

function mapWorkStatusToBlueprint(status: WorkItem["status"]): BlueprintStepStatus | undefined {
  switch (status) {
    case "done":
    case "skipped":
      return status === "skipped" ? "skipped" : "done";
    case "failed":
    case "blocked":
    case "dead_letter":
      return "blocked";
    case "running":
    case "in_progress":
    case "diagnosing":
    case "repairing":
      return "in_progress";
    case "todo":
    case "retry_ready":
    case "review_pending":
    case "validation_pending":
    case "awaiting_approval":
      return "pending";
    default:
      return undefined;
  }
}

/**
 * After a work item terminalizes, mirror status onto `mission.blueprint.steps` when `blueprintStepId` is set.
 */
export function applyBlueprintStepStatusFromWorkItem(
  mission: Mission,
  item: WorkItem,
  terminalStatus: WorkItem["status"]
): MissionBlueprint | undefined {
  const bp = mission.blueprint;
  if (!bp || !item.blueprintStepId) return undefined;

  const next = bp.steps.map((s) => {
    if (s.id !== item.blueprintStepId) return s;
    const mapped = mapWorkStatusToBlueprint(terminalStatus);
    if (!mapped) return s;
    return { ...s, status: mapped };
  });

  return { ...bp, steps: next };
}
