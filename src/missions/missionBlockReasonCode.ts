import type { MissionBlockReasonCode } from "../types";
import type { ImplementerHardStopFailureClass } from "./requiredImplementerHardStopGate";

/**
 * Map downstream-gating failure class to mission-level code when the orchestrator fixes mission status.
 */
export function missionBlockReasonFromDownstreamGate(
  failureClass: ImplementerHardStopFailureClass | undefined,
  desiredStatus: "awaiting_input" | "blocked",
  reason?: string
): MissionBlockReasonCode {
  if (desiredStatus === "awaiting_input") return "approval_pending";
  switch (failureClass) {
    case "approval_rejected":
      return "approval_rejected";
    case "policy_blocked":
      return "policy_blocked";
    case "tool_failure":
      return "tool_failure";
    case "operator_abort":
      return "operator_stream_abort";
    case "unknown":
      if (typeof reason === "string" && /manual review required before retrying interrupted mutating work/i.test(reason)) {
        return "manual_review_required";
      }
      return "generic_blocked";
    default:
      return "generic_blocked";
  }
}
