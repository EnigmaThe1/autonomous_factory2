import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("ToolRegistry marks denied tool calls as blockedByPolicy", () => {
  const p = path.join(__dirname, "..", "..", "src", "tools", "ToolRegistry.ts");
  const src = fs.readFileSync(p, "utf8");
  assert.match(src, /blockedByPolicy\?: boolean/);
  assert.match(src, /private policyBlocked\(reason: string\): ToolResult/);
  assert.match(src, /run_terminal[\s\S]*if \(!decision\.allowed\) return this\.policyBlocked\(decision\.reason\)/);
});

test("ToolRegistry defaults requireApprovalForInWorkspaceWrites to false (matches package.json workspace_coder)", () => {
  const p = path.join(__dirname, "..", "..", "src", "tools", "ToolRegistry.ts");
  const src = fs.readFileSync(p, "utf8");
  assert.match(
    src,
    /requireApprovalForInWorkspaceWrites:\s*cfg\.get<boolean>\(\s*["']myAi\.tools\.requireApprovalForInWorkspaceWrites["']\s*,\s*false\s*\)/
  );
});

test("MissionOrchestrator blocks mission when tool is policy denied", () => {
  const p = path.join(__dirname, "..", "..", "src", "missions", "orchestrator", "missionOrchestratorWorkItemRunner.ts");
  const src = fs.readFileSync(p, "utf8");
  // Policy-denied handling is routed via the tool outcome classifier.
  assert.match(src, /classifyToolOutcome/);
  assert.match(src, /decision\.category === "policy_denied"/);
  assert.match(src, /Policy blocked mission progress/);
  assert.match(src, /Mission paused: tool call blocked by policy/);
  assert.match(src, /blockReasonCode:\s*"policy_blocked"/);
});
