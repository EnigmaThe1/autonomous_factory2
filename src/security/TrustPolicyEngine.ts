import * as path from "path";

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

export function isPathInWorkspace(workspaceRoot: string | undefined, targetPath: string): boolean {
  if (!workspaceRoot) return false;
  const normalizedRoot = path.resolve(workspaceRoot);
  const normalizedTarget = path.resolve(targetPath);
  const rel = path.relative(normalizedRoot, normalizedTarget);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export class TrustPolicyEngine {
  constructor(private readonly workspaceRoot: string | undefined, private readonly settings: PolicySettings) {}

  decide(input: PolicyInput): PolicyDecision {
    if (input.targetPath && this.settings.restrictToWorkspace && !isPathInWorkspace(this.workspaceRoot, input.targetPath)) {
      return { allowed: false, requiresApproval: false, reason: `Path is outside workspace: ${input.targetPath}` };
    }

    switch (input.action) {
      case "read_file":
        return { allowed: true, requiresApproval: false, reason: "Read permitted." };
      case "write_file":
      case "apply_patch": {
        const hasPath = Boolean(input.targetPath);
        const inWorkspace = hasPath && isPathInWorkspace(this.workspaceRoot, input.targetPath!);
        const requiresApproval =
          this.settings.requireApprovalForWrite &&
          (!inWorkspace || this.settings.requireApprovalForInWorkspaceWrites);
        return { allowed: true, requiresApproval, reason: "Write policy evaluated." };
      }
      case "delete_file":
      case "rename_file": {
        const hasPath = Boolean(input.targetPath);
        const inWorkspace = hasPath && isPathInWorkspace(this.workspaceRoot, input.targetPath!);
        const requiresApproval =
          this.settings.requireApprovalForWrite &&
          (!inWorkspace || this.settings.requireApprovalForInWorkspaceWrites);
        return { allowed: true, requiresApproval, reason: "Delete/rename policy evaluated." };
      }
      case "run_terminal":
        if (!this.settings.allowTerminal) return { allowed: false, requiresApproval: false, reason: "Terminal execution disabled by policy." };
        return { allowed: true, requiresApproval: this.settings.requireApprovalForTerminal, reason: "Terminal policy evaluated." };
      case "run_command":
        if (!this.settings.allowTerminal) return { allowed: false, requiresApproval: false, reason: "Command execution disabled by policy (myAi.tools.allowTerminal)." };
        return { allowed: true, requiresApproval: this.settings.requireApprovalForTerminal, reason: "Command policy evaluated." };
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
