import type { Mission } from "../types";

/**
 * First-class “what next” copy for blocked / waiting missions (P8-T-003).
 */
export function operatorNextActionHint(mission: Mission | undefined): string | undefined {
  if (!mission) return undefined;
  const { status, blockReasonCode } = mission;
  const pending = (mission.approvals || []).filter((a) => a.status === "pending").length;

  if (blockReasonCode === "approval_gate_stale") {
    return "Queue/approval mismatch — a work item still shows approval-pending, but the Approvals tab is empty. Inspect Focus (blocked implementer row) and Timeline; reset the work item or fix stale state, then Resume.";
  }

  if (status === "awaiting_input" || blockReasonCode === "approval_pending") {
    if (pending > 0) {
      return `Approvals: ${pending} pending — open the Approvals tab (researcher/reviewer runCommand shows as kind "terminal").`;
    }
    return "Awaiting input — check the mission blocker message and use Resume when ready.";
  }

  if (blockReasonCode === "awaiting_blueprint_approval") {
    return "Blueprint: approve, reject, or request revision from the blueprint controls.";
  }

  if (blockReasonCode === "awaiting_pre_blueprint_answers") {
    return "Pre-blueprint: submit answers to planner questions, then continue blueprint generation.";
  }

  if (blockReasonCode === "stall_recovery_limit") {
    return "Stall recovery limit reached — inspect queue and events, fix the stuck step, then Resume or edit work items.";
  }

  if (blockReasonCode === "post_validator_checkpoint") {
    return "Post-validator checkpoint — use Resume after reviewing validator output.";
  }

  if (status === "blocked") {
    if (blockReasonCode === "tool_failure" || blockReasonCode === "policy_blocked") {
      return "Blocked on tool/policy — review failed work items and events; adjust scope or fix errors, then Resume.";
    }
    if (blockReasonCode === "approval_rejected") {
      return "Approval was rejected — change approach or re-submit work; pending approvals may need clearing.";
    }
    return "Mission is blocked — read the blocker line and latest events, then fix queue state or Resume.";
  }

  if (status === "queued" && pending > 0) {
    return `${pending} approval(s) pending while mission is queued — resolve approvals to unblock execution.`;
  }

  if (status === "failed") {
    return "Mission failed — review Timeline and Trace. Resume runs a salvage pass (mission re-queued; inspect queue before relying on automation).";
  }

  return undefined;
}
