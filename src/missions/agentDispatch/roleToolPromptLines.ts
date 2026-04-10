import * as vscode from "vscode";
import { MissionAgentRole, type AgentRole } from "../../types";
import { EXTENSION_TOOL_USER_PROMPT_BULLETS } from "../../agents/extensionToolHardRules";
import { GOAL_FIRST_USER_PROMPT_BULLETS } from "../../agents/goalFirstDiscipline";

function selfCorrectionForRole(role: AgentRole): string[] {
  const r =
    role === MissionAgentRole.Architect
      ? MissionAgentRole.Planner
      : role;
  if (r === MissionAgentRole.Planner) {
    return [
      "SELF-CORRECTION: Prefer WORK: lines and sequencing over mutating tools. If unsure, emit BLOCKER: with what you need."
    ];
  }
  if (r === MissionAgentRole.Reviewer) {
    return [
      "SELF-CORRECTION: Cite concrete findings with file paths; do not rewrite code unless the task explicitly asks for suggested patches as text."
    ];
  }
  if (r === MissionAgentRole.Validator) {
    return [
      "SELF-CORRECTION: Run verification tools when the repo supports them; record evidence in your summary before COMPLETE:."
    ];
  }
  return [
    "SELF-CORRECTION: After edits, run getDiagnostics or runLinter; fix errors before finishing.",
    "If a tool fails, read the error and change approach — do not repeat the same call."
  ];
}

function toolBulletsForRole(role: AgentRole): string[] {
  const r =
    role === MissionAgentRole.Architect
      ? MissionAgentRole.Planner
      : role;
  const read = [
    'TOOL:{"tool":"readFile","args":{"path":"..."}}',
    'TOOL:{"tool":"grepSearch","args":{"pattern":"regex","glob":"**/*.ts"}}',
    'TOOL:{"tool":"listFiles","args":{"glob":"**/*"}}',
    'TOOL:{"tool":"fileTree","args":{"maxDepth":3}}',
    'TOOL:{"tool":"findRelevantFiles","args":{"query":"..."}}',
    'TOOL:{"tool":"listTools","args":{}}',
    'TOOL:{"tool":"listMcpTools","args":{}}'
  ];
  if (r === MissionAgentRole.Planner) {
    return [
      ...read,
      'TOOL:{"tool":"getDiagnostics","args":{}}',
      "Optional repo-history probes when the task explicitly requires them: git.status / git.diff / git.log via listTools."
    ];
  }
  if (r === MissionAgentRole.Researcher) {
    return [
      ...read,
      'TOOL:{"tool":"getDiagnostics","args":{}}',
      'TOOL:{"tool":"webSearch","args":{"query":"..."}}',
      'TOOL:{"tool":"fetchWebPage","args":{"url":"https://..."}}',
      'TOOL:{"tool":"runCommand","args":{"command":"...","cwd":"..."}}',
      "Optional repo-history probes when the task explicitly requires them: git.status / git.diff / git.log / git.blame via listTools."
    ];
  }
  if (r === MissionAgentRole.Reviewer) {
    return [
      ...read,
      'TOOL:{"tool":"getDiagnostics","args":{}}',
      "Repo-level git probes are optional by default for review. Use git.status / git.diff / git.log / git.blame only when the review contract explicitly needs git evidence."
    ];
  }
  if (r === MissionAgentRole.Validator) {
    return [
      ...read,
      'TOOL:{"tool":"getDiagnostics","args":{}}',
      'TOOL:{"tool":"runLinter","args":{}}',
      'TOOL:{"tool":"runTests","args":{}}',
      "Repo-level git probes are optional by default for validation. Prefer direct artifact evidence unless validation explicitly requires git state."
    ];
  }
  // implementer — full catalog hint via listTools
  return [
    ...read,
    'TOOL:{"tool":"writeFile","args":{"path":"...","content":"..."}}',
    'TOOL:{"tool":"applyPatch","args":{"path":"...","search":"...","replace":"..."}}',
    'TOOL:{"tool":"runCommand","args":{"command":"...","cwd":"..."}}',
    'TOOL:{"tool":"runLinter","args":{}}',
    'TOOL:{"tool":"runTests","args":{}}',
    'TOOL:{"tool":"git.status","args":{}}',
    'TOOL:{"tool":"git.diff","args":{"staged":false,"path":"..."}}',
    'TOOL:{"tool":"git.log","args":{"count":10}}',
    "Other mutating or infra tools: use listTools / listMcpTools when needed."
  ];
}

/**
 * Role-scoped TOOL: instruction block (Phase 4). Implementer keeps broad capability via listTools discovery.
 */
export function getRoleScopedToolInstructionLines(role: AgentRole): string[] {
  const cfg = vscode.workspace.getConfiguration();
  const goalFirstOn = cfg.get<boolean>("myAi.agents.goalFirstDiscipline", true);
  return [
    "You may emit machine-readable lines only when needed:",
    ...EXTENSION_TOOL_USER_PROMPT_BULLETS,
    ...(goalFirstOn ? GOAL_FIRST_USER_PROMPT_BULLETS : []),
    `ROLE TOOL BUDGET (${role}):`,
    ...toolBulletsForRole(role),
    "WORK:ROLE:TITLE - PROMPT",
    "MEMORY:kind:tag1,tag2 - text",
    ...selfCorrectionForRole(role)
  ];
}
