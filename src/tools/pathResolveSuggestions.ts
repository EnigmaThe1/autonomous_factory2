import * as vscode from "vscode";
import * as path from "path";
import type { WorkspaceIndex } from "../memory/WorkspaceIndex";

const DEFAULT_MAX = 12;

/**
 * When readFile targets a missing path, suggest likely workspace-relative paths
 * (exact basename match via findFiles, then case-insensitive basename via index).
 */
export async function suggestWorkspacePathsForMissingFile(
  workspaceRoot: string,
  resolvedMissingPath: string,
  workspaceIndex: WorkspaceIndex | undefined,
  maxResults = DEFAULT_MAX
): Promise<string[]> {
  const base = path.basename(resolvedMissingPath);
  if (!base || base === "." || base === "..") return [];

  const out: string[] = [];
  const add = (rel: string) => {
    const n = rel.replace(/\\/g, "/");
    if (n && !out.includes(n)) out.push(n);
  };

  const folder =
    vscode.workspace.workspaceFolders?.find((f) => path.normalize(f.uri.fsPath) === path.normalize(workspaceRoot)) ??
    vscode.workspace.workspaceFolders?.[0];

  if (folder) {
    try {
      const pattern = new vscode.RelativePattern(folder, `**/${base}`);
      const found = await vscode.workspace.findFiles(pattern, "**/node_modules/**", maxResults);
      for (const u of found) {
        add(vscode.workspace.asRelativePath(u));
        if (out.length >= maxResults) return out;
      }
    } catch {
      /* ignore */
    }
  }

  if (workspaceIndex && out.length < maxResults) {
    try {
      await workspaceIndex.ensureBuilt();
    } catch {
      /* index optional */
    }
    for (const rel of workspaceIndex.findRelativePathsByFilenameCaseInsensitive(base, maxResults)) {
      add(rel);
      if (out.length >= maxResults) break;
    }
  }

  return out.slice(0, maxResults);
}
