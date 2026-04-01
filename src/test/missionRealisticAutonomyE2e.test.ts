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
import { uid } from "../util";
import type { AgentRole, AgentTurnResult, ToolCall } from "../types";
import {
  awaitMissionRunLoopIdle,
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  memento,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

const TARGET_REL = "realistic-autonomy.txt";
const BEFORE = "before\n";
const AFTER = "after\n";

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
      throw new Error("copy not stubbed for realistic autonomy E2E");
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
  return { orchestrator, store };
}

function scriptedAgent(turns: Partial<Record<AgentRole, AgentTurnResult[]>>): MissionAgentRunForTest {
  const idx: Partial<Record<AgentRole, number>> = {};
  return async (_mission, item) => {
    const list = turns[item.role];
    const i = idx[item.role] ?? 0;
    idx[item.role] = i + 1;
    if (!list || i >= list.length) {
      throw new Error(`missionRealisticAutonomyE2e: missing ${item.role}[${i}]`);
    }
    return list[i]!;
  };
}

function scriptedAgentWithOperatorAbort(
  getOrchestrator: () => MissionOrchestrator,
  turns: Partial<Record<AgentRole, Array<AgentTurnResult | "abort_operator">>>
): MissionAgentRunForTest {
  const idx: Partial<Record<AgentRole, number>> = {};
  return async (mission, item, _context, opts) => {
    const list = turns[item.role];
    const i = idx[item.role] ?? 0;
    idx[item.role] = i + 1;
    if (!list || i >= list.length) {
      throw new Error(`missionRealisticAutonomyE2e abort script: missing ${item.role}[${i}]`);
    }
    const step = list[i]!;
    if (step === "abort_operator") {
      queueMicrotask(() => {
        getOrchestrator().abortMissionWork(mission.id, "operator");
      });
      if (!opts.signal) throw new DOMException("Aborted", "AbortError");
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      await new Promise<void>((_, reject) => {
        opts.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      throw new Error("unreachable");
    }
    return step;
  };
}

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  restoreWorkspaceBridge();
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("realistic autonomy: real approval-gated write crosses pass limits and completes truthfully", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-realistic-approval-"));
  installRealWorkspaceBridge(root);
  await nodeFs.writeFile(nodePath.join(root, TARGET_REL), BEFORE, "utf8");

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const { orchestrator, store } = await buildOrchestratorWithRealToolRegistry(
    scriptedAgent({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "Write bounded change.", toolCalls: [{ tool: "writeFile", args: { path: TARGET_REL, content: AFTER } }] }],
      reviewer: [{ summary: "Looks good; ready for validation.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    })
  );
  const m = await store.create("Realistic-approval", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  assert.ok(mid.queue.some((w) => w.role === "implementer" && w.status === "todo"));

  await orchestrator.resumeMission(m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.equal(mid.approvals.filter((a) => a.status === "pending").length, 1);
  assert.notEqual(mid.status, "completed");

  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  await orchestrator.resolveApproval(m.id, pending!.id, true);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  assert.notEqual(mid.validationState, "passed");
  assert.ok(mid.queue.some((w) => (w.role === "reviewer" || w.role === "validator") && w.status === "todo"));
  assert.equal(await nodeFs.readFile(nodePath.join(root, TARGET_REL), "utf8"), AFTER);

  let passes = 0;
  while (mid.status !== "completed" && passes < 8) {
    await orchestrator.resumeMission(m.id);
    await awaitMissionRunLoopIdle(orchestrator, m.id);
    mid = store.get(m.id)!;
    passes += 1;
  }
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.ok(mid.queue.every((w) => w.status === "done" || w.status === "skipped"));
});

test("realistic autonomy: mixed-history approval plus operator abort resumes to truthful completion", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-realistic-mixed-"));
  installRealWorkspaceBridge(root);
  await nodeFs.writeFile(nodePath.join(root, TARGET_REL), BEFORE, "utf8");

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const ref: { orchestrator?: MissionOrchestrator } = {};
  const { orchestrator, store } = await buildOrchestratorWithRealToolRegistry(
    scriptedAgentWithOperatorAbort(
      () => ref.orchestrator!,
      {
        planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
        implementer: [{ summary: "Write bounded change.", toolCalls: [{ tool: "writeFile", args: { path: TARGET_REL, content: AFTER } }] }],
        reviewer: ["abort_operator", { summary: "Looks good; ready for validation.", toolCalls: [] }],
        validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
      }
    )
  );
  ref.orchestrator = orchestrator;

  const m = await store.create("Realistic-mixed", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  await orchestrator.resumeMission(m.id);
  let mid = store.get(m.id)!;
  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);

  await orchestrator.resolveApproval(m.id, pending!.id, true);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.ok(mid.blocker?.includes("operator abort") || mid.queue.some((w) => w.output?.includes("operator abort")));
  assert.ok(mid.approvals.some((a) => a.status === "approved"));
  assert.notEqual(mid.status, "completed");

  let passes = 0;
  while (mid.status !== "completed" && passes < 8) {
    await orchestrator.resumeMission(m.id);
    await awaitMissionRunLoopIdle(orchestrator, m.id);
    mid = store.get(m.id)!;
    if (mid.status !== "completed" && mid.status !== "blocked" && mid.status !== "queued") {
      throw new Error(`unexpected status ${mid.status}`);
    }
    passes += 1;
  }
  if (mid.status !== "completed") {
    await orchestrator.runMission(m.id);
    await awaitMissionRunLoopIdle(orchestrator, m.id);
    mid = store.get(m.id)!;
  }
  assert.equal(mid.status, "completed");
  assert.equal(mid.validationState, "passed");
  assert.equal(await nodeFs.readFile(nodePath.join(root, TARGET_REL), "utf8"), AFTER);
});

test("realistic autonomy: no-progress replan loop stops honestly at maxAutoRounds rather than simulating completion", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  const { orchestrator, store } = await buildOrchestratorWithRealToolRegistry(
    scriptedAgent({
      planner: Array.from({ length: 8 }, () => ({ summary: "Replan only.", nextWorkItems: [] }))
    })
  );
  const m = await store.create("Realistic-no-progress", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    maxAutoRounds: 4,
    minCompletedWorkItems: 4
  });
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "blocked");
  assert.equal(fin.blockReasonCode, "max_auto_rounds");
  assert.notEqual(fin.status, "completed");
  assert.equal(fin.validationState, "failed");
  assert.match(fin.blocker || "", /maxAutoRounds/i);
  assert.ok(fin.queue.some((w) => w.role === "planner"));
});
