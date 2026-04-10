/**
 * Integration: ToolRegistry policy outcomes for workspace vs protected vs outside paths.
 */
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { tmpdir } from "node:os";
import * as vscode from "vscode";
import { MissionStore } from "../missions/MissionStore";
import { SecretStore } from "../storage/SecretStore";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { ToolRegistry } from "../tools/ToolRegistry";
import { ExternalToolAdapterRegistry } from "../tools/ExternalToolAdapterRegistry";
import { McpRegistry } from "../tools/McpRegistry";
import type { ToolCall } from "../types";
import { balancedIntegrationPolicy, memento, type VscodeTestApi } from "./missionOrchestratorTestHarness";

const V = vscode as VscodeTestApi;

let saved: { folders: vscode.WorkspaceFolder[] | undefined; fs: typeof vscode.workspace.fs } | undefined;

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
  saved = { folders: w.workspaceFolders, fs: w.fs };
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
    async readDirectory() {
      return [];
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
  if (!saved) return;
  const w = vscode.workspace as unknown as {
    workspaceFolders: vscode.WorkspaceFolder[] | undefined;
    fs: typeof vscode.workspace.fs;
  };
  w.workspaceFolders = saved.folders;
  w.fs = saved.fs;
  saved = undefined;
}

function buildRegistry(extFs: string): { reg: ToolRegistry; store: MissionStore } {
  const disk = new DiskMissionPersistence(new WorkspacePaths());
  const store = new MissionStore(memento(), memento(), disk);
  const secrets = new SecretStore({
    get: async () => undefined,
    store: async () => {},
    delete: async () => {},
    onDidChange: () => ({ dispose: () => {} })
  } as vscode.SecretStorage);
  const paths = new WorkspacePaths();
  const ctx = {
    extensionUri: vscode.Uri.file(extFs)
  } as vscode.ExtensionContext;
  const reg = new ToolRegistry(ctx, store, disk, new ExternalToolAdapterRegistry(paths), new McpRegistry(paths, disk), secrets);
  return { reg, store };
}

beforeEach(() => {
  V.__clearTestConfig?.();
});

afterEach(() => {
  restoreWorkspace();
  V.__clearTestConfig?.();
});

test("integration: workspace_coder writeFile in workspace does not require approval", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-autonomy-ws-"));
  installWorkspace(root);
  const ext = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-autonomy-ext-"));
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");
  V.__setTestConfig?.("myAi.missions.autonomy.autoApproveWorkspaceWrites", true);

  const { reg, store } = buildRegistry(ext);
  const m = await store.create("A", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "w1", title: "impl", role: "implementer", status: "todo", prompt: "go" }]);

  const target = nodePath.join(root, "plain.txt");
  await nodeFs.writeFile(target, "a", "utf8");
  const call: ToolCall = {
    tool: "writeFile",
    args: { path: "plain.txt", content: "b", __workItemId: "w1" }
  };
  const r = await reg.execute(m.id, call);
  assert.equal(r.ok, true);
  assert.equal(r.requiresApproval, undefined);
  assert.equal((await nodeFs.readFile(target, "utf8")), "b");
});

test("integration: workspace_coder writeFile to .my-ai-extension requires approval", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-autonomy-prot-"));
  await nodeFs.mkdir(nodePath.join(root, ".my-ai-extension"), { recursive: true });
  installWorkspace(root);
  const ext = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-autonomy-ext2-"));
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");
  V.__setTestConfig?.("myAi.missions.autonomy.autoApproveWorkspaceWrites", true);

  const { reg, store } = buildRegistry(ext);
  const m = await store.create("B", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "w1", title: "impl", role: "implementer", status: "todo", prompt: "go" }]);

  const call: ToolCall = {
    tool: "writeFile",
    args: { path: ".my-ai-extension/guarded.txt", content: "x", __workItemId: "w1" }
  };
  const r = await reg.execute(m.id, call);
  assert.equal(r.ok, false);
  assert.ok(r.requiresApproval);
});

test("integration: workspace_coder writeFile outside workspace is denied", async () => {
  const root = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-autonomy-out-"));
  installWorkspace(root);
  const ext = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-autonomy-ext3-"));
  const outside = await nodeFs.mkdtemp(nodePath.join(tmpdir(), "myai-out-abs-"));
  const outsideFile = nodePath.join(outside, "nope.txt");
  await nodeFs.writeFile(outsideFile, "z", "utf8");
  V.__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");

  const { reg, store } = buildRegistry(ext);
  const m = await store.create("C", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "w1", title: "impl", role: "implementer", status: "todo", prompt: "go" }]);

  const call: ToolCall = {
    tool: "writeFile",
    args: { path: outsideFile, content: "hack", __workItemId: "w1" }
  };
  const r = await reg.execute(m.id, call);
  assert.equal(r.ok, false);
  assert.equal(r.blockedByPolicy, true);
});
