import type { Mission } from "../types";
import { classifyImplementerHardStopDownstreamGate } from "./requiredImplementerHardStopGate";

/**
 * Matches `eventIndicatesMaxStepsResume` in `media/chat/missionOperatorLabelsCore.js` (keep in sync).
 */
export function missionEventsIndicateMaxStepsResume(events: Mission["events"] | undefined): boolean {
  if (!events?.length) return false;
  return events.slice(-8).some(
    (e) =>
      typeof e.message === "string" &&
      /maxStepsPerRun/i.test(e.message) &&
      /resumable/i.test(e.message)
  );
}

/**
 * Phrases align with `MISSION_COMPLETION_REASON_LABELS` in `missionOperatorLabelsCore.js`.
 */
const COMPLETION_REASON_LIFECYCLE_PHRASE: Record<NonNullable<Mission["completionReason"]>, string> = {
  already_satisfied_no_tool_run: "Already satisfied; no tool run needed",
  apply_patch_noop_success: "Patch not needed; desired content already present",
  stale_patch_but_goal_already_met: "Patch was stale; goal already validated as met"
};

const BLOCKED_DOWNSTREAM_HARD_STOP =
  "Blocked on required implementer work; review and validation are paused.";
const BLOCKED_MANUAL_REVIEW_REQUIRED =
  "Blocked intentionally; manual review is required before retrying interrupted mutating work.";
const BLOCKED_APPROVAL_REJECTED =
  "Blocked after approval rejection; implementer recovery is required before the mission can continue.";
const BLOCKED_TOOL_FAILURE =
  "Blocked after tool failure; operator attention is required before the mission can continue.";
const BLOCKED_OPERATOR_ABORT =
  "Paused after operator abort; safe to resume when ready.";

/**
 * Single operator-facing lifecycle line for the focused mission (inspector + focused card).
 *
 * **Precedence** (first match wins; all branches are mutually exclusive on `mission.status` except
 * blocked, which inspects downstream-gating classification):
 * 1. Terminal: `completed` (optional `completionReason` clause), `cancelled`, `failed`
 * 2. `awaiting_input`: pending approval vs other input
 * 3. `running`: active queue role, else generic in-progress
 * 4. `blocked`: implementer hard-stop downstream gate (including malformed hardStopClass) vs generic
 * 5. `queued`: max-steps resumable hint vs generic idle queue
 * 6. Fallback: raw status label
 */
export function focusedMissionLifecycleSummary(mission: Mission): string {
  const status = mission.status;

  if (status === "completed") {
    const cr = mission.completionReason;
    const phrase = cr ? COMPLETION_REASON_LIFECYCLE_PHRASE[cr] : undefined;
    if (phrase) return `Completed; ${phrase}.`;
    return "Completed.";
  }

  if (status === "cancelled") return "Cancelled.";

  if (status === "failed") return "Failed; operator attention required.";

  if (status === "awaiting_input") {
    const pend = (mission.approvals || []).filter((a) => a.status === "pending").length;
    if (pend > 0) return "Waiting for approval to continue.";
    if (mission.blockReasonCode === "post_validator_checkpoint") {
      return "Validator finished; resume the mission to continue.";
    }
    return "Waiting for required input.";
  }

  if (status === "running") {
    const run = mission.queue.find((w) => w.status === "running");
    if (run?.role) return `Running now; ${run.role} is active.`;
    return "Running now; automation is in progress.";
  }

  if (status === "blocked") {
    const gate = classifyImplementerHardStopDownstreamGate(mission);
    if (
      mission.blockReasonCode === "manual_review_required" ||
      (gate.gate && /manual review required before retrying interrupted mutating work/i.test(gate.reason || ""))
    ) {
      return BLOCKED_MANUAL_REVIEW_REQUIRED;
    }
    if (mission.blockReasonCode === "approval_rejected" || (gate.gate && gate.failureClass === "approval_rejected")) {
      return BLOCKED_APPROVAL_REJECTED;
    }
    if (mission.blockReasonCode === "tool_failure" || (gate.gate && gate.failureClass === "tool_failure")) {
      return BLOCKED_TOOL_FAILURE;
    }
    if (mission.blockReasonCode === "operator_stream_abort" || (gate.gate && gate.failureClass === "operator_abort")) {
      return BLOCKED_OPERATOR_ABORT;
    }
    if (gate.gate) return BLOCKED_DOWNSTREAM_HARD_STOP;
    return "Blocked; operator attention required.";
  }

  if (status === "queued") {
    const blockerTrim =
      mission.blocker != null && String(mission.blocker).trim() ? String(mission.blocker).trim() : "";
    if (!blockerTrim && missionEventsIndicateMaxStepsResume(mission.events)) {
      return "Paused between run passes; resumable.";
    }
    return "In queue; not running now.";
  }

  return `Mission status: ${String(status)}.`;
}

export function focusedMissionLifecycleSummaryForSnapshot(mission: Mission | undefined): string | undefined {
  if (!mission) return undefined;
  return focusedMissionLifecycleSummary(mission);
}
