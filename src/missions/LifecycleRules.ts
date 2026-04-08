import { MissionStatus } from "../types";

const ALLOWED_TRANSITIONS: Record<MissionStatus, ReadonlySet<MissionStatus>> = {
  queued: new Set(["queued", "running", "awaiting_input", "blocked", "failed", "cancelled", "completed"]),
  running: new Set(["running", "queued", "awaiting_input", "blocked", "failed", "cancelled", "completed"]),
  awaiting_input: new Set(["awaiting_input", "queued", "running", "blocked", "failed", "cancelled"]),
  blocked: new Set(["blocked", "queued", "running", "awaiting_input", "failed", "cancelled"]),
  completed: new Set(["completed"]),
  /**
   * `failed` ends automatic execution, but the operator may salvage the mission after a transient error
   * (e.g. provider stream abort) or to clear pending approvals. Allow transitions back into the active loop.
   */
  failed: new Set(["failed", "queued", "running", "awaiting_input", "blocked"]),
  cancelled: new Set(["cancelled"])
};

export function isAllowedMissionStatusTransition(from: MissionStatus, to: MissionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function resolveCompletionStatus(
  hasBlockedWorkItems: boolean,
  closureRequired: boolean,
  validationState: "pending" | "passed" | "failed" | undefined
): "completed" | "blocked" {
  if (hasBlockedWorkItems) return "blocked";
  if (!closureRequired) return "completed";
  return validationState === "passed" ? "completed" : "blocked";
}

/**
 * Mission will not advance without an explicit operator action (`resumeMission`, `resolveApproval`, or new work).
 * Does not mean success: `blocked` and `failed` are terminal for automatic execution.
 * `awaiting_input`, `queued`, and `running` are non-terminal.
 * To wait until this predicate holds (or timeout), use `MissionOrchestrator.whenMissionReachesTerminalLifecycleStatus`.
 */
export function isMissionTerminalLifecycleStatus(status: MissionStatus): boolean {
  return status === "completed" || status === "blocked" || status === "failed" || status === "cancelled";
}
