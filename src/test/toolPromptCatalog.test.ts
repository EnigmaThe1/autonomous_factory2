import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { getAgentToolInstructionLines } from "../agents/toolPromptCatalog";

type VscodeTestApi = typeof vscode & { __setTestConfig?: (k: string, v: unknown) => void; __clearTestConfig?: () => void };

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("getAgentToolInstructionLines: full catalog includes writeFile and git.status", () => {
  const lines = getAgentToolInstructionLines();
  const blob = lines.join("\n");
  assert.match(blob, /WORKSPACE\/TOOL RULES/);
  assert.match(blob, /GOAL-FIRST/);
  assert.match(blob, /suggestedPaths/);
  assert.match(blob, /writeFile/);
  assert.match(blob, /applyPatch/);
  assert.match(blob, /git\.status/);
  assert.match(blob, /runTerminal/);
  assert.doesNotMatch(blob, /LAZY TOOL CATALOG/);
});

test("getAgentToolInstructionLines: lazy mode is shorter and points at listTools", () => {
  const fullLines = getAgentToolInstructionLines();
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.agents.lazyToolPrompt", true);
  const lazyLines = getAgentToolInstructionLines();
  const blob = lazyLines.join("\n");
  assert.match(blob, /LAZY TOOL CATALOG/);
  assert.match(blob, /listMcpTools/);
  assert.doesNotMatch(blob, /docker\.ps/);
  assert.ok(
    lazyLines.length < fullLines.length,
    `lazy (${lazyLines.length} lines) should be shorter than full (${fullLines.length})`
  );
});

test("getAgentToolInstructionLines: goal-first bullets omitted when disabled", () => {
  const on = getAgentToolInstructionLines().join("\n");
  assert.match(on, /GOAL-FIRST/);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.agents.goalFirstDiscipline", false);
  const off = getAgentToolInstructionLines().join("\n");
  assert.doesNotMatch(off, /GOAL-FIRST \(fixed\)/);
});
