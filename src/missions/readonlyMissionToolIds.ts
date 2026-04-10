/**
 * Built-in tools that do not mutate workspace state. Used for replay-risk / recovery heuristics
 * so read-only discovery (e.g. fileTree) is not treated like a mid-flight write or shell mutation.
 */
export const READONLY_MISSION_TOOL_IDS = new Set<string>([
  "readFile",
  "searchFiles",
  "listFiles",
  "grepSearch",
  "fileTree",
  "getDiagnostics",
  "listTools",
  "listMcpTools",
  "findRelevantFiles",
  "git.status",
  "git.diff",
  "git.log",
  "git.blame"
]);

export function isReadonlyMissionToolId(tool: string): boolean {
  return READONLY_MISSION_TOOL_IDS.has(tool);
}
