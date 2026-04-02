/**
 * Pure policy for background-runner stall / auto-replan decisions.
 * Keeps recovery behavior testable without the extension host.
 */
import { clampMissionHeartbeatSeconds } from "../config/myAiSettingBounds";

/** Runner lease TTL (ms) = clamped heartbeat seconds × this factor (2.5s wall per 1s heartbeat setting). */
export const RUNNER_LEASE_TTL_MS_PER_HEARTBEAT_SECOND = 2500;

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
  return clampMissionHeartbeatSeconds(heartbeatSeconds) * RUNNER_LEASE_TTL_MS_PER_HEARTBEAT_SECOND;
}
