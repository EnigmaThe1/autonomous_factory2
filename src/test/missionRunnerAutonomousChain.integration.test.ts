/**
 * Phase 5: autonomous runMission pass chaining after maxStepsPerRun, and mission status vs
 * workspace vs protected-path writes under workspace_coder.
 */
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { tmpdir } from "node:os";
import * as vscode from "vscode";
import { ContextCollector } from "../context/ContextCollector";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import { MissionOrchestrator, type MissionAgentRunForTest, type MissionToolExecutor } from "../missions/MissionOrchestrator";
import { MissionStore } from "../missions/MissionStore";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { SecretStore } from "../storage/SecretStore";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ExternalToolAdapterRegistry } from "../tools/ExternalToolAdapterRegistry";
import { McpRegistry } from "../tools/McpRegistry";
import type { MissionPolicy, ToolCall } from "../types";
import { uid } from "../util";
import {
  awaitMissionRunLoopIdle,
  awaitMissionTerminalLifecycleStatus,
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  createOrchestrator,
  memento,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

const V = vscode as VscodeTestApi;

const looseCompletionPolicy: MissionPolicy = {
  minCompletedWorkItems: 0,
  maxAutoRounds: 48,
  closureRequired: false,
  requireReviewerBeforeComplete: false,
  requireValidatorBeforeComplete: false,
  requireImplementerBeforeComplete: false,
  autoContinue: true,
  stallReplanThreshold: 3,
  policyPreset: "custom",
  requireValidationEvidence: false
};

let savedWs: { folders: vscode.WorkspaceFolder[] | undefined; fs: typeof vscode.workspace.fs } | undefined;

function patchUriJoinPath(): void {
  const U = vscode.Uri as unknown as { joinPath?: (base: vscode.Uri, ...ps: string[]) => vscode.Uri };
  if (U.joinPath) return;
  U.joinPath = (base, ...ps) => vscode.Uri.file(nodePath.join(base.fsPath, ...ps));
}

function installWorkspace(root: string): void {
  patchUriJoinPath();
  const w = vscode.workspace as unknown as {
    workspaceFolders: vscode.WorkspaceFolder[] | undefined;
    fs: typeof vscode.workspace.fs;
  };
  savedWs = { folders: w.workspaceFolders, fs: w.fs };
  const FT = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  (vscode as unknown as { FileType: typeof FT }).FileType = FT;
  w.workspaceFolders = [{ uri: vscode.Uri.file(root), name: "t", index: 0 } as vscode.WorkspaceFolder];
  w.fs = {
    async copy() {
      throw new Error("unstubbed");
    },
    isWritableFileSystem() {
      return true;
    },
    async stat(uri) {
      const s = await nodeFs.stat(uri.fsPath);
      return {
        type: s.isDirectory() ? FT.Directory : FT.File,
        ctime: 0,
        mtime: 0,
        size: Number(s.size)
      };
    },
    async readFile(uri) {
      const buf = await nodeFs.readFile(uri.fsPath);
      return new Uint8Array(buf);
    },
    async writeFile(uri, content) {
      await nodeFs.mkdir(nodePath.dirname(uri.fsPath), { recursive: true });
      await nodeFs.writeFile(uri.fsPath, Buffer.from(content));
    },
    async delete(uri, options) {
      await nodeFs.rm(uri.fsPath, { recursive: Boolean(options?.recursive), force: true });
    },
    async createDirectory(uri) {
      await nodeFs.mkdir(uri.fsPath, { recursive: true });
    },
    async readDirectory(uri) {
      const ents = await nodeFs.readdir(uri.fsPath, { withFileTypes: true });
      return ents.map((e) => [e.name, e.isDirectory() ? FT.Directory : FT.File] as [string, number]);
    },
    async rename(source, target, options) {
      await nodeFs.mkdir(nodePath.dirname(target.fsPath), { recursive: true });
      try {
        await nodeFs.rename(source.fsPath, target.fsPath);
      } catch (e) {
        if (options?.overwrite) {
          await nodeFs.rm(target.fsPath, { force: true });
          await nodeFs.rename(source.fsPath, target.fsPath);
        } else throw e;
      }
    }
  };
}

function restoreWorkspace(): void {
  if (!savedWs) return;
  const w = vscode.workspace as unknown as {
    workspaceFolders: vscode.WorkspaceFolder[] | undefined;
    fs: typeof vscode.workspace.fs;
  };
  w.workspaceFolders = savedWs.folders;
  w.fs = savedWs.fs;
  savedWs = undefined;
}

async function buildOrchestratorWithRegistry(
  agentRun: MissionAgentRunForTest,
  extensionRoot: string
): Promise<{ orchestrator: MissionOrchestrator; store: MissionStore }> {
  const globalState = memento();
  const workspaceState = memento();
  const disk = new DiskMissionPersistence(new WorkspacePaths());
  const store = new MissionStore(globalState, workspaceState, disk);
  const globalMemory = new GlobalMemoryStore(globalState, disk);
  const secrets = new Map<string, string>();
  const secretStore = new SecretStore({
    get: async (k: string) => secrets.get(k),
    store: async (k: string, v: string) => {
      secrets.set(k, v);
    },
    delete: async (k: string) => {
      secrets.delete(k);
    }
  } as unknown as vscode.SecretStorage);
  const providers = new ProviderRegistry(secretStore);
  const collector = new ContextCollector();
  const paths = new WorkspacePaths();
  const ctx = { extensionUri: vscode.Uri.file(extensionRoot) } as vscode.ExtensionContext;
  const registry = new ToolRegistry(
    ctx,
    store,
    disk,
    new ExternalToolAdapterRegistry(paths),
    new McpRegistry(paths, disk),
    secretStore
  );
  const tools: MissionToolExecutor = {
    execute: (missionId: string, call: ToolCall) => registry.execute(missionId, call)
  };
  const orchestrator = new MissionOrchestrator(providers, collector, store, tools, globalMemory, agentRun);
  return { orchestrator, store };
}

beforeEach(() => {
  V.__clearTestConfig?.();
});

afterEach(() => {
  restoreWorkspace();
  V.__clearTestConfig?.();
});

test("integration: maxStepsPerRun exit auto-chains passes in workspace_coder until mission completes", async () => {
  V.__setTestConfig?.("myAi.missions.maxStepsPerRun", 2);
  V.__setTestConfig?.("myAi.missions.unlimitedStepsPerRun", false);
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");
  V.__setTestConfig?.("myAi.missions.autonomy.maxAutonomousStepCapChains", 32);
  /** No planner row; avoid extra role-injection from planner-contract paths in this harness. */
  V.__setTestConfig?.("myAi.missions.requirePlannerCoverage", false);

  const agent = roleScript({
    implementer: [
      { summary: "i1", toolCalls: [] },
      { summary: "i2", toolCalls: [] },
      { summary: "i3", toolCalls: [] },
      { summary: "i4", toolCalls: [] },
      { summary: "i5", toolCalls: [] }
    ],
    /** Runner enqueues one "Review latest implementation" while validationState is not yet passed. */
    reviewer: [{ summary: "LGTM", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("chain-steps", "p", "ollama", undefined, looseCompletionPolicy);
  await store.enqueue(m.id, [
    { id: "w1", title: "1", role: "implementer", status: "todo", prompt: "a" },
    { id: "w2", title: "2", role: "implementer", status: "todo", prompt: "b" },
    { id: "w3", title: "3", role: "implementer", status: "todo", prompt: "c" },
    { id: "w4", title: "4", role: "implementer", status: "todo", prompt: "d" },
    { id: "w5", title: "5", role: "implementer", status: "todo", prompt: "e" },
    /** Pre-queued so post-implementer hook does not inject a second reviewer row (would exhaust the harness script). */
    {
      id: "rev-pre",
      title: "Review latest implementation",
      role: "reviewer",
      status: "todo",
      prompt: "Review."
    }
  ]);

  await orchestrator.runMission(m.id);
  await awaitMissionTerminalLifecycleStatus(orchestrator, m.id, 60_000);

  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.ok(fin.queue.every((w) => w.status === "done"));
});

test("integration: autoContinuePasses false does not chain after maxStepsPerRun (mission stays queued)", async () => {
  V.__setTestConfig?.("myAi.missions.maxStepsPerRun", 2);
  V.__setTestConfig?.("myAi.missions.unlimitedStepsPerRun", false);
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");
  V.__setTestConfig?.("myAi.missions.autonomy.autoContinuePasses", false);
  V.__setTestConfig?.("myAi.missions.autonomy.maxAutonomousStepCapChains", 32);
  V.__setTestConfig?.("myAi.missions.requirePlannerCoverage", false);

  const agent = roleScript({
    implementer: [
      { summary: "i1", toolCalls: [] },
      { summary: "i2", toolCalls: [] },
      { summary: "i3", toolCalls: [] }
    ],
    reviewer: [{ summary: "LGTM", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "noop" }));
  const m = await store.create("no-chain-steps", "p", "ollama", undefined, looseCompletionPolicy);
  await store.enqueue(m.id, [
    { id: "w1", title: "1", role: "implementer", status: "todo", prompt: "a" },
    { id: "w2", title: "2", role: "implementer", status: "todo", prompt: "b" },
    { id: "w3", title: "3", role: "implementer", status: "todo", prompt: "c" },
    {
      id: "rev-pre",
      title: "Review latest implementation",
      role: "reviewer",
      status: "todo",
      prompt: "Review."
    }
  ]);

  await orchestrator.runMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);

  const mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  assert.ok(mid.queue.some((w) => w.status === "todo" || w.status === "in_progress"));
});

test("integration: workspace_coder ordinary workspace writeFile completes without awaiting_input", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-runner-ws-"));
  const ext = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-runner-ext-"));
  installWorkspace(root);
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");
  V.__setTestConfig?.("myAi.missions.autonomy.autoApproveWorkspaceWrites", true);
  V.__setTestConfig?.("myAi.missions.maxStepsPerRun", 48);

  const targetRel = "plain-runner.txt";
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Write workspace file.",
        toolCalls: [{ tool: "writeFile", args: { path: targetRel, content: "ok" } }]
      }
    ],
    reviewer: [{ summary: "LGTM", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await buildOrchestratorWithRegistry(agent, ext);
  const m = await store.create("runner-ws-write", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);

  const mid = store.get(m.id)!;
  assert.notEqual(mid.status, "awaiting_input");
  assert.equal(mid.status, "completed");
  assert.equal((await nodeFs.readFile(nodePath.join(root, targetRel), "utf8")), "ok");
});

test("integration: workspace_coder protected-path writeFile pauses mission in awaiting_input", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-runner-prot-"));
  await nodeFs.mkdir(nodePath.join(root, ".my-ai-extension"), { recursive: true });
  const ext = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-runner-ext2-"));
  installWorkspace(root);
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");
  V.__setTestConfig?.("myAi.missions.autonomy.autoApproveWorkspaceWrites", true);
  V.__setTestConfig?.("myAi.missions.maxStepsPerRun", 48);

  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Write protected path.",
        toolCalls: [{ tool: "writeFile", args: { path: ".my-ai-extension/guard-runner.txt", content: "x" } }]
      }
    ],
    reviewer: [{ summary: "LGTM", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await buildOrchestratorWithRegistry(agent, ext);
  const m = await store.create("runner-prot-write", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);

  const mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.ok(mid.approvals.some((a) => a.status === "pending"));
});
