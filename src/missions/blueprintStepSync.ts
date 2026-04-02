import type { Mission, WorkItem } from "../types";
import type { BlueprintStepStatus, MissionBlueprint } from "./missionBlueprintTypes";

function mapWorkStatusToBlueprint(status: WorkItem["status"]): BlueprintStepStatus | undefined {
  switch (status) {
    case "done":
    case "skipped":
      return status === "skipped" ? "skipped" : "done";
    case "failed":
    case "blocked":
      return "blocked";
    case "running":
      return "in_progress";
    case "todo":
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
