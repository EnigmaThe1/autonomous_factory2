import test from "node:test";
import assert from "node:assert/strict";
import { buildFailureInvestigationWave } from "../missions/failureInvestigationEnqueue";
import type { WorkItem } from "../types";

const baseFailed: WorkItem = {
  id: "wi-impl-1",
  title: "Implementation tranche",
  role: "implementer",
  status: "failed",
  prompt: "Do the thing.",
  hardStopClass: "tool_failure"
};

test("buildFailureInvestigationWave: researcher then retry, chained dependsOn", () => {
  const wave = buildFailureInvestigationWave(baseFailed, {
    includePlanner: false,
    blockerSummary: "writeFile: disk full"
  });
  assert.equal(wave.length, 2);
  assert.equal(wave[0].role, "researcher");
  assert.equal(wave[0].workItemPurpose, "failure_investigation_diagnose");
  assert.ok(!wave[0].dependsOn?.length);
  assert.equal(wave[1].role, "implementer");
  assert.equal(wave[1].workItemPurpose, "failure_recovery_retry");
  assert.deepEqual(wave[1].dependsOn, [wave[0].id]);
  assert.ok(String(wave[1].title).includes("retry"));
});

test("buildFailureInvestigationWave: includes planner when requested", () => {
  const wave = buildFailureInvestigationWave(baseFailed, {
    includePlanner: true,
    blockerSummary: "runCommand: exit 1"
  });
  assert.equal(wave.length, 3);
  assert.equal(wave[1].role, "planner");
  assert.deepEqual(wave[1].dependsOn, [wave[0].id]);
  assert.deepEqual(wave[2].dependsOn, [wave[1].id]);
});
