import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { MissionBlueprint } from "../missions/missionBlueprintTypes";
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

function buildRegistry() {
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
  return { registry, store };
}

test("B1: hard-blocks sensitive path (.git) before normal write approvals", async () => {
  const { registry, store } = buildRegistry();
  const m = await store.create("scope-hard-block", "p", "ollama");
  await store.enqueue(m.id, [
    { id: "i0", title: "Implement", role: "implementer", status: "todo", prompt: "x" }
  ]);

  const call: ToolCall = {
    tool: "writeFile",
    args: { path: ".git/config", content: "no", __workItemId: "i0" }
  };
  const res = await registry.execute(m.id, call);
  assert.equal(res.ok, false);
  assert.equal(res.blockedByPolicy, true);
  assert.match(res.summary, /sensitive path blocked/i);
});

test("B1: blueprint step-local drift forces explicit scope approval (even before tool approval)", async () => {
  const { registry, store } = buildRegistry();
  const bp: MissionBlueprint = {
    version: 1,
    createdAt: Date.now(),
    approvedAt: Date.now(),
    status: "approved",
    requirementsSummary: "Build a web server",
    architectureSummary: "Use TypeScript",
    steps: [
      {
        id: "step_1",
        title: "Implement server",
        summary: "Create server module",
        roleHint: "implementer",
        acceptanceCriteria: ["Server starts"],
        status: "pending"
      }
    ],
    amendments: []
  };
  const m = await store.create("scope-drift", "p", "ollama");
  await store.updateMission(m.id, { blueprint: bp });
  await store.enqueue(m.id, [
    { id: "i0", title: "Implement server", role: "implementer", status: "todo", prompt: "x", blueprintStepId: "step_1" }
  ]);

  const call: ToolCall = {
    tool: "writeFile",
    args: { path: "unrelated/finance.csv", content: "x", __workItemId: "i0", __blueprintStepId: "step_1" }
  };
  const res = await registry.execute(m.id, call);
  assert.equal(res.ok, false);
  assert.ok(res.requiresApproval, "expected requiresApproval for scope drift");
  assert.match(res.requiresApproval!.title, /scope drift/i);
});

