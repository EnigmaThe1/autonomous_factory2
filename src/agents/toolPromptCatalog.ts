import * as vscode from "vscode";

/** TOOL: lines and related instructions appended to the user prompt (full catalog). */
function fullToolLines(): string[] {
  return [
    'TOOL:{"tool":"readFile","args":{"path":"..."}}',
    'TOOL:{"tool":"writeFile","args":{"path":"...","content":"..."}} — create/overwrite file (may require approval)',
    'TOOL:{"tool":"applyPatch","args":{"path":"...","search":"...","replace":"..."}} — search/replace edit (may require approval)',
    'TOOL:{"tool":"runCommand","args":{"command":"...","cwd":"..."}} — runs a shell command and returns stdout/stderr/exitCode',
    'TOOL:{"tool":"runTerminal","args":{"command":"..."}} — legacy terminal spawn (prefer runCommand for captured output)',
    'TOOL:{"tool":"findRelevantFiles","args":{"query":"describe what you are looking for"}} — semantic search across indexed workspace files',
    'TOOL:{"tool":"grepSearch","args":{"pattern":"regex_pattern","glob":"**/*.ts"}} — fast regex search across all files via ripgrep',
    'TOOL:{"tool":"searchFiles","args":{"glob":"**/*.ts","query":"searchTerm"}} — substring search across files',
    'TOOL:{"tool":"listFiles","args":{"glob":"src/**/*"}}',
    'TOOL:{"tool":"fileTree","args":{"maxDepth":3}} — returns workspace directory tree',
    'TOOL:{"tool":"getDiagnostics","args":{}} — returns workspace-wide linter/compiler diagnostics',
    'TOOL:{"tool":"runTests","args":{}} — runs test suite and returns structured pass/fail results',
    'TOOL:{"tool":"runLinter","args":{}} — runs linter and returns error/warning counts with details',
    'TOOL:{"tool":"git.status","args":{}} — shows branch and changed files',
    'TOOL:{"tool":"git.diff","args":{"staged":false,"path":"..."}} — shows file diffs',
    'TOOL:{"tool":"git.log","args":{"count":10}} — recent commit history',
    'TOOL:{"tool":"git.blame","args":{"path":"...","startLine":1,"endLine":20}}',
    'TOOL:{"tool":"git.stash_push","args":{"message":"..."}} — save current changes (requires approval)',
    'TOOL:{"tool":"git.stash_pop","args":{}} — restore stashed changes (requires approval)',
    'TOOL:{"tool":"git.commit","args":{"message":"...","paths":["..."]}} — commit changes (requires approval)',
    'TOOL:{"tool":"httpRequest","args":{"method":"GET","url":"http://...","headers":{},"body":""}} — HTTP request (requires approval)',
    'TOOL:{"tool":"webSearch","args":{"query":"keywords for documentation or facts"}} — web search (off unless myAi.webResearch.enabled; myAi.webSearch.provider duckduckgo|brave; optional minIntervalMs; requires approval if HTTP approval on)',
    'TOOL:{"tool":"fetchWebPage","args":{"url":"https://..."}} — GET public page text (off unless myAi.webResearch.enabled; requires approval if HTTP approval on)',
    'TOOL:{"tool":"browserCapture","args":{"url":"https://..."}} — run your configured screenshot/CLI (myAi.browser.enabled + captureCommand with {url} and {outPath}); uses run_command policy',
    'TOOL:{"tool":"docker.ps","args":{}} — list running containers',
    'TOOL:{"tool":"docker.logs","args":{"container":"name","tail":100}} — container logs',
    'TOOL:{"tool":"docker.exec","args":{"container":"name","command":"..."}} — exec in container (requires approval)',
    'TOOL:{"tool":"docker.compose_status","args":{}} — docker compose service status',
    'TOOL:{"tool":"db.query","args":{"engine":"postgres","connectionString":"...","query":"SELECT ..."}} — run SQL query (requires approval)',
    'TOOL:{"tool":"db.schema","args":{"engine":"postgres","connectionString":"..."}} — dump database schema',
    'TOOL:{"tool":"listTools","args":{}}',
    'TOOL:{"tool":"ext.adapter_name","args":{"...":"..."}}',
    'TOOL:{"tool":"mcp.server_name.tool_name","args":{"...":"..."}}'
  ];
}

function lazyToolLines(): string[] {
  return [
    "LAZY TOOL CATALOG: only common tools are listed below. Emit TOOL:{\"tool\":\"listTools\",\"args\":{}} for built-in names, external adapters, and bounded `hints` (myAi.tools.listToolsHintsMaxChars). Emit TOOL:{\"tool\":\"listMcpTools\",\"args\":{}} for MCP tools (set myAi.tools.listMcpToolsSummaryMaxChars > 0 to drop heavy inputSchema), then call mcp.server_name.tool_name.",
    'TOOL:{"tool":"readFile","args":{"path":"..."}}',
    'TOOL:{"tool":"writeFile","args":{"path":"...","content":"..."}} — may require approval',
    'TOOL:{"tool":"applyPatch","args":{"path":"...","search":"...","replace":"..."}} — may require approval',
    'TOOL:{"tool":"runCommand","args":{"command":"...","cwd":"..."}} — stdout/stderr/exitCode',
    'TOOL:{"tool":"runTerminal","args":{"command":"..."}} — prefer runCommand when you need output',
    'TOOL:{"tool":"grepSearch","args":{"pattern":"regex","glob":"**/*.ts"}}',
    'TOOL:{"tool":"findRelevantFiles","args":{"query":"..."}}',
    'TOOL:{"tool":"listFiles","args":{"glob":"**/*"}}',
    'TOOL:{"tool":"fileTree","args":{"maxDepth":3}}',
    'TOOL:{"tool":"getDiagnostics","args":{}}',
    'TOOL:{"tool":"runTests","args":{}}',
    'TOOL:{"tool":"runLinter","args":{}}',
    'TOOL:{"tool":"listTools","args":{}}',
    'TOOL:{"tool":"listMcpTools","args":{}}',
    'TOOL:{"tool":"ext.adapter_name","args":{"...":"..."}}',
    'TOOL:{"tool":"mcp.server_name.tool_name","args":{"...":"..."}}'
  ];
}

function selfCorrectionLines(lazy: boolean): string[] {
  if (lazy) {
    return [
      "SELF-CORRECTION PROTOCOL:",
      "1. If you need git, http, web search, docker, db, or other builtins not shown, run listTools (and listMcpTools for MCP) before guessing tool names.",
      "2. After writing or patching code, run getDiagnostics or runLinter; fix errors before finishing.",
      "3. After substantive changes, run runTests when the project has tests.",
      "4. If a tool call fails, read the error and try a different approach — do not repeat the exact same call.",
      "5. Prefer runCommand over runTerminal when you need captured output.",
      "6. Use COMPLETE: only when the mission is genuinely complete. Use BLOCKER: only for a real blocker."
    ];
  }
  return [
    "SELF-CORRECTION PROTOCOL:",
    "1. After writing or patching code, ALWAYS run getDiagnostics or runLinter to check for errors you introduced.",
    "2. If diagnostics show errors, fix them immediately before marking the task done.",
    "3. After fixing code, run runTests to verify you haven't broken existing functionality.",
    "4. If a tool call fails, read the error carefully and try a different approach — do not repeat the exact same call.",
    "5. When working on large changes, use git.diff to review your changes before concluding.",
    "6. If you encounter an import/module error, use grepSearch to find the correct export path.",
    "Use COMPLETE: only when the mission is genuinely complete. Use BLOCKER: only for a real blocker."
  ];
}

/**
 * Machine-readable tool help lines (TOOL:, WORK:, etc.) merged into the user prompt.
 * Controlled by `myAi.agents.lazyToolPrompt`: when true, a short list + discovery via listTools / listMcpTools.
 */
export function getAgentToolInstructionLines(): string[] {
  const cfg = vscode.workspace.getConfiguration();
  const lazy = cfg.get<boolean>("myAi.agents.lazyToolPrompt", false);
  const toolLines = lazy ? lazyToolLines() : fullToolLines();
  return [
    "You may emit machine-readable lines only when needed:",
    ...toolLines,
    "WORK:ROLE:TITLE - PROMPT",
    "MEMORY:kind:tag1,tag2 - text",
    "Prefer runCommand over runTerminal when you need to see command output (build results, test output, git status, etc.).",
    ...selfCorrectionLines(lazy)
  ];
}
