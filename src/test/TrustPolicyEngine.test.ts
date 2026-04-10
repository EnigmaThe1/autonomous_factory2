import test from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { TrustPolicyEngine } from "../security/TrustPolicyEngine";
import type { VscodeTestApi } from "./missionOrchestratorTestHarness";

const V = vscode as VscodeTestApi;

test("blocks file access outside workspace when restricted", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: false,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: true,
    requireApprovalForHttp: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: true
  });
  const decision = engine.decide({ action: "write_file", targetPath: "/tmp/out.txt" });
  assert.equal(decision.allowed, false);
});

test("requires approval for write/patch and allows read (in-workspace, strict autonomy)", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: true,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: true,
    requireApprovalForTerminal: false,
    requireApprovalForHttp: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: true
  });
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "strict");
  assert.equal(engine.decide({ action: "read_file", targetPath: "/repo/docs/a.txt" }).allowed, true);
  assert.equal(engine.decide({ action: "write_file", targetPath: "/repo/docs/a.txt" }).requiresApproval, true);
  assert.equal(engine.decide({ action: "apply_patch", targetPath: "/repo/src/a.ts" }).requiresApproval, true);
  V.__clearTestConfig?.();
});

test("terminal execution obeys policy", () => {
  const disabled = new TrustPolicyEngine("/repo", {
    allowTerminal: false,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: true,
    requireApprovalForHttp: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: false
  });
  assert.equal(disabled.decide({ action: "run_terminal", commandText: "echo hi" }).allowed, false);

  const enabled = new TrustPolicyEngine("/repo", {
    allowTerminal: true,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: true,
    requireApprovalForHttp: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: false
  });
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "strict");
  assert.equal(enabled.decide({ action: "run_terminal", commandText: "echo hi" }).allowed, true);
  assert.equal(enabled.decide({ action: "run_terminal", commandText: "echo hi" }).requiresApproval, true);
  V.__clearTestConfig?.();
});

test("in-workspace writes require approval when requireApprovalForInWorkspaceWrites is true (strict mode)", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: false,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: true,
    requireApprovalForTerminal: true,
    requireApprovalForHttp: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: true
  });
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "strict");
  assert.equal(engine.decide({ action: "write_file", targetPath: "/repo/docs/note.md" }).requiresApproval, true);
  assert.equal(engine.decide({ action: "apply_patch", targetPath: "/repo/src/a.ts" }).requiresApproval, true);
  V.__clearTestConfig?.();
});

test("in-workspace writes skip approval when requireApprovalForInWorkspaceWrites is false (strict mode)", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: false,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: true,
    requireApprovalForHttp: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: true
  });
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "strict");
  assert.equal(engine.decide({ action: "write_file", targetPath: "/repo/docs/note.md" }).requiresApproval, false);
  assert.equal(engine.decide({ action: "apply_patch", targetPath: "/repo/src/a.ts" }).requiresApproval, false);
  V.__clearTestConfig?.();
});

test("workspace_coder: ordinary in-workspace write does not require approval", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: true,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: true,
    requireApprovalForTerminal: true,
    requireApprovalForHttp: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: true
  });
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");
  V.__setTestConfig?.("myAi.missions.autonomy.autoApproveWorkspaceWrites", true);
  const d = engine.decide({ action: "write_file", targetPath: "/repo/src/x.ts" });
  assert.equal(d.allowed, true);
  assert.equal(d.requiresApproval, false);
  V.__clearTestConfig?.();
});

test("workspace_coder: host-risk run_command is denied", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: true,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: false,
    requireApprovalForHttp: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: true
  });
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");
  const d = engine.decide({ action: "run_command", commandText: "sudo rm -rf /", commandCwd: "/repo" });
  assert.equal(d.allowed, false);
  V.__clearTestConfig?.();
});
