import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveMaxToolFollowUpTurns,
  resolveToolRecoveryAutonomyPreset,
  resolveToolRecoveryLimits
} from "../missions/orchestrator/toolRecoveryAutonomyLimits";

function mockConfig(values: Record<string, unknown>) {
  return {
    get<T>(key: string, defaultValue: T): T {
      if (Object.prototype.hasOwnProperty.call(values, key)) return values[key] as T;
      return defaultValue;
    }
  };
}

test("resolveToolRecoveryAutonomyPreset: defaults to standard", () => {
  assert.equal(resolveToolRecoveryAutonomyPreset(mockConfig({})), "standard");
});

test("resolveToolRecoveryLimits: standard uses configured bases", () => {
  const lim = resolveToolRecoveryLimits(
    mockConfig({
      "myAi.missions.toolRecoveryAutonomyPreset": "standard",
      "myAi.missions.maxRecoverableReadonlyFailuresPerWorkItem": 7,
      "myAi.missions.maxTransientMutatingFailuresPerWorkItem": 3,
      "myAi.missions.maxRunCommandProbeFailuresPerWorkItem": 9,
      "myAi.missions.maxRunCommandRecoveryAttemptsPerWorkItem": 5,
      "myAi.missions.maxWriteFileRecoveryAttemptsPerWorkItem": 6,
      "myAi.missions.maxApplyPatchRecoveryAttemptsPerWorkItem": 8
    })
  );
  assert.equal(lim.maxRecoverableReadonlyFailuresPerWorkItem, 7);
  assert.equal(lim.maxTransientMutatingFailuresPerWorkItem, 3);
  assert.equal(lim.maxRunCommandProbeFailuresPerWorkItem, 9);
  assert.equal(lim.maxRunCommandAgentRetry, 5);
  assert.equal(lim.maxWriteFileAgentRetry, 6);
  assert.equal(lim.maxApplyPatchAgentRetry, 8);
});

test("resolveToolRecoveryLimits: exploratory boosts positive caps", () => {
  const lim = resolveToolRecoveryLimits(
    mockConfig({
      "myAi.missions.toolRecoveryAutonomyPreset": "exploratory",
      "myAi.missions.maxRecoverableReadonlyFailuresPerWorkItem": 10,
      "myAi.missions.maxTransientMutatingFailuresPerWorkItem": 4,
      "myAi.missions.maxRunCommandProbeFailuresPerWorkItem": 12,
      "myAi.missions.maxRunCommandRecoveryAttemptsPerWorkItem": 12,
      "myAi.missions.maxWriteFileRecoveryAttemptsPerWorkItem": 12,
      "myAi.missions.maxApplyPatchRecoveryAttemptsPerWorkItem": 12
    })
  );
  assert.equal(lim.maxRecoverableReadonlyFailuresPerWorkItem, 18);
  assert.equal(lim.maxTransientMutatingFailuresPerWorkItem, 7);
  assert.equal(lim.maxRunCommandProbeFailuresPerWorkItem, 21);
  assert.equal(lim.maxRunCommandAgentRetry, 21);
});

test("resolveMaxToolFollowUpTurns: exploratory scales production follow-ups", () => {
  const prod = resolveMaxToolFollowUpTurns(
    mockConfig({
      "myAi.missions.toolRecoveryAutonomyPreset": "exploratory",
      "myAi.missions.maxToolFollowUpTurns": 10
    }),
    false
  );
  assert.equal(prod, 16);
});

test("resolveMaxToolFollowUpTurns: test harness ignores exploratory", () => {
  const t = resolveMaxToolFollowUpTurns(
    mockConfig({
      "myAi.missions.toolRecoveryAutonomyPreset": "exploratory",
      "myAi.missions.maxToolFollowUpsWhenTestHarness": 3,
      "myAi.missions.maxToolFollowUpTurns": 99
    }),
    true
  );
  assert.equal(t, 3);
});
