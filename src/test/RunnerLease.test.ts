import test from "node:test";
import assert from "node:assert/strict";
import { tryAcquireRunnerLease } from "../missions/RunnerLease";

test("runner lease is acquired when unowned", () => {
  const result = tryAcquireRunnerLease(undefined, "runnerA", 1000, 5000);
  assert.equal(result.acquired, true);
  assert.equal(result.runtimePatch?.runnerOwnerId, "runnerA");
});

test("runner lease blocks different owner before expiry", () => {
  const result = tryAcquireRunnerLease({ stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 0, runnerOwnerId: "runnerA", runnerLeaseExpiresAt: 6000 }, "runnerB", 2000, 5000);
  assert.equal(result.acquired, false);
});

test("runner lease can be reacquired after expiry", () => {
  const result = tryAcquireRunnerLease({ stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 0, runnerOwnerId: "runnerA", runnerLeaseExpiresAt: 1000 }, "runnerB", 2000, 5000);
  assert.equal(result.acquired, true);
  assert.equal(result.runtimePatch?.runnerOwnerId, "runnerB");
});
