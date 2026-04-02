import test from "node:test";
import assert from "node:assert/strict";
import { runSingleFlight } from "../util";

test("runSingleFlight: concurrent callers share one task invocation", async () => {
  let runs = 0;
  const slot: { current: Promise<number> | null } = { current: null };
  const task = async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 5));
    return 7;
  };
  const a = runSingleFlight(slot, task);
  const b = runSingleFlight(slot, task);
  assert.strictEqual(a, b);
  assert.deepEqual(await Promise.all([a, b]), [7, 7]);
  assert.equal(runs, 1);
  assert.equal(slot.current, null);
});

test("runSingleFlight: after settle, a new call runs task again", async () => {
  let runs = 0;
  const slot: { current: Promise<number> | null } = { current: null };
  const task = async () => {
    runs += 1;
    return runs;
  };
  assert.equal(await runSingleFlight(slot, task), 1);
  assert.equal(slot.current, null);
  assert.equal(await runSingleFlight(slot, task), 2);
  assert.equal(runs, 2);
});

test("runSingleFlight: rejected task clears slot for retry", async () => {
  let runs = 0;
  const slot: { current: Promise<number> | null } = { current: null };
  const failOnce = async () => {
    runs += 1;
    if (runs === 1) throw new Error("first");
    return 99;
  };
  await assert.rejects(runSingleFlight(slot, failOnce), /first/);
  assert.equal(slot.current, null);
  assert.equal(await runSingleFlight(slot, failOnce), 99);
  assert.equal(runs, 2);
});
