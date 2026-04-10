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

test("B1: non-implementer runCommand requires explicit approval even if terminal policy would allow", async () => {
  // Make TrustPolicyEngine allow command execution without requiring approval.
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.allowTerminal", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.requireApprovalForTerminal", false);
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

  const mission = await store.create("non-impl-cmd", "p", "ollama");
  await store.enqueue(mission.id, [
    { id: "r0", title: "Review", role: "reviewer", status: "todo", prompt: "x" }
  ]);

  const call: ToolCall = {
    tool: "runCommand",
    args: { command: "echo hi", __workItemId: "r0" }
  };
  const res = await registry.execute(mission.id, call);
  assert.equal(res.ok, false);
  assert.ok(res.requiresApproval, "expected approval requirement");
  assert.match(res.requiresApproval!.title, /non-implementer mutation/i);
});

test("B2: when requireApprovalForNonImplementerMutations is false, reviewer runCommand follows terminal policy only", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.allowTerminal", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.requireApprovalForTerminal", false);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.requireApprovalForNonImplementerMutations", false);
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

  const mission = await store.create("non-impl-cmd-relaxed", "p", "ollama");
  await store.enqueue(mission.id, [
    { id: "r0", title: "Review", role: "reviewer", status: "todo", prompt: "x" }
  ]);

  const call: ToolCall = {
    tool: "runCommand",
    args: { command: "echo hi", __workItemId: "r0" }
  };
  const res = await registry.execute(mission.id, call);
  assert.equal(res.ok, true);
  assert.ok(!res.requiresApproval);
});

test("B3: autoApproveAllToolRequests bypasses non-implementer mutation approval", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.allowTerminal", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.requireApprovalForTerminal", false);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.restrictToWorkspace", false);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.autoApproveAllToolRequests", true);

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

  const mission = await store.create("auto-appr-cmd", "p", "ollama");
  await store.enqueue(mission.id, [
    { id: "r0", title: "Review", role: "reviewer", status: "todo", prompt: "x" }
  ]);

  const call: ToolCall = {
    tool: "runCommand",
    args: { command: "echo hi", __workItemId: "r0" }
  };
  const res = await registry.execute(mission.id, call);
  assert.equal(res.ok, true);
  assert.ok(!res.requiresApproval);
});

