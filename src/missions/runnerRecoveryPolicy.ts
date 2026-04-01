/**
 * Pure policy for background-runner stall / auto-replan decisions.
 * Keeps recovery behavior testable without the extension host.
 */
export type StallRecoveryDecision = "none" | "inject_replan" | "mark_blocked";

export function decideStallRecovery(input: {
  stalledHeartbeats: number;
  threshold: number;
  autoReplans: number;
  maxAutoReplans: number;
  alreadyQueuedRecoveryReplan: boolean;
}): StallRecoveryDecision {
  const { stalledHeartbeats, threshold, autoReplans, maxAutoReplans, alreadyQueuedRecoveryReplan } = input;
  if (stalledHeartbeats < threshold) return "none";
  if (autoReplans < maxAutoReplans) {
    if (!alreadyQueuedRecoveryReplan) return "inject_replan";
    return "none";
  }
  return "mark_blocked";
}

export function leaseTtlMsFromHeartbeatSeconds(heartbeatSeconds: number): number {
  return Math.max(3, heartbeatSeconds) * 2500;
}
