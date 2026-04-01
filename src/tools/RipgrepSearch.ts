import * as vscode from "vscode";
import { runCommand } from "./CommandRunner";

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export interface RipgrepMatch {
  file: string;
  line: number;
  col: number;
  matchText: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface RipgrepSearchOptions {
  pattern: string;
  glob?: string;
  cwd?: string;
  maxResults?: number;
  caseSensitive?: boolean;
  contextLines?: number;
  /** Treat pattern as a fixed string, not a regex. */
  fixedString?: boolean;
}

interface RgJsonMessage {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    submatches?: Array<{ match?: { text?: string }; start?: number }>;
    lines?: { text?: string };
  };
}

/**
 * Runs `rg` (ripgrep) and returns structured matches.
 *
 * Falls back gracefully when `rg` is not installed — returns an error
 * result instead of throwing.
 */
export async function ripgrepSearch(opts: RipgrepSearchOptions): Promise<{
  ok: boolean;
  matches: RipgrepMatch[];
  truncated: boolean;
  error?: string;
}> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cwd = opts.cwd || workspaceRoot || process.cwd();
  const maxResults = opts.maxResults ?? 50;
  const contextLines = opts.contextLines ?? 2;

  const args: string[] = ["rg", "--json"];

  if (!opts.caseSensitive) args.push("-i");
  if (opts.fixedString) args.push("--fixed-strings");
  args.push("-C", String(contextLines));
  args.push("-m", String(maxResults));
  args.push("--max-filesize", "1M");

  if (opts.glob) {
    args.push("-g", shellQuote(opts.glob));
  }

  args.push("--", shellQuote(opts.pattern), ".");

  const result = await runCommand({
    command: args.join(" "),
    cwd,
    timeoutMs: 15_000,
    maxOutputBytes: 65_536,
  });

  if (result.exitCode === null || (result.stderr && result.stderr.includes("command not found"))) {
    return { ok: false, matches: [], truncated: false, error: "ripgrep (rg) is not installed or not on PATH." };
  }

  if (result.exitCode === 2) {
    return { ok: false, matches: [], truncated: false, error: result.stderr || "ripgrep returned an error." };
  }

  // exitCode 1 = no matches (normal)
  if (result.exitCode === 1 && !result.stdout.trim()) {
    return { ok: true, matches: [], truncated: false };
  }

  const matches: RipgrepMatch[] = [];
  const contextBefore = new Map<string, string[]>();
  let truncated = false;

  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    let msg: RgJsonMessage;
    try { msg = JSON.parse(line); } catch { continue; }

    if (msg.type === "context" && msg.data?.path?.text) {
      const key = `${msg.data.path.text}:${msg.data.line_number}`;
      const existing = contextBefore.get(msg.data.path.text) || [];
      existing.push(msg.data.lines?.text?.replace(/\n$/, "") || "");
      contextBefore.set(msg.data.path.text, existing);
      void key;
    }

    if (msg.type === "match" && msg.data) {
      const file = msg.data.path?.text || "";
      const lineNum = msg.data.line_number || 0;
      const sub = msg.data.submatches?.[0];
      const matchText = sub?.match?.text || msg.data.lines?.text?.replace(/\n$/, "") || "";
      const col = (sub?.start ?? 0) + 1;

      matches.push({
        file,
        line: lineNum,
        col,
        matchText,
        contextBefore: [],
        contextAfter: [],
      });

      if (matches.length >= maxResults) {
        truncated = true;
        break;
      }
    }
  }

  return { ok: true, matches, truncated };
}

/**
 * Generates a workspace file tree using `find` with depth limit.
 *
 * Falls back to `vscode.workspace.findFiles` if `find` is not available.
 */
export async function fileTree(opts?: {
  cwd?: string;
  maxDepth?: number;
  maxFiles?: number;
  excludePatterns?: string[];
}): Promise<{ ok: boolean; tree: string; fileCount: number; error?: string }> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cwd = opts?.cwd || workspaceRoot || process.cwd();
  const maxDepth = opts?.maxDepth ?? 4;
  const maxFiles = opts?.maxFiles ?? 500;

  const defaultExcludes = [".git", "node_modules", "__pycache__", ".mypy_cache", "dist", ".my-ai-extension", ".vsix"];
  const excludes = opts?.excludePatterns || defaultExcludes;

  const pruneArgs = excludes.map((e) => `\\( -name "${e}" -prune \\)`).join(" -o ");
  const command = `find . -maxdepth ${maxDepth} ${pruneArgs} -o -print | head -n ${maxFiles + 1} | sort`;

  const result = await runCommand({ command, cwd, timeoutMs: 10_000 });

  if (!result.stdout.trim() && result.exitCode !== 0) {
    return { ok: false, tree: "", fileCount: 0, error: result.stderr || "find command failed" };
  }

  const lines = result.stdout.trim().split("\n").filter(Boolean);
  const truncated = lines.length > maxFiles;
  const trimmedLines = truncated ? lines.slice(0, maxFiles) : lines;

  const dirs = trimmedLines.filter((l) => !l.includes(".") || l.endsWith("/")).length;
  const files = trimmedLines.length - dirs;

  const tree = trimmedLines.join("\n");
  const summary = truncated
    ? `[${files} files, ${dirs} dirs shown — truncated at ${maxFiles}]`
    : `[${files} files, ${dirs} dirs]`;

  return { ok: true, tree: `${tree}\n\n${summary}`, fileCount: files };
}
