import type { MissionStatus } from "../types";
import type {
  ResolveApprovalOutcome,
  ResumeMissionOutcome,
  RunMissionPassOutcome,
  StartMissionResult
} from "../missions/MissionOrchestrator";

function statusLabel(status: MissionStatus): string {
  switch (status) {
    case "completed":
      return "completed";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "awaiting_input":
      return "waiting for input";
    case "queued":
      return "queued (resumable)";
    case "running":
      return "running";
    default:
      return status;
  }
}

export function presentStartMissionOutcome(out: StartMissionResult): string {
  // Start is fire-and-forget; do not imply completion.
  if (out.pass.kind === "scheduled_pass") return "Mission started; execution has been scheduled.";
  return "Mission started.";
}

export function presentResumeMissionOutcome(out: ResumeMissionOutcome): string {
  switch (out.kind) {
    case "joined_in_flight_pass":
      return "Mission already running; joined the active pass.";
    case "ran_pass":
      return `Mission run finished; status is now ${statusLabel(out.statusAfterPass)}.`;
    case "gated_awaiting_input":
      return "Mission is waiting for input before it can continue.";
    case "gated_pending_approval":
      return "Mission is waiting for approval before it can continue.";
    case "noop_terminal":
      return `Mission is already terminal (${statusLabel(out.status)}); no new run was started.`;
    case "noop_missing_mission":
      return "Mission could not be found.";
    default: {
      const _exhaustive: never = out;
      return "Mission action completed.";
    }
  }
}

export function presentResolveApprovalOutcome(out: ResolveApprovalOutcome): string {
  switch (out.kind) {
    case "approved_continuation_scheduled":
      return "Approval accepted; continuation has been scheduled.";
    case "rejected_mission_blocked":
      return "Approval rejected; mission remains blocked.";
    case "noop_unknown_approval":
      return "Approval request was not found or was already resolved.";
    default: {
      const _exhaustive: never = out;
      return "Approval action completed.";
    }
  }
}

/**
 * Transient UI (sidebar info toast, command palette) after a bundle approve/reject pass.
 * Aligns command vs sidebar copy; does not imply mission completion.
 */
export function presentBundleOperatorUiFeedback(args: {
  approved: boolean;
  itemCount: number;
  anyResolved: boolean;
}): string {
  const { approved, itemCount, anyResolved } = args;
  const n = itemCount;
  if (!anyResolved) {
    return approved
      ? `Bundle approve: no requests resolved (${n} item(s) — each was already resolved or missing).`
      : `Bundle reject: no requests resolved (${n} item(s) — each was already resolved or missing).`;
  }
  return approved
    ? `Bundle approved (${n} item(s)). Continuation may be scheduled; mission is not necessarily complete.`
    : `Bundle rejected (${n} item(s)). Mission may remain blocked; not complete.`;
}

export function presentRunMissionOutcome(out: RunMissionPassOutcome): string {
  switch (out.kind) {
    case "joined_in_flight_pass":
      return "Mission already running; joined the active pass.";
    case "ran_pass":
      return `Mission run finished; status is now ${statusLabel(out.statusAfterPass)}.`;
    case "noop_missing_mission":
      return "Mission could not be found.";
    default: {
      const _exhaustive: never = out;
      return "Mission run completed.";
    }
  }
}

