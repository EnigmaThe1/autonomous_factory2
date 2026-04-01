import { MissionRuntime } from "../types";

export interface RunnerLeaseResult {
  acquired: boolean;
  runtimePatch?: Partial<MissionRuntime>;
}

export function tryAcquireRunnerLease(
  runtime: MissionRuntime | undefined,
  ownerId: string,
  nowMs: number,
  ttlMs: number
): RunnerLeaseResult {
  const leaseOwner = runtime?.runnerOwnerId;
  const leaseExpiry = runtime?.runnerLeaseExpiresAt || 0;
  const expired = leaseExpiry <= nowMs;
  const sameOwner = leaseOwner === ownerId;
  const unowned = !leaseOwner;
  if (unowned || sameOwner || expired) {
    return {
      acquired: true,
      runtimePatch: {
        runnerOwnerId: ownerId,
        runnerLeaseExpiresAt: nowMs + ttlMs
      }
    };
  }
  return { acquired: false };
}
