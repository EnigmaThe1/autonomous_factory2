/**
 * Unit tests: path/command classification and may* helpers (no ToolRegistry).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCommandZone,
  classifyPathZone,
  evaluatePathWrite,
  isExtensionCorePath,
  matchesWorkspaceRelativeGlob,
  mayWrite,
  missionAutonomyPolicyForTest
} from "../security/missionAutonomyPolicy";
import { autonomyShouldScheduleNextPassAfterStepCap } from "../missions/missionRunnerAutonomy";
import type { PolicySettings } from "../security/TrustPolicyEngine";

const strictSettings: PolicySettings = {
  allowTerminal: true,
  requireApprovalForWrite: true,
  requireApprovalForInWorkspaceWrites: true,
  requireApprovalForTerminal: true,
  requireApprovalForHttp: true,
  requireApprovalForMcp: true,
  requireApprovalForExternal: true,
  restrictToWorkspace: true
};

test("matchesWorkspaceRelativeGlob: prefix and exact", () => {
  assert.equal(matchesWorkspaceRelativeGlob("secrets/key.txt", "secrets/**"), true);
  assert.equal(matchesWorkspaceRelativeGlob("other/x", "secrets/**"), false);
  assert.equal(matchesWorkspaceRelativeGlob("foo/bar", "foo/bar"), true);
});

test("classifyCommandZone: host risk vs safe", () => {
  assert.equal(classifyCommandZone("npm test"), "workspace_safe");
  assert.equal(classifyCommandZone("sudo apt update"), "host_risk");
  assert.equal(classifyCommandZone("ssh user@host"), "host_risk");
});

test("isExtensionCorePath: only when outside workspace tree", () => {
  const ext = "/home/.vscode/extensions/x";
  const ws = "/proj/app";
  assert.equal(isExtensionCorePath(`${ext}/package.json`, ext, ws), true);
  assert.equal(isExtensionCorePath(`${ws}/src/a.ts`, ext, ws), false);
});

test("classifyPathZone: blocked glob wins over open workspace", () => {
  const autonomy = missionAutonomyPolicyForTest({
    mode: "workspace_coder",
    blockedPathGlobs: ["no-touch/**"]
  });
  const z = classifyPathZone("/ws/no-touch/x", "/ws", "/ext", autonomy);
  assert.equal(z.zone, "workspace_blocked");
});

test("mayWrite: workspace_coder allows ordinary workspace path", () => {
  const autonomy = missionAutonomyPolicyForTest({ mode: "workspace_coder" });
  assert.equal(mayWrite("/ws/src/a.ts", "/ws", "/ext", autonomy, strictSettings), true);
});

test("mayWrite: outside workspace always false", () => {
  const autonomy = missionAutonomyPolicyForTest({ mode: "workspace_coder" });
  assert.equal(mayWrite("/tmp/out.txt", "/ws", "/ext", autonomy, strictSettings), false);
});

test("evaluatePathWrite: autonomy protected glob allows when requireApprovalForProtectedPaths is false", () => {
  const autonomy = missionAutonomyPolicyForTest({
    mode: "workspace_coder",
    protectedPathGlobs: ["vendor/**"],
    requireApprovalForProtectedPaths: false
  });
  const ad = evaluatePathWrite("/ws/vendor/pkg/a.txt", "/ws", "/ext", autonomy, strictSettings);
  assert.equal(ad.kind, "allow");
});

test("autonomyShouldScheduleNextPassAfterStepCap: honors autoContinuePasses and mode", () => {
  assert.equal(autonomyShouldScheduleNextPassAfterStepCap("workspace_autonomous", false), false);
  assert.equal(autonomyShouldScheduleNextPassAfterStepCap("workspace_autonomous", true), true);
  assert.equal(autonomyShouldScheduleNextPassAfterStepCap("strict", true), false);
});
