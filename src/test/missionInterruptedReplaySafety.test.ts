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
import type { ApprovalRequest, ToolCall } from "../types";
import {
  awaitMissionRunLoopIdle,
  balancedIntegrationPolicy,
  memento,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

const TARGET_REL = "replay-safety-target.txt";
const BEFORE = "before\n";
const AFTER_ONCE = "after-once\n";
const AFTER_REPLAY = "after-replay\n";

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
      throw new Error("copy not stubbed for replay E2E");
    },
    isWritableFileSystem() {
      return true;
    },
    async stat(uri) {
      const s = await nodeFs.stat(uri.fsPath);
      return { type: s.isDirectory() ? FT.Directory : FT.File, ctime: 0, mtime: 0, size: Number(s.size) };
    },
    async readFile(uri) {
      return new Uint8Array(await nodeFs.readFile(uri.fsPath));
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
  registry: ToolRegistry;
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
  const registry = new ToolRegistry({} as vscode.ExtensionContext, store, disk, new ExternalToolAdapterRegistry(paths), new McpRegistry(paths, disk));
  const tools: MissionToolExecutor = {
    execute: (missionId: string, call: ToolCall) => registry.execute(missionId, call)
  };
  const orchestrator = new MissionOrchestrator(providers, collector, store, tools, globalMemory, agentRun);
  return { orchestrator, store, registry };
}

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  restoreWorkspaceBridge();
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("resumeMission blocks replay of interrupted mutating writeFile work instead of executing the write twice", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-replay-write-"));
  installRealWorkspaceBridge(root);
  const targetAbs = nodePath.join(root, TARGET_REL);
  await nodeFs.writeFile(targetAbs, BEFORE, "utf8");

  let implementerTurns = 0;
  const agent = roleScript({
    implementer: [
      {
        summary: "Replay would write again.",
        toolCalls: [{ tool: "writeFile", args: { path: TARGET_REL, content: AFTER_REPLAY } }]
      }
    ]
  });
  const countedAgent: MissionAgentRunForTest = async (...args) => {
    if (args[1].role === "implementer") implementerTurns += 1;
    return agent(...args);
  };
  const { orchestrator, store, registry } = await buildOrchestratorWithRealToolRegistry(countedAgent);
  const m = await store.create("Replay-write", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 2,
    requireReviewerBeforeComplete: false,
    requireValidatorBeforeComplete: false
  });

  await registry.execute(m.id, { tool: "writeFile", args: { path: TARGET_REL, content: AFTER_ONCE, __approved: true } });
  await store.updateMission(m.id, {
    status: "queued",
    validationState: "pending",
    queue: [
      { id: "p0", title: "Plan", role: "planner", status: "done", prompt: "p", output: "planned" },
      {
        id: "i0",
        title: "Implement",
        role: "implementer",
        status: "running",
        prompt: "i",
        output: "Tool ran before interruption.",
        activeMutatingToolCall: { tool: "writeFile", target: TARGET_REL, startedAt: Date.now() }
      }
    ]
  });

  await orchestrator.resumeMission(m.id);

  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.equal(fin.queue.find((w) => w.id === "i0")?.status, "blocked");
  assert.equal(implementerTurns, 0);
  assert.equal(await nodeFs.readFile(targetAbs, "utf8"), AFTER_ONCE);
  assert.ok(fin.events.some((e) => e.message.includes("mutating tool may already have executed")));
});

test("resumeMission does not replay approved writeFile execution after interruption once approval is already consumed", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-replay-approved-"));
  installRealWorkspaceBridge(root);
  const targetAbs = nodePath.join(root, TARGET_REL);
  await nodeFs.writeFile(targetAbs, BEFORE, "utf8");

  const { orchestrator, store, registry } = await buildOrchestratorWithRealToolRegistry(roleScript({}));
  const m = await store.create("Replay-approved", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 2,
    requireReviewerBeforeComplete: false,
    requireValidatorBeforeComplete: false
  });
  await registry.execute(m.id, { tool: "writeFile", args: { path: TARGET_REL, content: AFTER_ONCE, __approved: true } });
  const approval: ApprovalRequest = {
    id: "ap1",
    createdAt: Date.now(),
    missionId: m.id,
    kind: "write_file",
    title: "Write file",
    details: "approved",
    toolCall: { tool: "writeFile", args: { path: TARGET_REL, content: AFTER_REPLAY } },
    status: "approved",
    workItemId: "i0"
  };
  await store.updateMission(m.id, {
    status: "queued",
    validationState: "pending",
    approvals: [approval],
    queue: [
      { id: "p0", title: "Plan", role: "planner", status: "done", prompt: "p", output: "planned" },
      {
        id: "i0",
        title: "Implement",
        role: "implementer",
        status: "running",
        prompt: "i",
        output: "Approved execution interrupted after side effect.",
        activeMutatingToolCall: { tool: "writeFile", target: TARGET_REL, approved: true, startedAt: Date.now() }
      }
    ]
  });

  const dup = await orchestrator.resolveApproval(m.id, approval.id, true);
  assert.equal(dup.kind, "noop_unknown_approval");

  await orchestrator.resumeMission(m.id);

  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.equal(fin.queue.find((w) => w.id === "i0")?.status, "blocked");
  assert.equal(await nodeFs.readFile(targetAbs, "utf8"), AFTER_ONCE);
  assert.ok(fin.events.some((e) => e.message.includes("mutating tool may already have executed")));
});

test("safe interrupted non-mutating work still auto-recovers across pass limits and completes autonomously", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const { orchestrator, store } = await buildOrchestratorWithRealToolRegistry(
    roleScript({
      implementer: [{ summary: "Recovered implementer, no tools.", toolCalls: [] }],
      reviewer: [{ summary: "Looks good; ready for validation.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    })
  );
  const m = await store.create("Safe-recover-pass-limit", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 4
  });
  await store.updateMission(m.id, {
    status: "queued",
    validationState: "pending",
    queue: [
      { id: "p0", title: "Plan", role: "planner", status: "done", prompt: "p", output: "planned" },
      { id: "i0", title: "Implement", role: "implementer", status: "running", prompt: "i", output: "interrupted" },
      { id: "r0", title: "Review", role: "reviewer", status: "todo", prompt: "r" },
      { id: "v0", title: "Validate", role: "validator", status: "todo", prompt: "v" }
    ]
  });

  await orchestrator.resumeMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  assert.ok(mid.events.some((e) => e.message.includes("Recovered 1 interrupted running work item")));
  assert.ok(mid.events.some((e) => e.message.includes("maxStepsPerRun")));

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  await orchestrator.resumeMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.ok(mid.queue.every((w) => w.status === "done" || w.status === "skipped"));
});

test("guarded interrupted mutating work blocks mixed-history mission with explicit manual-review blocker and no false resumable state", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-guarded-mixed-"));
  installRealWorkspaceBridge(root);
  const targetAbs = nodePath.join(root, TARGET_REL);
  await nodeFs.writeFile(targetAbs, BEFORE, "utf8");

  const { orchestrator, store, registry } = await buildOrchestratorWithRealToolRegistry(roleScript({}));
  const m = await store.create("Guarded-mixed-history", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 3,
    requireImplementerBeforeComplete: true
  });

  await registry.execute(m.id, { tool: "writeFile", args: { path: TARGET_REL, content: AFTER_ONCE, __approved: true } });
  await store.updateMission(m.id, {
    status: "queued",
    validationState: "pending",
    queue: [
      { id: "p0", title: "Plan", role: "planner", status: "done", prompt: "p", output: "planned" },
      {
        id: "i0",
        title: "Implement",
        role: "implementer",
        status: "running",
        prompt: "i",
        output: "Interrupted after mutating tool.",
        hardStopClass: "unknown_hard_stop",
        activeMutatingToolCall: { tool: "writeFile", target: TARGET_REL, startedAt: Date.now() }
      },
      { id: "r0", title: "Review", role: "reviewer", status: "todo", prompt: "r" },
      { id: "v0", title: "Validate", role: "validator", status: "todo", prompt: "v" }
    ]
  });

  await orchestrator.resumeMission(m.id);

  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.equal(fin.blockReasonCode, "manual_review_required");
  assert.match(fin.blocker || "", /manual review required before retrying interrupted mutating work/i);
  assert.equal(fin.queue.find((w) => w.id === "i0")?.status, "blocked");
  assert.equal(fin.queue.find((w) => w.id === "r0")?.status, "todo");
  assert.equal(fin.queue.find((w) => w.id === "v0")?.status, "todo");
  assert.notEqual(fin.status, "queued");
  assert.notEqual(fin.status, "completed");
  assert.equal(await nodeFs.readFile(targetAbs, "utf8"), AFTER_ONCE);
});
