/**
 * Phase 8 stabilization: autonomy defaults, blueprint enum, and cross-links to regression suites.
 * Related coverage: missionRunnerAutonomousChain (auto-continue / step cap), missionAutonomyPolicy (protected globs),
 * missionBlueprintController.integration (soft blueprint), missionAutonomyToolRegistry (outside workspace),
 * failureRecovery (repair routing).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadMissionAutonomyPolicy } from "../security/missionAutonomyPolicy";
import type { PolicyConfigGet } from "../security/missionAutonomyPolicyTypes";
import { normalizeBlueprintModeSetting } from "../missions/missionBlueprintMode";

test("Phase 8: loadMissionAutonomyPolicy fallbacks match stabilization defaults", () => {
  const p = loadMissionAutonomyPolicy(((k, d) => d) as PolicyConfigGet);
  assert.equal(p.mode, "workspace_autonomous");
  assert.equal(p.blueprintPlanning, "off");
  assert.equal(p.autoContinuePasses, true);
  assert.equal(p.requireApprovalForProtectedPaths, true);
});

test("Phase 8: blueprint setting normalization for UI snapshot", () => {
  assert.equal(normalizeBlueprintModeSetting(false), "off");
  assert.equal(normalizeBlueprintModeSetting(true), "soft");
  assert.equal(normalizeBlueprintModeSetting("hard"), "hard");
});
