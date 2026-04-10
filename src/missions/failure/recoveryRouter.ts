import type { RecoveryDecision, RecoveryRouterContext, StructuredFailure } from "./structuredFailureTypes";

/** After this many identical fingerprints, force terminal handling instead of recovery waves. */
export const MAX_RECOVERY_SAME_FINGERPRINT_STREAK = 4;

export function routeStructuredRecovery(failure: StructuredFailure, ctx: RecoveryRouterContext): RecoveryDecision {
  if (ctx.sameFingerprintStreak >= MAX_RECOVERY_SAME_FINGERPRINT_STREAK) {
    return {
      route: ctx.allowTerminalMissionFail ? "fail" : "block",
      reason: `Recovery fingerprint repeated ${ctx.sameFingerprintStreak} times; escalating to terminal handling.`
    };
  }

  if (failure.domain === "policy" && failure.class === "hard_deny") {
    return { route: "block", reason: "Policy hard denial (host/outside workspace or explicit deny)." };
  }

  if (failure.domain === "runtime" && failure.code === "operator_stream_abort") {
    return { route: "block", reason: "Operator cancelled the model stream; mission paused." };
  }

  if (failure.domain === "runtime" && failure.class === "transient") {
    return { route: "retry_direct", reason: "Transient runtime abort; mission continues with downstream work." };
  }

  if (failure.domain === "tool" && failure.class === "hard_deny") {
    return { route: "block", reason: "Tool failure classified as hard deny (executor crash)." };
  }

  if (failure.class === "transient") {
    if (ctx.failureInvestigationEnabled && ctx.failureInvestigationWavesRemaining > 0) {
      return { route: "spawn_recovery_work", reason: "Transient tool failure; enqueue recovery wave when enabled." };
    }
    return { route: "block", reason: "Transient tool failure but recovery waves disabled or exhausted; pause for operator." };
  }

  if (failure.class === "environmental") {
    return { route: "replan", reason: "Environmental constraint; prefer research/planner-assisted replan." };
  }

  if (failure.class === "repairable") {
    if (failure.domain === "validation" || failure.domain === "tool") {
      if (ctx.failureInvestigationEnabled && ctx.failureInvestigationWavesRemaining > 0) {
        return { route: "spawn_recovery_work", reason: "Repairable failure; structured recovery wave." };
      }
      return { route: "block", reason: "Repairable failure but failure investigation disabled or wave budget exhausted." };
    }
    if (failure.domain === "blueprint") {
      return { route: "replan", reason: "Blueprint repairable via revision / replan." };
    }
    return { route: "replan", reason: "Repairable failure default: replan." };
  }

  if (failure.class === "hard_deny") {
    return { route: "block", reason: "Hard deny: stop autonomous mutation / execution." };
  }

  return { route: "block", reason: "Unclassified failure; conservative block." };
}
