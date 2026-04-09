import type { Mission } from "../types";
import {
  classifyImplementerHardStopDownstreamGate,
  type ImplementerHardStopFailureClass
} from "./requiredImplementerHardStopGate";

export type DownstreamGateFailureClass = ImplementerHardStopFailureClass;

function isManualReviewRequiredGate(
  gate: ReturnType<typeof classifyImplementerHardStopDownstreamGate>
): boolean {
  return gate.failureClass === "unknown" && /manual review required before retrying interrupted mutating work/i.test(gate.reason || "");
}

function hasRunnablePlannerOrImplementerTodo(mission: Mission): boolean {
  return mission.queue.some((w) => (w.role === "planner" || w.role === "implementer") && w.status === "todo");
}

export function missionDownstreamGatingOperatorHint(mission: Mission): string | undefined {
  // Only surface when the mission is in an operator-facing hard-stop lifecycle state.
  if (!(mission.status === "blocked" || mission.status === "awaiting_input")) return undefined;

  const gate = classifyImplementerHardStopDownstreamGate(mission);
  if (!gate.gate) return undefined;

  const noRecoveryRunnable = !hasRunnablePlannerOrImplementerTodo(mission);
  const base =
    "Required implementer work is blocked or failed; downstream review and validation are paused to avoid misleading progress.";
  const tail = noRecoveryRunnable ? " No eligible recovery work is currently runnable." : "";

  if (gate.malformed === "missing_hard_stop_class") {
    return `${base} Data contract violation: hardStopClass is missing on required implementer work (malformed queue; not a normal hard-stop class).${tail}`;
  }
  if (gate.malformed === "unrecognized_hard_stop_class") {
    return `${base} Data contract violation: hardStopClass is invalid or inconsistent on required implementer work (malformed queue; not a normal hard-stop class).${tail}`;
  }
  if (isManualReviewRequiredGate(gate)) {
    return `${base} Interrupted mutating work may already have executed. Manual review is required before any retry; this is not a normal safe-resume state.${tail}`;
  }

  switch (gate.failureClass) {
    case "approval_pending":
      if (mission.blockReasonCode === "approval_gate_stale") {
        return `${base} A work item is marked approval-pending, but no pending approval exists on the mission (stale or cleared). Inspect the blocked implementer row; reset or fix queue state before resuming.${tail}`;
      }
      return `${base} Approval is still required before implementer work can continue.${tail}`;
    case "approval_rejected":
      return `${base} The approval was rejected; implementer recovery is required before downstream steps continue.${tail}`;
    case "policy_blocked":
      return `${base} A policy block stopped implementer progress.${tail}`;
    case "tool_failure":
      return `${base} A tool failure stopped implementer progress.${tail}`;
    case "operator_abort":
      return `${base} Implementer work was aborted by the operator.${tail}`;
    default:
      return `${base} Implementer work hit an unknown hard-stop.${tail}`;
  }
}

export function focusedMissionDownstreamGatingHintForSnapshot(mission: Mission | undefined): string | undefined {
  if (!mission) return undefined;
  if (mission.status === "completed" || mission.status === "cancelled") return undefined;
  return missionDownstreamGatingOperatorHint(mission);
}

export function missionDownstreamGatingCardHint(mission: Mission): string | undefined {
  if (mission.status === "completed" || mission.status === "cancelled") return undefined;
  const gate = classifyImplementerHardStopDownstreamGate(mission);
  if (!gate.gate) return undefined;
  if (gate.malformed === "missing_hard_stop_class") return "Implementer blocked: data error (missing class)";
  if (gate.malformed === "unrecognized_hard_stop_class") return "Implementer blocked: data error (invalid class)";
  if (isManualReviewRequiredGate(gate)) return "Implementer blocked: manual review required";
  const noRecoveryRunnable = !hasRunnablePlannerOrImplementerTodo(mission);
  if (noRecoveryRunnable) return "Implementer blocked: no runnable recovery work";
  switch (gate.failureClass) {
    case "approval_pending":
      if (mission.blockReasonCode === "approval_gate_stale") {
        return "Implementer blocked: approval gate stale (no pending row)";
      }
      return "Implementer blocked: approval required";
    case "approval_rejected":
      return "Implementer blocked: approval rejected";
    case "policy_blocked":
      return "Implementer blocked: policy blocked";
    case "tool_failure":
      return "Implementer blocked: tool failure";
    case "operator_abort":
      return "Implementer blocked: operator abort";
    default:
      return "Implementer blocked: hard-stop";
  }
}

