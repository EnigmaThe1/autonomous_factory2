/**
 * End-to-end regression: real ToolRegistry.writeFile + MissionOrchestrator under default
 * in-workspace approval policy (no mock toolResult.requiresApproval injection).
 *
 * Historical counterfactual (fix 9791601): parent commit 5652877 reintroduces the bug
 * (ToolRegistry defaulted requireApprovalForInWorkspaceWrites to false). Automated proof:
 * `npm run test:approval-e2e-counterfactual` (clean tree) — expect fail on pre-fix, pass after
 * restore. Manual: `git checkout 5652877`, materialize `main:src/test/missionToolRegistryWriteApprovalE2e.test.ts`,
 * `npm run compile`, run this test — expect `completed` vs `awaiting_input` failure.
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
import type { ToolCall } from "../types";
import {
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  memento,
  roleScript,
  awaitMissionRunLoopIdle,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

const TARGET_REL = "approval-e2e-target.txt";
const LINE_BEFORE = "line-before-approval\n";
const LINE_AFTER_APPROVE = "line-after-approved-write\n";

type WorkspacePatch = {
  folders: typeof vscode.workspace.workspaceFolders;
  fs: typeof vscode.workspace.fs;
  uriJoinPath: unknown;
  fileType: unknown;
};

let saved: WorkspacePatch | undefined;

function patchUriJoinPath(): void {
  const U = vscode.Uri as unknown as { joinPath?: (base: vscode.Uri, ...ps: string[]) => vscode.Uri };
  if (U.joinPath) return;
  U.joinPath = (base, ...ps) => vscode.Uri.file(nodePath.join(base.fsPath, ...ps));
}

function installRealWorkspaceBridge(workspaceRoot: string): void {
  patchUriJoinPath();
  const w = vscode.workspace as unknown as {
    workspaceFolders: typeof vscode.workspace.workspaceFolders;
    fs: typeof vscode.workspace.fs;
  };
  saved = {
    folders: w.workspaceFolders,
    fs: w.fs,
    uriJoinPath: (vscode.Uri as unknown as { joinPath?: unknown }).joinPath,
    fileType: (vscode as unknown as { FileType?: unknown }).FileType
  };
  const FT = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  (vscode as unknown as { FileType: typeof FT }).FileType = FT;
  w.workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot), name: "e2e", index: 0 } as vscode.WorkspaceFolder];
  w.fs = {
    async copy() {
      throw new Error("copy not stubbed for E2E");
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

function restoreWorkspaceBridge(): void {
  if (!saved) return;
  const w = vscode.workspace as unknown as { workspaceFolders: typeof vscode.workspace.workspaceFolders; fs: unknown };
  w.workspaceFolders = saved.folders;
  w.fs = saved.fs;
  const U = vscode.Uri as unknown as { joinPath?: unknown };
  if (saved.uriJoinPath === undefined) delete U.joinPath;
  else U.joinPath = saved.uriJoinPath as typeof U.joinPath;
  if (saved.fileType === undefined) delete (vscode as unknown as { FileType?: unknown }).FileType;
  else (vscode as unknown as { FileType: unknown }).FileType = saved.fileType;
  saved = undefined;
}

async function buildOrchestratorWithRealToolRegistry(agentRun: MissionAgentRunForTest): Promise<{
  orchestrator: MissionOrchestrator;
  store: MissionStore;
}> {
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
  const registry = new ToolRegistry({} as vscode.ExtensionContext, store, disk, new ExternalToolAdapterRegistry(paths), new McpRegistry(paths, disk), secretStore);
  const tools: MissionToolExecutor = {
    execute: (missionId: string, call: ToolCall) => registry.execute(missionId, call)
  };
  const orchestrator = new MissionOrchestrator(providers, collector, store, tools, globalMemory, agentRun);
  return { orchestrator, store };
}

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  restoreWorkspaceBridge();
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("E2E ToolRegistry+orchestrator: in-workspace writeFile creates pending approval; approve writes file; mission completes", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 48);
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-approval-approve-"));
  installRealWorkspaceBridge(root);
  const targetAbs = nodePath.join(root, TARGET_REL);
  await nodeFs.writeFile(targetAbs, LINE_BEFORE, "utf8");

  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Write with real registry.",
        toolCalls: [{ tool: "writeFile", args: { path: TARGET_REL, content: LINE_AFTER_APPROVE } }]
      }
    ],
    reviewer: [{ summary: "LGTM", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await buildOrchestratorWithRealToolRegistry(agent);
  const m = await store.create("E2E-approve", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.notEqual(mid.status, "completed");
  assert.equal(mid.approvals.filter((a) => a.status === "pending").length, 1);
  assert.equal((await nodeFs.readFile(targetAbs, "utf8")), LINE_BEFORE);

  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  assert.equal(pending!.toolCall.tool, "writeFile");

  await orchestrator.resolveApproval(m.id, pending!.id, true);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "completed");
  assert.equal((await nodeFs.readFile(targetAbs, "utf8")), LINE_AFTER_APPROVE);
});

test("E2E ToolRegistry+orchestrator: reject leaves file unchanged and mission blocked", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 48);
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-approval-reject-"));
  installRealWorkspaceBridge(root);
  const targetAbs = nodePath.join(root, TARGET_REL);
  await nodeFs.writeFile(targetAbs, LINE_BEFORE, "utf8");

  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Write with real registry.",
        toolCalls: [{ tool: "writeFile", args: { path: TARGET_REL, content: LINE_AFTER_APPROVE } }]
      }
    ],
    reviewer: [{ summary: "LGTM", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await buildOrchestratorWithRealToolRegistry(agent);
  const m = await store.create("E2E-reject", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.equal(mid.approvals.filter((a) => a.status === "pending").length, 1);
  assert.equal((await nodeFs.readFile(targetAbs, "utf8")), LINE_BEFORE);

  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);

  await orchestrator.resolveApproval(m.id, pending!.id, false, "no");
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.equal(mid.blockReasonCode, "approval_rejected");
  assert.notEqual(mid.status, "completed");
  assert.equal((await nodeFs.readFile(targetAbs, "utf8")), LINE_BEFORE);
});
