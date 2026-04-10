/**
 * Central mission autonomy policy types (workspace trust boundary).
 * Evaluator: missionAutonomyPolicy.ts — wired through TrustPolicyEngine + ToolRegistry.
 */

/**
 * Operator-facing autonomy preset:
 * - strict: legacy approval-heavy defaults
 * - workspace_coder / workspace_autonomous / structured_autonomous: workspace-trust tool policy (non-strict); runner may auto-chain passes in autonomous presets (see missionRunnerAutonomy)
 */
export type AutonomyMode =
  | "strict"
  | "workspace_coder"
  | "workspace_autonomous"
  | "structured_autonomous";

/**
 * Blueprint as planning strategy (settings / UX); mission-level blueprint still uses myAi.missions.blueprintMode.
 * Phase 1 stores the enum for presets and future wiring.
 */
export type BlueprintPlanningMode = "off" | "optional" | "required_first";

export type PathZone =
  | "outside_workspace"
  | "workspace_open"
  | "workspace_protected"
  | "workspace_blocked"
  | "extension_core";

export type CommandZone = "workspace_safe" | "host_risk";

export type ActionDecisionKind = "allow" | "require_approval" | "deny";

export interface ActionDecision {
  kind: ActionDecisionKind;
  reason: string;
  /** Recovery spine / protected globs: ToolRegistry enforces __recoverySpineOverride after approval. */
  recoverySpineProtected?: boolean;
}

export interface MissionAutonomyPolicy {
  mode: AutonomyMode;
  blueprintPlanning: BlueprintPlanningMode;
  autoApproveWorkspaceWrites: boolean;
  autoApproveWorkspaceDeletes: boolean;
  autoApproveWorkspaceSafeCommands: boolean;
  /** Additional workspace-relative globs (same syntax as recovery spine) requiring approval to mutate. */
  protectedPathGlobs: string[];
  /** Workspace-relative globs that hard-deny mutations. */
  blockedPathGlobs: string[];
  /** When the target is under the extension install root but outside the opened workspace tree. */
  extensionCoreMutationPolicy: "deny" | "require_approval";
  /** From TrustPolicyEngine / tool settings (not autonomy namespace). */
  restrictToWorkspace: boolean;
  allowTerminal: boolean;
  /** When false (default), git.* / docker.* / db mutating tool paths still require terminal-style approval in workspace_coder mode. */
  autoApproveInfrastructureMutations: boolean;
}

export type PolicyConfigGet = <T>(key: string, defaultValue: T) => T;
