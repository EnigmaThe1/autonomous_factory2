import { MissionAgentRole, type AgentRole } from "../../types";

const GIT_MUTATING = new Set(["git.commit", "git.checkout_file", "git.stash_push", "git.stash_pop"]);

function isInfraMutating(tool: string): boolean {
  return tool.startsWith("docker.exec") || tool === "db.query";
}

const WEB_OR_HTTP_TOOLS = new Set(["webSearch", "fetchWebPage", "httpRequest", "browserCapture"]);

const BUILTIN_MUTATING = new Set([
  "writeFile",
  "applyPatch",
  "deleteFile",
  "renameFile",
  "runTerminal",
  "runCommand"
]);

/**
 * Whether a built-in (non-prefix) tool may mutate workspace or host state.
 * MCP / ext tools are handled separately.
 */
export function isBuiltinMutatingToolId(tool: string): boolean {
  return BUILTIN_MUTATING.has(tool);
}

/**
 * Role-scoped tool gate for mission work items (Phase 4).
 * - Planner / architect: read, inspect, plan (no workspace mutation, no shell).
 * - Researcher: read + research/web + bounded shell for diagnosis.
 * - Implementer: full mutation + commands within existing policy.
 * - Reviewer: read + diff-style git + diagnostics (no mutation).
 * - Validator: read + runTests/runLinter + diagnostics + read-only git.
 */
export function isMissionToolAllowedForRole(role: AgentRole, tool: string): boolean {
  if (tool === "listTools" || tool === "listMcpTools") return true;

  const r =
    role === MissionAgentRole.Architect
      ? MissionAgentRole.Planner
      : role;

  if (tool.startsWith("mcp.") || tool.startsWith("ext.")) {
    return r === MissionAgentRole.Researcher || r === MissionAgentRole.Implementer;
  }

  if (tool.startsWith("git.")) {
    if (GIT_MUTATING.has(tool)) return r === MissionAgentRole.Implementer;
    return (
      r === MissionAgentRole.Planner ||
      r === MissionAgentRole.Researcher ||
      r === MissionAgentRole.Reviewer ||
      r === MissionAgentRole.Validator ||
      r === MissionAgentRole.Implementer
    );
  }

  if (tool.startsWith("docker.") || tool.startsWith("db.")) {
    if (isInfraMutating(tool)) return r === MissionAgentRole.Implementer;
    return (
      r === MissionAgentRole.Researcher ||
      r === MissionAgentRole.Implementer ||
      r === MissionAgentRole.Validator
    );
  }

  if (WEB_OR_HTTP_TOOLS.has(tool)) {
    return r === MissionAgentRole.Researcher || r === MissionAgentRole.Implementer;
  }

  if (tool === "runTests" || tool === "runLinter") {
    return r === MissionAgentRole.Validator || r === MissionAgentRole.Implementer;
  }

  if (tool === "runCommand" || tool === "runTerminal") {
    return r === MissionAgentRole.Researcher || r === MissionAgentRole.Implementer;
  }

  if (isBuiltinMutatingToolId(tool)) {
    return r === MissionAgentRole.Implementer;
  }

  // Remaining builtins: read/search/tree/diagnostics/findRelevantFiles/searchFiles
  return (
    r === MissionAgentRole.Planner ||
    r === MissionAgentRole.Researcher ||
    r === MissionAgentRole.Reviewer ||
    r === MissionAgentRole.Validator ||
    r === MissionAgentRole.Implementer
  );
}

/** Stable list for prompt attachment (representative; dynamic tools use prefix rules above). */
export function allowedToolIdsForRole(role: AgentRole): readonly string[] {
  const r =
    role === MissionAgentRole.Architect
      ? MissionAgentRole.Planner
      : role;
  const baseRead = [
    "readFile",
    "grepSearch",
    "searchFiles",
    "listFiles",
    "fileTree",
    "findRelevantFiles",
    "getDiagnostics",
    "listTools",
    "listMcpTools",
    "git.status",
    "git.diff",
    "git.log",
    "git.blame"
  ] as const;
  switch (r) {
    case MissionAgentRole.Planner:
      return [...baseRead];
    case MissionAgentRole.Researcher:
      return [
        ...baseRead,
        "webSearch",
        "fetchWebPage",
        "httpRequest",
        "browserCapture",
        "runCommand",
        "runTerminal",
        "docker.ps",
        "docker.logs",
        "docker.compose_status",
        "db.schema"
      ];
    case MissionAgentRole.Reviewer:
      return [...baseRead];
    case MissionAgentRole.Validator:
      return [...baseRead, "runTests", "runLinter", "docker.ps", "docker.logs", "docker.compose_status", "db.schema"];
    case MissionAgentRole.Implementer:
      return [
        ...baseRead,
        "writeFile",
        "applyPatch",
        "deleteFile",
        "renameFile",
        "runCommand",
        "runTerminal",
        "runTests",
        "runLinter",
        "webSearch",
        "fetchWebPage",
        "httpRequest",
        "browserCapture",
        "git.commit",
        "git.stash_push",
        "git.stash_pop",
        "git.checkout_file",
        "docker.*",
        "db.*",
        "mcp.*",
        "ext.*"
      ];
  }
}
