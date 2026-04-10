import * as vscode from "vscode";
import { normalizeWorkspaceRelPath } from "./missionReviewReadScope";

/** Returns workspace-relative paths that are missing on disk (or invalid). */
export async function findMissingExpectedDeliverablePaths(relPaths: string[]): Promise<string[]> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const missing: string[] = [];
  for (const raw of relPaths) {
    const n = normalizeWorkspaceRelPath(raw);
    if (!n) {
      missing.push(String(raw));
      continue;
    }
    if (!root) {
      missing.push(n);
      continue;
    }
    const uri = vscode.Uri.joinPath(root, n);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      missing.push(n);
    }
  }
  return missing;
}
