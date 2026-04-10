import * as path from "path";
import * as vscode from "vscode";

export interface RecoverySpineDecision {
  protected: boolean;
  reason?: string;
  /** Workspace-relative normalized path for display. */
  rel?: string;
}

function normalizeFsPath(p: string): string {
  return path.normalize(p).replace(/\\/g, "/");
}

function workspaceRelPath(absPath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, absPath);
  return normalizeFsPath(rel);
}

function readProtectedPatterns(): string[] {
  const cfg = vscode.workspace.getConfiguration();
  const raw = cfg.get<unknown>("myAi.recoverySpine.protectedPaths", [
    ".my-ai-extension/**",
    ".vscode/settings.json",
    ".vscode/extensions.json",
    ".vscode/tasks.json"
  ]);
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter((s) => s.trim().length > 0);
  return [];
}

/**
 * Determines whether a target path is part of the protected recovery spine.
 *
 * Important: this is intentionally conservative — it protects the canonical persistence folder
 * and common VS Code workspace settings files. Operators can extend/override via configuration.
 */
export function classifyRecoverySpineTarget(resolvedPath: string): RecoverySpineDecision {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return { protected: false };
  const abs = normalizeFsPath(resolvedPath);
  const rootNorm = normalizeFsPath(root);
  if (!abs.startsWith(rootNorm)) {
    /** Outside the opened workspace: not a recovery-spine target; file policy (autonomy / restrictToWorkspace) denies separately. */
    return { protected: false, rel: abs };
  }
  const rel = workspaceRelPath(abs, rootNorm);
  // Always protect the persistence root configured by WorkspacePaths default.
  if (rel === ".my-ai-extension" || rel.startsWith(".my-ai-extension/")) {
    return { protected: true, reason: "Target is under .my-ai-extension (mission persistence recovery spine).", rel };
  }
  // Protect patterns configured by operator (simple glob-ish support for /** suffix).
  for (const patRaw of readProtectedPatterns()) {
    const pat = normalizeFsPath(patRaw.trim().replace(/^\.\//, ""));
    if (!pat) continue;
    if (pat.endsWith("/**")) {
      const prefix = pat.slice(0, -3);
      if (rel === prefix || rel.startsWith(prefix + "/")) {
        return { protected: true, reason: `Target is under protected recovery spine prefix ${patRaw}.`, rel };
      }
      continue;
    }
    if (rel === pat) {
      return { protected: true, reason: `Target matches protected recovery spine path ${patRaw}.`, rel };
    }
  }
  return { protected: false, rel };
}

