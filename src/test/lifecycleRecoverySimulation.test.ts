import test from "node:test";
import assert from "node:assert/strict";
import { tryAcquireRunnerLease } from "../missions/RunnerLease";
import { isAllowedMissionStatusTransition, resolveCompletionStatus } from "../missions/LifecycleRules";

test("restart simulation keeps lease ownership deterministic", () => {
  const t0 = 1000;
  const leaseA = tryAcquireRunnerLease(undefined, "runnerA", t0, 5000);
  assert.equal(leaseA.acquired, true);

  const runtime = {
    stalledHeartbeats: 0,
    autoReplans: 0,
    loopGuardTrips: 0,
    runnerOwnerId: leaseA.runtimePatch?.runnerOwnerId,
    runnerLeaseExpiresAt: leaseA.runtimePatch?.runnerLeaseExpiresAt
  };

  // Before expiry, a second runner restart attempt is blocked.
  const leaseB = tryAcquireRunnerLease(runtime, "runnerB", t0 + 1000, 5000);
  assert.equal(leaseB.acquired, false);

  // After expiry, takeover is permitted in a deterministic way.
  const leaseB2 = tryAcquireRunnerLease(runtime, "runnerB", t0 + 6000, 5000);
  assert.equal(leaseB2.acquired, true);
  assert.equal(leaseB2.runtimePatch?.runnerOwnerId, "runnerB");
});

test("transition simulation rejects invalid restart-from-terminal transitions", () => {
  assert.equal(isAllowedMissionStatusTransition("completed", "queued"), false);
  assert.equal(isAllowedMissionStatusTransition("failed", "running"), false);
  assert.equal(isAllowedMissionStatusTransition("blocked", "queued"), true);
});

test("blocked/completed terminal decision remains stable across restart snapshots", () => {
  const first = resolveCompletionStatus(false, true, "passed");
  const second = resolveCompletionStatus(false, true, "passed");
  assert.equal(first, "completed");
  assert.equal(second, "completed");

  const blocked = resolveCompletionStatus(true, true, "passed");
  assert.equal(blocked, "blocked");
});
