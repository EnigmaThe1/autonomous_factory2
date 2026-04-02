import * as vscode from "vscode";
import * as path from "path";

type SkillsCache = { at: number; key: string; text: string };

const cache: SkillsCache = { at: 0, key: "", text: "" };
const TTL_MS = 45_000;

/**
 * Load markdown skill files from workspace globs and return a single block for agent system prompts.
 * Cached briefly per workspace + patterns. Safe no-op with no folder or empty matches.
 */
export async function loadWorkspaceSkillsForAgents(): Promise<string> {
  const cfg = vscode.workspace.getConfiguration();
  if (!cfg.get<boolean>("myAi.skills.enabled", true)) {
    return "";
  }
  const maxTotal = Math.max(500, cfg.get<number>("myAi.skills.maxTotalChars", 12_000));
  const maxPerFile = Math.max(200, cfg.get<number>("myAi.skills.maxCharsPerFile", 4000));
  const patterns = cfg.get<string[]>("myAi.skills.globPatterns", [".my-ai/skills/**/*.md"]);
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return "";
  }
  const cacheKey = `${folder.uri.fsPath}:${patterns.join("|")}:${maxTotal}:${maxPerFile}`;
  const now = Date.now();
  if (cache.text && now - cache.at < TTL_MS && cache.key === cacheKey) {
    return cache.text;
  }

  const uris: vscode.Uri[] = [];
  for (const pattern of patterns) {
    if (!pattern?.trim()) continue;
    const rel = new vscode.RelativePattern(folder, pattern.trim());
    const found = await vscode.workspace.findFiles(rel, "**/node_modules/**", 40);
    uris.push(...found);
  }

  const seen = new Set<string>();
  const unique = uris.filter((u) => {
    const p = u.fsPath;
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  unique.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

  const chunks: string[] = [];
  let total = 0;
  for (const uri of unique) {
    if (total >= maxTotal) break;
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(raw).toString("utf8").replace(/\r\n/g, "\n");
      const rel = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, "/");
      const slice = text.slice(0, maxPerFile);
      const header = `### Skill: ${rel}\n\n`;
      const room = maxTotal - total;
      const body = slice.length > room ? slice.slice(0, room) : slice;
      const chunk = header + body;
      chunks.push(chunk);
      total += chunk.length;
    } catch {
      // skip unreadable
    }
  }

  const text = chunks.length ? chunks.join("\n\n---\n\n") : "";
  cache.at = now;
  cache.key = cacheKey;
  cache.text = text;
  return text;
}

/** Test hook: invalidate in-memory skills cache. */
export function __clearWorkspaceSkillsCacheForTest(): void {
  cache.at = 0;
  cache.key = "";
  cache.text = "";
}
