import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ExternalToolAdapterRegistry } from "../tools/ExternalToolAdapterRegistry";
import { McpRegistry } from "../tools/McpRegistry";
import { MissionStore } from "../missions/MissionStore";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { SecretStore } from "../storage/SecretStore";
import type { ToolCall } from "../types";
import { memento, type VscodeTestApi } from "./missionOrchestratorTestHarness";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("B1: webSearch requires approval when called by non-researcher role", async () => {
  // Enable webResearch so we get to the role gate.
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.enabled", true);
  // Make HTTP policy not require approval so the role envelope is the deciding factor.
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.requireApprovalForHttp", false);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.restrictToWorkspace", false);

  const globalState = memento();
  const workspaceState = memento();
  const disk = new DiskMissionPersistence(new WorkspacePaths());
  const store = new MissionStore(globalState, workspaceState, disk);
  const secretStore = new SecretStore({} as unknown as vscode.SecretStorage);
  const paths = new WorkspacePaths();
  const registry = new ToolRegistry(
    {} as vscode.ExtensionContext,
    store,
    disk,
    new ExternalToolAdapterRegistry(paths),
    new McpRegistry(paths, disk),
    secretStore
  );

  const mission = await store.create("web-role", "p", "ollama");
  await store.enqueue(mission.id, [
    { id: "rev0", title: "Review", role: "reviewer", status: "todo", prompt: "x" }
  ]);

  const call: ToolCall = {
    tool: "webSearch",
    args: { query: "TypeScript URL parser", __workItemId: "rev0" }
  };
  const res = await registry.execute(mission.id, call);
  assert.equal(res.ok, false);
  assert.ok(res.requiresApproval, "expected approval requirement");
  assert.match(res.requiresApproval!.title, /non-researcher|non-implementer|mutation/i);
});

test("webSearch: respects global HTTP approval when skipHttpApproval is false", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.enabled", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.requireApprovalForHttp", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.skipHttpApproval", false);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.restrictToWorkspace", false);

  const globalState = memento();
  const workspaceState = memento();
  const disk = new DiskMissionPersistence(new WorkspacePaths());
  const store = new MissionStore(globalState, workspaceState, disk);
  const secretStore = new SecretStore({} as unknown as vscode.SecretStorage);
  const paths = new WorkspacePaths();
  const registry = new ToolRegistry(
    {} as vscode.ExtensionContext,
    store,
    disk,
    new ExternalToolAdapterRegistry(paths),
    new McpRegistry(paths, disk),
    secretStore
  );

  const mission = await store.create("web-http-strict", "p", "ollama");
  await store.enqueue(mission.id, [
    { id: "res2", title: "Research", role: "researcher", status: "todo", prompt: "x" }
  ]);

  const call: ToolCall = {
    tool: "webSearch",
    args: { query: "example query for strict http policy", __workItemId: "res2" }
  };
  const res = await registry.execute(mission.id, call);
  assert.equal(res.ok, false);
  assert.ok(res.requiresApproval);
});

