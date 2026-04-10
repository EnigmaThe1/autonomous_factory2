import * as vscode from "vscode";
import { runCommand, CommandRunnerResult } from "./CommandRunner";
import { trimText } from "../util";

export interface GitToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function git(args: string, timeoutMs = 10_000): Promise<CommandRunnerResult> {
  const cwd = workspaceRoot();
  if (!cwd) return { exitCode: 1, stdout: "", stderr: "No workspace open", timedOut: false, durationMs: 0 };
  return runCommand({ command: `git ${args}`, cwd, timeoutMs });
}

export async function gitStatus(): Promise<GitToolResult> {
  const r = await git("status --porcelain=v2 --branch");
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "git status failed" };

  const lines = r.stdout.trim().split("\n");
  let branch = "";
  const changed: string[] = [];
  for (const line of lines) {
    if (line.startsWith("# branch.head ")) branch = line.replace("# branch.head ", "");
    else if (line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u ") || line.startsWith("? ")) {
      const parts = line.split("\t");
      const file = parts[parts.length - 1] || line.split(" ").pop() || line;
      changed.push(file);
    }
  }

  return {
    ok: true,
    summary: `Branch: ${branch}, ${changed.length} changed file(s)`,
    data: { branch, changedFiles: changed, raw: trimText(r.stdout, 4000) }
  };
}

export async function gitDiff(opts?: { staged?: boolean; path?: string }): Promise<GitToolResult> {
  const args = ["diff"];
  if (opts?.staged) args.push("--cached");
  if (opts?.path) args.push("--", opts.path);
  const r = await git(args.join(" "), 15_000);
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "git diff failed" };
  return { ok: true, summary: `Diff: ${r.stdout.split("\n").length} lines`, data: trimText(r.stdout, 8000) };
}

export async function gitLog(count = 20): Promise<GitToolResult> {
  const r = await git(`log --oneline -${Math.min(count, 100)}`);
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "git log failed" };
  return { ok: true, summary: `${r.stdout.trim().split("\n").length} commits`, data: r.stdout.trim() };
}

export async function gitBlame(path: string, startLine?: number, endLine?: number): Promise<GitToolResult> {
  const lineArg = startLine && endLine ? `-L ${startLine},${endLine}` : "";
  const r = await git(`blame ${lineArg} -- "${path}"`);
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "git blame failed" };
  return { ok: true, summary: `Blame for ${path}`, data: trimText(r.stdout, 6000) };
}

export async function gitStashPush(message?: string): Promise<GitToolResult> {
  const msg = message ? `"${message.replace(/"/g, '\\"')}"` : '"auto-stash"';
  const r = await git(`stash push -m ${msg}`);
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "git stash push failed" };
  return { ok: true, summary: r.stdout.trim() || "Stashed changes" };
}

export async function gitStashPop(): Promise<GitToolResult> {
  const r = await git("stash pop");
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "git stash pop failed" };
  return { ok: true, summary: r.stdout.trim() || "Restored stashed changes" };
}

export async function gitCheckoutFile(path: string): Promise<GitToolResult> {
  const r = await git(`checkout HEAD -- "${path}"`);
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "git checkout failed" };
  return { ok: true, summary: `Restored ${path} to HEAD` };
}

export async function gitCommit(message: string, paths?: string[]): Promise<GitToolResult> {
  const addArgs = paths?.length ? paths.map((p) => `"${p}"`).join(" ") : "-A";
  const addResult = await git(`add ${addArgs}`);
  if (addResult.exitCode !== 0) return { ok: false, summary: addResult.stderr || "git add failed" };

  const r = await git(`commit -m "${message.replace(/"/g, '\\"')}"`);
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "git commit failed" };
  return { ok: true, summary: r.stdout.trim().split("\n")[0] || "Committed" };
}

/**
 * Stage updates to **tracked** files only (`git add -u`), then commit. Does not add new untracked files.
 * Suitable for automatic per-work-item checkpoints without sweeping the whole tree into the index.
 */
export async function gitCommitTrackedChanges(message: string): Promise<GitToolResult> {
  const cwd = workspaceRoot();
  if (!cwd) return { ok: false, summary: "No workspace open" };

  const st = await git("rev-parse --is-inside-work-tree", 3000);
  if (st.exitCode !== 0 || !/true/i.test(st.stdout.trim())) {
    return { ok: false, summary: "Not a git repository" };
  }

  const addResult = await git("add -u", 30_000);
  if (addResult.exitCode !== 0) return { ok: false, summary: addResult.stderr || "git add -u failed" };

  const safeMsg = message.replace(/"/g, '\\"');
  const r = await git(`commit -m "${safeMsg}"`, 30_000);
  const combined = `${r.stderr || ""}\n${r.stdout || ""}`.toLowerCase();
  if (r.exitCode !== 0) {
    if (combined.includes("nothing to commit") || combined.includes("no changes added to commit")) {
      return { ok: true, summary: "Nothing to commit (no staged tracked changes)." };
    }
    return { ok: false, summary: r.stderr || r.stdout || "git commit failed" };
  }
  return { ok: true, summary: r.stdout.trim().split("\n")[0] || "Committed" };
}

export async function gitShow(ref: string): Promise<GitToolResult> {
  const r = await git(`show --stat ${ref}`);
  if (r.exitCode !== 0) return { ok: false, summary: r.stderr || "git show failed" };
  return { ok: true, summary: `Show ${ref}`, data: trimText(r.stdout, 6000) };
}
