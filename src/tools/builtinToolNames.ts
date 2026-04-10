/** Built-in tool ids handled by `ToolRegistry` (non-git/docker/db/MCP). */
export const BUILTIN_TOOL_NAMES = [
  "readFile", "writeFile", "applyPatch", "deleteFile", "renameFile", "searchFiles", "grepSearch",
  "listFiles", "fileTree", "getDiagnostics", "runTerminal", "runCommand",
  "runTests", "runLinter", "httpRequest", "webSearch", "fetchWebPage", "browserCapture", "findRelevantFiles", "listTools", "listMcpTools"
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];
