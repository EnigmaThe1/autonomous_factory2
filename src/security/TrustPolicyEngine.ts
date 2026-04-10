import * as vscode from "vscode";
import {
  evaluatePathDelete,
  evaluatePathRead,
  evaluatePathRename,
  evaluatePathWrite,
  evaluateRunCommand,
  evaluateRunTerminal,
  loadMissionAutonomyPolicy
} from "./missionAutonomyPolicy";

export type PolicyAction =
  | "read_file"
  | "write_file"
  | "apply_patch"
  | "delete_file"
  | "rename_file"
  | "run_terminal"
  | "run_command"
  | "http_request"
  | "call_mcp"
  | "call_external";

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

export interface PolicyInput {
  action: PolicyAction;
  targetPath?: string;
  /** rename_file: source path (destination is targetPath). */
  renameFromPath?: string;
  /** run_command / run_terminal: shell command text for host-risk classification. */
  commandText?: string;
  /** run_command: resolved cwd if any. */
  commandCwd?: string;
  /** run_command: agent shell vs git/docker/db mutating builtin (workspace_coder keeps infra gated). */
  shellInvocationKind?: import("./missionAutonomyPolicy").ShellInvocationKind;
  mutating?: boolean;
}

export interface PolicySettings {
  allowTerminal: boolean;
  requireApprovalForWrite: boolean;
  /** When true, write_file/apply_patch under the workspace root also require approval (default true in package.json). Set false for autonomous in-workspace writes with restrictToWorkspace. */
  requireApprovalForInWorkspaceWrites: boolean;
  requireApprovalForTerminal: boolean;
  requireApprovalForHttp: boolean;
  requireApprovalForMcp: boolean;
  requireApprovalForExternal: boolean;
  restrictToWorkspace: boolean;
}

export { isPathInWorkspace } from "./workspacePathUtils";

function actionDecisionToPolicyDecision(d: import("./missionAutonomyPolicyTypes").ActionDecision): PolicyDecision {
  if (d.kind === "deny") return { allowed: false, requiresApproval: false, reason: d.reason };
  if (d.kind === "require_approval") return { allowed: true, requiresApproval: true, reason: d.reason };
  return { allowed: true, requiresApproval: false, reason: d.reason };
}

export class TrustPolicyEngine {
  constructor(
    private readonly workspaceRoot: string | undefined,
    private readonly settings: PolicySettings,
    private readonly extensionRoot?: string
  ) {}

  decide(input: PolicyInput): PolicyDecision {
    const cfg = vscode.workspace.getConfiguration();
    const autonomy: import("./missionAutonomyPolicyTypes").MissionAutonomyPolicy = {
      ...loadMissionAutonomyPolicy((k, d) => cfg.get(k, d)),
      allowTerminal: this.settings.allowTerminal,
      restrictToWorkspace: this.settings.restrictToWorkspace
    };

    switch (input.action) {
      case "read_file": {
        if (!input.targetPath) {
          return { allowed: true, requiresApproval: false, reason: "Read permitted (no path)." };
        }
        const ad = evaluatePathRead(input.targetPath, this.workspaceRoot, this.extensionRoot, autonomy, this.settings);
        return actionDecisionToPolicyDecision(ad);
      }
      case "write_file":
      case "apply_patch": {
        if (!input.targetPath) {
          return { allowed: false, requiresApproval: false, reason: "Missing target path for write policy." };
        }
        const ad = evaluatePathWrite(input.targetPath, this.workspaceRoot, this.extensionRoot, autonomy, this.settings);
        return actionDecisionToPolicyDecision(ad);
      }
      case "delete_file": {
        if (!input.targetPath) {
          return { allowed: false, requiresApproval: false, reason: "Missing target path for delete policy." };
        }
        const ad = evaluatePathDelete(input.targetPath, this.workspaceRoot, this.extensionRoot, autonomy, this.settings);
        return actionDecisionToPolicyDecision(ad);
      }
      case "rename_file": {
        const to = input.targetPath;
        const from = input.renameFromPath;
        if (!to || !from) {
          return { allowed: false, requiresApproval: false, reason: "rename_file requires renameFromPath and targetPath (destination)." };
        }
        const ad = evaluatePathRename(from, to, this.workspaceRoot, this.extensionRoot, autonomy, this.settings);
        return actionDecisionToPolicyDecision(ad);
      }
      case "run_terminal": {
        const cmd = String(input.commandText || "");
        const ad = evaluateRunTerminal(cmd, this.workspaceRoot, autonomy, this.settings);
        return actionDecisionToPolicyDecision(ad);
      }
      case "run_command": {
        const cmd = String(input.commandText || "");
        const cwd = input.commandCwd;
        const ad = evaluateRunCommand(cmd, cwd, this.workspaceRoot, autonomy, this.settings, {
          shellInvocationKind: input.shellInvocationKind
        });
        return actionDecisionToPolicyDecision(ad);
      }
      case "http_request":
        return { allowed: true, requiresApproval: this.settings.requireApprovalForHttp, reason: "HTTP request policy evaluated." };
      case "call_mcp":
        return { allowed: true, requiresApproval: this.settings.requireApprovalForMcp, reason: "MCP policy evaluated." };
      case "call_external":
        return {
          allowed: true,
          requiresApproval: Boolean(input.mutating) && this.settings.requireApprovalForExternal,
          reason: "External adapter policy evaluated."
        };
      default:
        return { allowed: false, requiresApproval: false, reason: "Unsupported policy action." };
    }
  }
}
