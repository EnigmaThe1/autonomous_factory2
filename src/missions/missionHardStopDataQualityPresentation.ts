import type { Mission } from "../types";
import { classifyImplementerHardStopDownstreamGate } from "./requiredImplementerHardStopGate";

/**
 * Focused-mission note when required implementer hard-stop rows violate the hardStopClass contract.
 * Complements (does not replace) the downstream-gating hint; surfaced for diagnosis, not as a normal failure class.
 */
export function focusedMissionHardStopDataQualityHintForSnapshot(mission: Mission | undefined): string | undefined {
  if (!mission || mission.status === "completed" || mission.status === "cancelled") return undefined;
  const g = classifyImplementerHardStopDownstreamGate(mission);
  if (!g.malformed) return undefined;
  if (g.malformed === "missing_hard_stop_class") {
    return "Hard-stop data quality — required blocked/failed implementer work has no hardStopClass (orchestrator contract violation; not a normal tool/approval outcome). Check recent mission events for details.";
  }
  return "Hard-stop data quality — required implementer work has an invalid hardStopClass (orchestrator contract violation; not a normal tool/approval outcome). Check recent mission events for details.";
}
