import * as vscode from "vscode";
import { ChatContext } from "../types";
import { ContextCollector } from "./ContextCollector";
import { runCommand } from "../tools/CommandRunner";
import { fileTree } from "../tools/RipgrepSearch";
import { trimText } from "../util";

/**
 * Extends the base ContextCollector with project-wide awareness:
 * file tree, manifest summaries, git status, workspace diagnostics,
 * and keyword-relevant file snippets.
 */
export class EnhancedContextCollector extends ContextCollector {
  private relevantSnippetCache?: {
    key: string;
    expiresAt: number;
    snippets: Array<{ file: string; snippet: string }>;
  };

  async collect(): Promise<ChatContext> {
    const base = await super.collect();
    return base;
  }

  /**
   * Full enriched context for mission work items.
   * `isFirstWorkItem` triggers the heavier project overview scan.
   * `keywords` drives relevant-file discovery.
   */
  async collectForMission(opts: {
    isFirstWorkItem?: boolean;
    keywords?: string[];
  } = {}): Promise<ChatContext> {
    const base = await super.collect();

    const [allDiag, gitSt] = await Promise.all([
      this.collectDiagnosticsSummary(),
      this.collectGitStatus(),
    ]);

    const enriched: ChatContext = {
      ...base,
      allDiagnosticsSummary: allDiag || undefined,
      gitStatus: gitSt || undefined,
    };

    if (opts.isFirstWorkItem) {
      enriched.projectOverview = await this.collectProjectOverview();
    }

    if (opts.keywords?.length) {
      enriched.relevantFileSnippets = await this.collectRelevantSnippets(opts.keywords);
    }

    return enriched;
  }

  async collectProjectOverview(): Promise<string> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return "(no workspace open)";

    const sections: string[] = [];

    const tree = await fileTree({ cwd: workspaceRoot, maxDepth: 3, maxFiles: 200 });
    if (tree.ok) {
      sections.push("=== FILE TREE ===", tree.tree);
    }

    const manifests = ["package.json", "Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt", "Makefile", "docker-compose.yml", "docker-compose.yaml", "Dockerfile"];
    for (const name of manifests) {
      try {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, name);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString("utf8");
        sections.push(`=== ${name} ===`, trimText(text, 2000));
      } catch {
        // file doesn't exist — skip
      }
    }

    const gitBranch = await runCommand({ command: "git rev-parse --abbrev-ref HEAD 2>/dev/null", cwd: workspaceRoot, timeoutMs: 3000 });
    if (gitBranch.exitCode === 0) {
      sections.push(`=== GIT BRANCH === ${gitBranch.stdout.trim()}`);
    }

    return sections.join("\n") || "(empty project)";
  }

  async collectDiagnosticsSummary(): Promise<string> {
    const all = vscode.languages.getDiagnostics();
    if (!all.length) return "";

    let errors = 0;
    let warnings = 0;
    const issues: string[] = [];

    for (const [uri, diags] of all) {
      for (const d of diags) {
        if (d.severity === vscode.DiagnosticSeverity.Error) {
          errors++;
          if (issues.length < 30) {
            issues.push(`ERROR ${uri.fsPath}:${d.range.start.line + 1} ${d.message}`);
          }
        } else if (d.severity === vscode.DiagnosticSeverity.Warning) {
          warnings++;
          if (issues.length < 50) {
            issues.push(`WARN ${uri.fsPath}:${d.range.start.line + 1} ${d.message}`);
          }
        }
      }
    }

    if (!errors && !warnings) return "";
    return [`${errors} error(s), ${warnings} warning(s):`, ...issues].join("\n");
  }

  async collectGitStatus(): Promise<string> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return "";

    const result = await runCommand({
      command: "git status --porcelain=v2 --branch 2>/dev/null | head -40",
      cwd: workspaceRoot,
      timeoutMs: 5000,
    });

    if (result.exitCode !== 0 || !result.stdout.trim()) return "";
    return trimText(result.stdout.trim(), 2000);
  }

  private async collectRelevantSnippets(keywords: string[]): Promise<Array<{ file: string; snippet: string }>> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || !keywords.length) return [];

    const ttlMs = vscode.workspace.getConfiguration().get<number>("myAi.context.relevantSnippetsCacheTtlMs", 30_000);
    const cacheKey = `${workspaceRoot}\n${[...keywords].sort().join("\0")}`;
    const now = Date.now();
    if (
      ttlMs > 0 &&
      this.relevantSnippetCache &&
      this.relevantSnippetCache.key === cacheKey &&
      now < this.relevantSnippetCache.expiresAt
    ) {
      return this.relevantSnippetCache.snippets;
    }

    const snippets = await this.collectRelevantSnippetsUncached(keywords, workspaceRoot);
    if (ttlMs > 0) {
      this.relevantSnippetCache = { key: cacheKey, expiresAt: now + ttlMs, snippets };
    }
    return snippets;
  }

  private async collectRelevantSnippetsUncached(
    keywords: string[],
    workspaceRoot: string
  ): Promise<Array<{ file: string; snippet: string }>> {
    const combined = keywords.slice(0, 5).join("|");
    const result = await runCommand({
      command: `rg -l -m 1 --max-filesize 500K -g '!node_modules' -g '!dist' -g '!.git' -- ${shellQuoteSafe(combined)} . | head -15`,
      cwd: workspaceRoot,
      timeoutMs: 8000
    });

    if (result.exitCode !== 0 && result.exitCode !== 1) return [];

    const files = result.stdout.trim().split("\n").filter(Boolean).slice(0, 10);
    const snippets: Array<{ file: string; snippet: string }> = [];

    for (const file of files) {
      try {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, file);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString("utf8");
        const lines = text.split("\n");
        const preview = lines.slice(0, 30).join("\n");
        snippets.push({ file, snippet: trimText(preview, 800) });
      } catch {
        // skip unreadable files
      }
    }

    return snippets;
  }
}

function shellQuoteSafe(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
