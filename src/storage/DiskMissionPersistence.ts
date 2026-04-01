import * as vscode from "vscode";
import { MemoryItem, Mission } from "../types";
import { WorkspacePaths } from "./WorkspacePaths";
import { unwrapGlobalMemory, unwrapMcpSessions, unwrapMission, wrapGlobalMemory, wrapMcpSessions, wrapMission } from "./PersistenceCodec";
import { shouldIgnorePersistenceReadError } from "./persistenceLoadIssue";
import { atomicTempFsPath } from "../util";
import { isLikelyFileExistsFilesystemError, isLikelyMissingPathFilesystemError } from "./atomicRenameGuard";

export interface PersistedMcpSessionState {
  name: string;
  status: "disconnected" | "starting" | "ready" | "error";
  lastStartedAt?: number;
  lastError?: string;
  toolCount?: number;
}

export class DiskMissionPersistence {
  private loadIssues: string[] = [];

  constructor(private readonly paths: WorkspacePaths) {}

  getAndClearLoadIssues(): string[] {
    const issues = [...this.loadIssues];
    this.loadIssues = [];
    return issues;
  }

  async ensureFolders(): Promise<void> {
    const dirs = [this.paths.storageRoot(), this.paths.missionsDir(), this.paths.approvalsDir(), this.paths.memoryDir(), this.paths.mcpDir()].filter(Boolean) as vscode.Uri[];
    for (const dir of dirs) {
      try { await vscode.workspace.fs.createDirectory(dir); } catch {}
    }
  }

  async loadAll(): Promise<Mission[]> {
    const dir = this.paths.missionsDir();
    if (!dir) return [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      const missions: Mission[] = [];
      for (const [name, kind] of entries) {
        if (kind !== vscode.FileType.File || !name.endsWith('.json')) continue;
        try {
          const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
          const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
          missions.push(unwrapMission(parsed));
        } catch (err) {
          this.loadIssues.push(`Failed to load mission file ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return missions.sort((a,b)=> b.updatedAt - a.updatedAt);
    } catch (err) {
      this.loadIssues.push(`Failed to read missions directory: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async saveMission(mission: Mission): Promise<void> {
    if (!vscode.workspace.getConfiguration().get<boolean>('myAi.missions.portableJson', true)) return;
    const dir = this.paths.missionsDir();
    if (!dir) return;
    await this.ensureFolders();
    const uri = vscode.Uri.joinPath(dir, `${mission.id}.json`);
    await this.writeJsonAtomic(uri, wrapMission(mission));
  }

  /**
   * Remove mission JSON from disk. This must run even when `portableJson` is off:
   * otherwise stale files remain and `hydrateFromDisk` re-imports deleted missions into global state.
   */
  async deleteMission(missionId: string): Promise<void> {
    const dir = this.paths.missionsDir();
    if (!dir) return;
    const uri = vscode.Uri.joinPath(dir, `${missionId}.json`);
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: false, recursive: false });
    } catch {
      // already gone / not persisted yet
    }
  }

  async loadGlobalMemory(): Promise<MemoryItem[]> {
    const uri = this.paths.globalMemoryFile();
    if (!uri) return [];
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return unwrapGlobalMemory(JSON.parse(Buffer.from(bytes).toString("utf8")));
    } catch (err) {
      if (shouldIgnorePersistenceReadError(err)) return [];
      this.loadIssues.push(`Failed to load global memory: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async saveGlobalMemory(items: MemoryItem[]): Promise<void> {
    const uri = this.paths.globalMemoryFile();
    if (!uri) return;
    await this.ensureFolders();
    await this.writeJsonAtomic(uri, wrapGlobalMemory(items));
  }

  async loadMcpSessionStates(): Promise<PersistedMcpSessionState[]> {
    const uri = this.paths.mcpSessionsFile();
    if (!uri) return [];
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return unwrapMcpSessions(JSON.parse(Buffer.from(bytes).toString("utf8")));
    } catch (err) {
      if (shouldIgnorePersistenceReadError(err)) return [];
      this.loadIssues.push(`Failed to load MCP session state: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async saveMcpSessionStates(items: PersistedMcpSessionState[]): Promise<void> {
    const uri = this.paths.mcpSessionsFile();
    if (!uri) return;
    await this.ensureFolders();
    await this.writeJsonAtomic(uri, wrapMcpSessions(items));
  }

  async writeApprovalPreview(approvalId: string, beforeText: string, afterText: string): Promise<{before: vscode.Uri; after: vscode.Uri} | undefined> {
    const dir = this.paths.approvalsDir();
    if (!dir) return undefined;
    await this.ensureFolders();
    const before = vscode.Uri.joinPath(dir, `${approvalId}.before.txt`);
    const after = vscode.Uri.joinPath(dir, `${approvalId}.after.txt`);
    await vscode.workspace.fs.writeFile(before, Buffer.from(beforeText, 'utf8'));
    await vscode.workspace.fs.writeFile(after, Buffer.from(afterText, 'utf8'));
    return { before, after };
  }

  private async safeUnlinkQuiet(file: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(file);
    } catch {
      /* temp may already be gone or rename consumed it */
    }
  }

  /**
   * Atomic replace: write temp then rename onto final path.
   * Some providers throw when overwrite tries to unlink a destination that does not exist yet;
   * fall back to rename without overwrite, then handle exists races.
   */
  private async renameTempOntoFinal(temp: vscode.Uri, uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.rename(temp, uri, { overwrite: true });
      return;
    } catch (err) {
      if (!isLikelyMissingPathFilesystemError(err)) throw err;
    }
    try {
      await vscode.workspace.fs.rename(temp, uri);
      return;
    } catch (err2) {
      if (isLikelyFileExistsFilesystemError(err2)) {
        await vscode.workspace.fs.rename(temp, uri, { overwrite: true });
        return;
      }
      throw err2;
    }
  }

  private async writeJsonAtomic(uri: vscode.Uri, data: unknown): Promise<void> {
    const payload = Buffer.from(JSON.stringify(data, null, 2), "utf8");
    const maxAttempts = 2;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const temp = vscode.Uri.file(atomicTempFsPath(uri.fsPath));
      try {
        await vscode.workspace.fs.writeFile(temp, payload);
        await this.renameTempOntoFinal(temp, uri);
        return;
      } catch (err) {
        lastErr = err;
        await this.safeUnlinkQuiet(temp);
        const code = (err as { code?: string })?.code;
        const msg = typeof (err as { message?: string })?.message === "string" ? (err as { message: string }).message : "";
        if ((code === "ENOENT" || msg.includes("ENOENT") || isLikelyMissingPathFilesystemError(err)) && attempt < maxAttempts - 1) {
          console.warn("[my-ai] writeJsonAtomic rename/transient FS issue; retrying", { attempt, dest: uri.fsPath });
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
