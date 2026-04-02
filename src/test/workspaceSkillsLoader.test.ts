import test from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  loadWorkspaceSkillsForAgents,
  __clearWorkspaceSkillsCacheForTest
} from "../skills/workspaceSkillsLoader";

test("loadWorkspaceSkillsForAgents: empty without workspace folder", async () => {
  __clearWorkspaceSkillsCacheForTest();
  const w = vscode.workspace as unknown as { workspaceFolders: typeof vscode.workspace.workspaceFolders };
  const prev = w.workspaceFolders;
  w.workspaceFolders = undefined;
  try {
    const text = await loadWorkspaceSkillsForAgents();
    assert.equal(text, "");
  } finally {
    w.workspaceFolders = prev;
  }
});
