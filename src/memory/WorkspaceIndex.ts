import * as vscode from "vscode";
import { MemoryItem } from "../types";
import { runSingleFlight, uid, trimText } from "../util";
import { EmbeddingMemoryIndex } from "./EmbeddingMemoryIndex";
import { runCommand } from "../tools/CommandRunner";

export interface WorkspaceIndexEntry {
  file: string;
  summary: string;
}

/**
 * Indexes source files in the workspace for semantic retrieval.
 * Uses quick regex-based extraction of exports/classes/functions
 * and the first few lines of each file to build MemoryItems
 * for the EmbeddingMemoryIndex.
 */
export class WorkspaceIndex {
  private readonly index = new EmbeddingMemoryIndex();
  private items: MemoryItem[] = [];
  private indexed = false;
  private disposable?: vscode.Disposable;
  private readonly ensureBuiltSlot: { current: Promise<number> | null } = { current: null };
  private workspaceRoot: string | null = null;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingSaveRels = new Set<string>();

  /**
   * Ensures a full index build has completed at least once. Concurrent callers share one in-flight build.
   * Used by tools (e.g. findRelevantFiles) when `myAi.index.buildOnActivation` is false.
   */
  async ensureBuilt(): Promise<number> {
    if (this.indexed) return this.items.length;
    return runSingleFlight(this.ensureBuiltSlot, () => this.build());
  }

  async build(): Promise<number> {
    const cfg = vscode.workspace.getConfiguration();
    const maxFiles = cfg.get<number>("myAi.index.maxFiles", 500);
    const includeGlobs = cfg.get<string>("myAi.index.includeGlobs", "**/*.{ts,js,py,go,rs,java,tsx,jsx,vue,rb,cs,cpp,c,h,hpp}");
    const excludeGlobs = cfg.get<string>("myAi.index.excludeGlobs", "**/node_modules/**,**/dist/**,**/.git/**,**/vendor/**,**/__pycache__/**");

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      this.workspaceRoot = null;
      return 0;
    }
    this.workspaceRoot = workspaceRoot;

    const result = await runCommand({
      command: `rg --files -g '${includeGlobs}' ${excludeGlobs.split(",").map((g) => `-g '!${g.trim()}'`).join(" ")} . | head -${maxFiles}`,
      cwd: workspaceRoot,
      timeoutMs: 15_000,
      maxOutputBytes: 65_536,
    });

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      const fallbackFiles = await vscode.workspace.findFiles(includeGlobs, excludeGlobs, maxFiles);
      const entries = await Promise.all(
        fallbackFiles.map(async (f) => {
          const rel = vscode.workspace.asRelativePath(f);
          return this.indexFile(workspaceRoot, rel);
        })
      );
      this.items = entries.filter(Boolean) as MemoryItem[];
      this.indexed = true;
      this.disposable?.dispose();
      this.disposable = vscode.workspace.onDidSaveTextDocument((doc) => {
        const rel = vscode.workspace.asRelativePath(doc.uri);
        this.scheduleIncrementalReindex(rel);
      });
      return this.items.length;
    }

    const files = result.stdout.trim().split("\n").filter(Boolean);
    const entries = await Promise.all(files.map((f) => this.indexFile(workspaceRoot, f)));
    this.items = entries.filter(Boolean) as MemoryItem[];
    this.indexed = true;

    this.disposable?.dispose();
    this.disposable = vscode.workspace.onDidSaveTextDocument((doc) => {
      const rel = vscode.workspace.asRelativePath(doc.uri);
      this.scheduleIncrementalReindex(rel);
    });

    return this.items.length;
  }

  private scheduleIncrementalReindex(relativePath: string): void {
    const root = this.workspaceRoot;
    if (!root || !this.indexed) return;
    this.pendingSaveRels.add(relativePath);
    const cfg = vscode.workspace.getConfiguration();
    const raw = cfg.get<number>("myAi.index.incrementalSaveDebounceMs", 2000);
    const debounceMs = Math.max(200, Math.min(30_000, Number.isFinite(raw) ? raw : 2000));
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      void this.flushPendingSaves(root);
    }, debounceMs);
  }

  private async flushPendingSaves(workspaceRoot: string): Promise<void> {
    const rels = [...this.pendingSaveRels];
    this.pendingSaveRels.clear();
    for (const rel of rels) {
      const existing = this.items.findIndex((m) => m.tags?.includes(rel));
      const updated = await this.indexFile(workspaceRoot, rel);
      if (updated) {
        if (existing >= 0) this.items[existing] = updated;
        else this.items.push(updated);
      }
    }
  }

  private async indexFile(workspaceRoot: string, relativePath: string): Promise<MemoryItem | null> {
    try {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), relativePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString("utf8");
      const lines = text.split("\n");

      const exports = lines
        .filter((l) => /^export\s+(class|function|const|interface|type|enum|default)\s/i.test(l.trim()))
        .map((l) => l.trim())
        .slice(0, 10);

      const classNames = lines
        .filter((l) => /^\s*(export\s+)?(abstract\s+)?class\s+\w+/i.test(l))
        .map((l) => {
          const m = l.match(/class\s+(\w+)/);
          return m ? m[1] : "";
        })
        .filter(Boolean);

      const funcNames = lines
        .filter((l) => /^\s*(export\s+)?(async\s+)?function\s+\w+/i.test(l))
        .map((l) => {
          const m = l.match(/function\s+(\w+)/);
          return m ? m[1] : "";
        })
        .filter(Boolean);

      const firstLines = lines.slice(0, 5).join("\n");
      const summary = [
        `FILE: ${relativePath}`,
        classNames.length ? `Classes: ${classNames.join(", ")}` : "",
        funcNames.length ? `Functions: ${funcNames.join(", ")}` : "",
        exports.length ? `Exports: ${exports.slice(0, 5).join("; ")}` : "",
        `Preview: ${trimText(firstLines, 200)}`
      ].filter(Boolean).join("\n");

      return {
        id: uid("idx"),
        ts: Date.now(),
        kind: "finding",
        text: summary,
        tags: [relativePath],
      };
    } catch {
      return null;
    }
  }

  search(query: string, limit = 10): MemoryItem[] {
    if (!this.indexed) return [];
    return this.index.query(this.items, query, limit);
  }

  get fileCount(): number {
    return this.items.length;
  }

  dispose(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    this.pendingSaveRels.clear();
    this.disposable?.dispose();
    this.disposable = undefined;
  }
}
