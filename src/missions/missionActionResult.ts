import type { Mission, MissionStatus } from "../types";

/** Why a `runMission` pass ended (Phase 5 runner observability + autonomous chaining). */
export type MissionRunPassStopReason =
  | "max_steps_per_run"
  | "awaiting_input_pending_approval"
  | "awaiting_input_mission_status"
  | "work_item_awaiting_input_or_blocked"
  | "terminal_completed"
  | "terminal_blocked"
  | "terminal_failed"
  | "cancelled"
  | "max_auto_rounds"
  | "natural_pause";

/**
 * Result of awaiting a `runMission` pass for this invocation: either this call ran a pass to its
 * natural end, joined another caller’s in-flight pass, or found no mission.
 * `statusAfterPass` is from `store.get` after the pass; it is not a success guarantee (`blocked`/`failed` are valid).
 */
export type RunMissionPassOutcome =
  | { kind: "joined_in_flight_pass"; missionId: string }
  | {
      kind: "ran_pass";
      missionId: string;
      statusAfterPass: MissionStatus;
      stopReason?: MissionRunPassStopReason;
    }
  | { kind: "noop_missing_mission"; missionId: string };

/**
 * Result of `resumeMission`: gated early returns, terminal no-ops, join, or a full `runMission` outcome.
 */
export type ResumeMissionOutcome =
  | { kind: "joined_in_flight_pass"; missionId: string }
  | { kind: "noop_terminal"; missionId: string; status: MissionStatus }
  | { kind: "gated_awaiting_input"; missionId: string }
  | { kind: "gated_pending_approval"; missionId: string }
  | { kind: "ran_pass"; missionId: string; statusAfterPass: MissionStatus }
  | { kind: "noop_missing_mission"; missionId: string };

/**
 * Result of `resolveApproval`: unknown id, rejection (mission set blocked), or approval with async pass scheduled.
 */
export type ResolveApprovalOutcome =
  | { kind: "noop_unknown_approval"; missionId: string; approvalId: string }
  | { kind: "rejected_mission_blocked"; missionId: string; statusAfter: MissionStatus }
  | { kind: "approved_continuation_scheduled"; missionId: string };

export type StartMissionPass =
  | { kind: "scheduled_pass"; missionId: string }
  | {
      kind: "blocked_before_schedule";
      missionId: string;
      statusAfter: "blocked";
      reason: "compiler_blocked" | "compiler_failed" | "compiler_invalid";
      summary: string;
    };

/** Result of `startMission`: created mission plus explicit schedule/block outcome. */
export type StartMissionResult = {
  mission: Mission;
  pass: StartMissionPass;
};
