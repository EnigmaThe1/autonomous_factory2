import test from "node:test";
import assert from "node:assert/strict";
import { TrustPolicyEngine } from "../security/TrustPolicyEngine";

test("blocks file access outside workspace when restricted", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: false,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: true
  });
  const decision = engine.decide({ action: "write_file", targetPath: "/tmp/out.txt" });
  assert.equal(decision.allowed, false);
});

test("requires approval for write/patch and allows read", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: true,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: false,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: false
  });
  assert.equal(engine.decide({ action: "read_file", targetPath: "/tmp/a" }).allowed, true);
  assert.equal(engine.decide({ action: "write_file", targetPath: "/tmp/a" }).requiresApproval, true);
  assert.equal(engine.decide({ action: "apply_patch", targetPath: "/tmp/a" }).requiresApproval, true);
});

test("terminal execution obeys policy", () => {
  const disabled = new TrustPolicyEngine("/repo", {
    allowTerminal: false,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: false
  });
  assert.equal(disabled.decide({ action: "run_terminal" }).allowed, false);

  const enabled = new TrustPolicyEngine("/repo", {
    allowTerminal: true,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: false
  });
  assert.equal(enabled.decide({ action: "run_terminal" }).allowed, true);
  assert.equal(enabled.decide({ action: "run_terminal" }).requiresApproval, true);
});

test("in-workspace writes require approval when requireApprovalForInWorkspaceWrites is true (package default)", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: false,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: true,
    requireApprovalForTerminal: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: true
  });
  assert.equal(engine.decide({ action: "write_file", targetPath: "/repo/docs/note.md" }).requiresApproval, true);
  assert.equal(engine.decide({ action: "apply_patch", targetPath: "/repo/src/a.ts" }).requiresApproval, true);
});

test("in-workspace writes skip approval only when requireApprovalForInWorkspaceWrites is false", () => {
  const engine = new TrustPolicyEngine("/repo", {
    allowTerminal: false,
    requireApprovalForWrite: true,
    requireApprovalForInWorkspaceWrites: false,
    requireApprovalForTerminal: true,
    requireApprovalForMcp: true,
    requireApprovalForExternal: true,
    restrictToWorkspace: true
  });
  assert.equal(engine.decide({ action: "write_file", targetPath: "/repo/docs/note.md" }).requiresApproval, false);
  assert.equal(engine.decide({ action: "apply_patch", targetPath: "/repo/src/a.ts" }).requiresApproval, false);
});
