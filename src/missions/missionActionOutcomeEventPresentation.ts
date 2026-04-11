import type { MissionStatus } from "../types";
import type { ResolveApprovalOutcome, ResumeMissionOutcome, StartMissionResult } from "./missionActionResult";

/** Durable operator-action event text for bundle approve (keep in sync with `resolveBundle`). */
export const OPERATOR_ACTION_BUNDLE_APPROVED_MESSAGE =
  "Approval accepted via bundle action; mission continuation was scheduled.";
/** Durable operator-action event text for bundle reject (keep in sync with `resolveBundle`). */
export const OPERATOR_ACTION_BUNDLE_REJECTED_MESSAGE =
  "Approval rejected via bundle action; mission remains blocked.";

function statusToken(status: MissionStatus): string {
  return status;
}

export function presentStartMissionOutcomeEvent(out: StartMissionResult): string {
  if (out.pass.kind === "scheduled_pass") {
    return "Mission start requested; execution was scheduled.";
  }
  if (out.pass.reason === "compiler_blocked") {
    return "Mission start requested; compiler preflight blocked execution before scheduling.";
  }
  if (out.pass.reason === "compiler_invalid") {
    return "Mission start requested; compiler preflight returned an invalid contract before scheduling.";
  }
  return "Mission start requested; compiler preflight failed before scheduling.";
}

export function presentResumeMissionOutcomeEvent(out: ResumeMissionOutcome): string | null {
  switch (out.kind) {
    case "joined_in_flight_pass":
      return "Resume requested; joined the active run pass.";
    case "ran_pass":
      return `Resume requested; a run pass finished with status: ${statusToken(out.statusAfterPass)}.`;
    case "gated_awaiting_input":
      return "Resume requested, but mission is waiting for input.";
    case "gated_pending_approval":
      return "Resume requested, but mission is waiting for approval.";
    case "noop_terminal":
      return `Resume requested, but mission is already terminal (${statusToken(out.status)}).`;
    case "noop_missing_mission":
      return null;
    default: {
      const _exhaustive: never = out;
      return null;
    }
  }
}

export function presentResolveApprovalOutcomeEvent(out: ResolveApprovalOutcome): string | null {
  switch (out.kind) {
    case "approved_continuation_scheduled":
      return "Approval accepted; mission continuation was scheduled.";
    case "rejected_mission_blocked":
      return "Approval rejected; mission remains blocked.";
    case "noop_unknown_approval":
      return null;
    default: {
      const _exhaustive: never = out;
      return null;
    }
  }
}
