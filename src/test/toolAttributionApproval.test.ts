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

test("ToolRegistry: unattributed mutating tool call requires approval (workItemId missing)", async () => {
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

  const mission = await store.create("attrib", "p", "ollama");

  const call: ToolCall = { tool: "writeFile", args: { path: "x.txt", content: "y" } };
  const result = await registry.execute(mission.id, call);

  assert.equal(result.ok, false);
  assert.ok(result.requiresApproval, "expected requiresApproval");
  assert.equal(result.requiresApproval!.title, "Unattributed mutating tool call (missing workItemId)");
});

