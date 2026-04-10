import type { Mission } from "../types";
import { isKnownImplementerHardStopClassValue } from "./implementerHardStopClassInvariant";
import { isFailedWorkItemSupersededBySuccessfulRetry } from "./requiredWork";

/** Mapped to mission/UI "unknown" downstream-gating bucket (`unknown_hard_stop` is work-item storage). */
export type ImplementerHardStopFailureClass =
  | "approval_pending"
  | "approval_rejected"
  | "policy_blocked"
  | "tool_failure"
  | "operator_abort"
  | "timeout_or_system_abort"
  | "unknown";

/** Blocked/failed required implementer rows violate the hardStopClass contract. */
export type ImplementerHardStopMalformedKind =
  | "missing_hard_stop_class"
  | "unrecognized_hard_stop_class";

export type ImplementerHardStopGateResult = {
  gate: boolean;
  failureClass?: ImplementerHardStopFailureClass;
  reason?: string;
  malformed?: ImplementerHardStopMalformedKind;
};

/**
 * Canonical downstream gating classification from structured `WorkItem.hardStopClass` on required
 * implementer items. No string parsing of output/blocker and no inference from mission.approvals.
 *
 * Malformed state is explicit (`malformed` kind) so operators and tests can distinguish contract
 * violations from genuine unknown hard-stops (`unknown_hard_stop` on known-valid rows).
 */
export function classifyImplementerHardStopDownstreamGate(mission: Mission): ImplementerHardStopGateResult {
  const requiredImpl = mission.queue.filter(
    (w) =>
      w.role === "implementer" &&
      (w.status === "blocked" || w.status === "failed" || w.status === "awaiting_approval") &&
      w.requiredForCompletion !== false &&
      !isFailedWorkItemSupersededBySuccessfulRetry(mission, w)
  );
  if (!requiredImpl.length) return { gate: false };

  const missing = requiredImpl.filter((w) => {
    const v = w.hardStopClass as unknown;
    return v == null || (typeof v === "string" && v.trim() === "");
  });
  if (missing.length) {
    return {
      gate: true,
      failureClass: "unknown",
      reason: "required implementer blocked/failed without hardStopClass",
      malformed: "missing_hard_stop_class"
    };
  }

  const invalid = requiredImpl.filter((w) => !isKnownImplementerHardStopClassValue(w.hardStopClass));
  if (invalid.length) {
    return {
      gate: true,
      failureClass: "unknown",
      reason: "required implementer has unrecognized hardStopClass value",
      malformed: "unrecognized_hard_stop_class"
    };
  }

  const classes = new Set(requiredImpl.map((w) => w.hardStopClass!));

  if (classes.has("timeout_or_system_abort")) {
    return { gate: false, failureClass: "timeout_or_system_abort", reason: "timeout/system abort" };
  }
  if (classes.has("operator_abort")) {
    return { gate: true, failureClass: "operator_abort", reason: "operator abort" };
  }
  if (classes.has("policy_blocked")) {
    return { gate: true, failureClass: "policy_blocked", reason: "policy blocked" };
  }
  if (classes.has("tool_failure")) {
    return { gate: true, failureClass: "tool_failure", reason: "tool failure" };
  }
  if (classes.has("approval_rejected")) {
    return { gate: true, failureClass: "approval_rejected", reason: "approval rejected" };
  }
  if (classes.has("approval_pending")) {
    return { gate: true, failureClass: "approval_pending", reason: "pending approval" };
  }
  if (classes.has("unknown_hard_stop")) {
    const replayGuarded = requiredImpl.some(
      (w) =>
        w.hardStopClass === "unknown_hard_stop" &&
        (w.activeMutatingToolCall ||
          (typeof w.output === "string" && w.output.toLowerCase().includes("manual review is required before retrying")))
    );
    if (replayGuarded) {
      return {
        gate: true,
        failureClass: "unknown",
        reason: "manual review required before retrying interrupted mutating work"
      };
    }
    return { gate: true, failureClass: "unknown", reason: "unknown hard stop" };
  }

  return {
    gate: true,
    failureClass: "unknown",
    reason: "hardStopClass set but did not match any gated branch (internal classifier drift)",
    malformed: "unrecognized_hard_stop_class"
  };
}
