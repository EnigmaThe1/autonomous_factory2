import { BUILTIN_TOOL_NAMES } from "./builtinToolNames";
import { trimText } from "../util";

const MAX_HINT_LEN = 220;

/** One-line usage hints for built-in tool names (lazy discovery). */
export const BUILTIN_TOOL_HINTS: Record<string, string> = {
  readFile:
    'args:{"path"} rel to ws; case-sensitive; grepSearch/fileTree; suggestedPaths if miss',
  writeFile: 'args: { "path", "content" } — often requires approval',
  applyPatch: 'args: { "path", "search", "replace" } — often requires approval',
  deleteFile: 'args: { "path", "useTrash"? } — requires approval; workspace-only; recovery spine protected by default',
  renameFile: 'args: { "from", "to", "overwrite"? } — requires approval; workspace-only; recovery spine protected by default',
  searchFiles: 'args: { "glob", "query" }',
  grepSearch: 'args: { "pattern", "glob"?, "maxResults"? }',
  listFiles: 'args: { "glob" }',
  fileTree: 'args: { "maxDepth"? }',
  getDiagnostics: "args: {}",
  runTerminal: 'args: { "command" } — prefer runCommand for captured output',
  runCommand: 'args: { "command", "cwd"?, "timeoutMs"? }',
  runTests: "args: { } or { \"command\" }",
  runLinter: "args: { } or { \"command\" }",
  httpRequest: 'args: { "method", "url", "headers"?, "body"? } — approval if configured',
  webSearch: 'args: { "query" } — requires myAi.webResearch.enabled',
  fetchWebPage: 'args: { "url" } — requires myAi.webResearch.enabled',
  browserCapture: 'args: { "url" } — requires myAi.browser.enabled + captureCommand',
  findRelevantFiles: 'args: { "query" }',
  listTools: "args: {} — builtins, external, mcpServers (names from MCP JSON), optional hints",
  listMcpTools: "args: {} — MCP tool names, then mcp.server.tool"
};

/** Tools invoked as git.* / docker.* / db.* (not in BUILTIN_TOOL_NAMES). */
export const EXTRA_TOOL_HINTS: Array<{ tool: string; hint: string }> = [
  { tool: "git.status", hint: "args: {}" },
  { tool: "git.diff", hint: 'args: { "staged"?, "path"? }' },
  { tool: "git.log", hint: 'args: { "count"? }' },
  { tool: "git.blame", hint: 'args: { "path", "startLine", "endLine" }' },
  { tool: "git.stash_push", hint: 'args: { "message"? } — approval' },
  { tool: "git.stash_pop", hint: "args: {} — approval" },
  { tool: "git.checkout_file", hint: 'args: { "path" } — approval' },
  { tool: "git.commit", hint: 'args: { "message", "paths"? } — approval' },
  { tool: "git.show", hint: 'args: { "ref"?, "path"? }' },
  { tool: "docker.ps", hint: "args: {}" },
  { tool: "docker.logs", hint: 'args: { "container", "tail"? }' },
  { tool: "docker.exec", hint: 'args: { "container", "command" } — approval' },
  { tool: "docker.compose_status", hint: "args: {}" },
  { tool: "db.query", hint: 'args: { "engine", "connectionString", "query" } — approval' },
  { tool: "db.schema", hint: 'args: { "engine", "connectionString" }' }
];

export interface ListToolsHintEntry {
  tool: string;
  hint: string;
}

export interface BuildListToolsHintsResult {
  entries: ListToolsHintEntry[];
  truncated: boolean;
}

function entryWeight(e: ListToolsHintEntry): number {
  return e.tool.length + e.hint.length + 8;
}

/** Shape needed to build `ext.*` rows (no URL — avoids leaking adapter endpoints into prompts). */
export interface ExternalAdapterHintSource {
  name: string;
  description?: string;
  mutating?: boolean;
  method?: string;
}

export function hintForExternalAdapter(a: ExternalAdapterHintSource): string {
  const desc = a.description ? trimText(a.description, 140) : "";
  const policy = a.mutating ? "mutating — approval if configured" : "non-mutating";
  const method = (a.method || "POST").toUpperCase();
  const tail = `${method} to configured URL; call TOOL with tool id ext.${a.name}`;
  return trimText([desc, policy, tail].filter(Boolean).join(" — "), MAX_HINT_LEN);
}

export function externalAdapterHintEntries(adapters: ExternalAdapterHintSource[]): ListToolsHintEntry[] {
  return adapters.map((a) => ({
    tool: `ext.${a.name}`,
    hint: hintForExternalAdapter(a)
  }));
}

/**
 * Ordered hint rows for listTools: builtins (registry order), git/docker/db extras, then `ext.*` adapters.
 * Stops before exceeding `maxChars` (rough JSON body budget for the hints array).
 */
export function buildListToolsHintEntries(
  maxChars: number,
  externalAdapters: ExternalAdapterHintSource[] = []
): BuildListToolsHintsResult {
  if (maxChars < 1) {
    return { entries: [], truncated: false };
  }
  const entries: ListToolsHintEntry[] = [];
  let used = 2;

  for (const name of BUILTIN_TOOL_NAMES) {
    const raw = BUILTIN_TOOL_HINTS[name];
    if (!raw) continue;
    const e: ListToolsHintEntry = { tool: name, hint: trimText(raw, MAX_HINT_LEN) };
    const w = entryWeight(e);
    if (used + w > maxChars) {
      return { entries, truncated: true };
    }
    entries.push(e);
    used += w;
  }

  for (const x of EXTRA_TOOL_HINTS) {
    const e: ListToolsHintEntry = { tool: x.tool, hint: trimText(x.hint, MAX_HINT_LEN) };
    const w = entryWeight(e);
    if (used + w > maxChars) {
      return { entries, truncated: true };
    }
    entries.push(e);
    used += w;
  }

  for (const e of externalAdapterHintEntries(externalAdapters)) {
    const w = entryWeight(e);
    if (used + w > maxChars) {
      return { entries, truncated: true };
    }
    entries.push(e);
    used += w;
  }

  return { entries, truncated: false };
}
