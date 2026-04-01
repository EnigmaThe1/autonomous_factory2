import test from "node:test";
import assert from "node:assert/strict";
import { decideStallRecovery, leaseTtlMsFromHeartbeatSeconds } from "../missions/runnerRecoveryPolicy";

test("decideStallRecovery: below threshold does nothing", () => {
  assert.equal(
    decideStallRecovery({
      stalledHeartbeats: 2,
      threshold: 3,
      autoReplans: 0,
      maxAutoReplans: 2,
      alreadyQueuedRecoveryReplan: false
    }),
    "none"
  );
});

test("decideStallRecovery: inject replan when under cap and not queued", () => {
  assert.equal(
    decideStallRecovery({
      stalledHeartbeats: 3,
      threshold: 3,
      autoReplans: 0,
      maxAutoReplans: 2,
      alreadyQueuedRecoveryReplan: false
    }),
    "inject_replan"
  );
});

test("decideStallRecovery: wait if recovery work already queued", () => {
  assert.equal(
    decideStallRecovery({
      stalledHeartbeats: 5,
      threshold: 3,
      autoReplans: 0,
      maxAutoReplans: 2,
      alreadyQueuedRecoveryReplan: true
    }),
    "none"
  );
});

test("decideStallRecovery: block when autoReplans exhausted", () => {
  assert.equal(
    decideStallRecovery({
      stalledHeartbeats: 3,
      threshold: 3,
      autoReplans: 2,
      maxAutoReplans: 2,
      alreadyQueuedRecoveryReplan: false
    }),
    "mark_blocked"
  );
});

test("leaseTtlMsFromHeartbeatSeconds matches runner convention", () => {
  assert.equal(leaseTtlMsFromHeartbeatSeconds(8), 20000);
  assert.equal(leaseTtlMsFromHeartbeatSeconds(3), 7500);
});
