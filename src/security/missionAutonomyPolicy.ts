/**
 * Mission autonomy policy evaluator: path zones, command risk, and ActionDecision for file/terminal tools.
 * Tools surface outcomes; this module decides allow / require_approval / deny.
 */
import * as path from "path";
import { classifyRecoverySpineTarget } from "./RecoverySpinePolicy";
import type { PolicySettings } from "./TrustPolicyEngine";
import { isPathInWorkspace } from "./workspacePathUtils";
import type {
  ActionDecision,
  AutonomyMode,
  BlueprintPlanningMode,
  CommandZone,
  MissionAutonomyPolicy,
  PathZone,
  PolicyConfigGet
} from "./missionAutonomyPolicyTypes";

const CFG_PREFIX = "myAi.missions.autonomy.";

function normalizeAutonomyMode(raw: string): AutonomyMode {
  if (raw === "strict") return "strict";
  if (raw === "workspace_autonomous") return "workspace_autonomous";
  if (raw === "structured_autonomous") return "structured_autonomous";
  return "workspace_coder";
}

export function loadMissionAutonomyPolicy(get: PolicyConfigGet): MissionAutonomyPolicy {
  const mode = normalizeAutonomyMode(get<string>(`${CFG_PREFIX}mode`, "workspace_coder"));
  const blueprintPlanning = get<BlueprintPlanningMode>(`${CFG_PREFIX}blueprintPlanning`, "optional");
  const protectedPathGlobs = readStringArray(get, `${CFG_PREFIX}protectedPathGlobs`, []);
  const blockedPathGlobs = readStringArray(get, `${CFG_PREFIX}blockedPathGlobs`, []);
  const extPol = get<string>(`${CFG_PREFIX}extensionCoreMutationPolicy`, "require_approval");
  const extensionCoreMutationPolicy: "deny" | "require_approval" =
    extPol === "deny" ? "deny" : "require_approval";

  return {
    mode,
    blueprintPlanning,
    autoApproveWorkspaceWrites: get<boolean>(`${CFG_PREFIX}autoApproveWorkspaceWrites`, true),
    autoApproveWorkspaceDeletes: get<boolean>(`${CFG_PREFIX}autoApproveWorkspaceDeletes`, true),
    autoApproveWorkspaceSafeCommands: get<boolean>(`${CFG_PREFIX}autoApproveWorkspaceSafeCommands`, true),
    protectedPathGlobs,
    blockedPathGlobs,
    extensionCoreMutationPolicy,
    restrictToWorkspace: true,
    allowTerminal: true,
    autoApproveInfrastructureMutations: get<boolean>(`${CFG_PREFIX}autoApproveInfrastructureMutations`, false)
  };
}

function readStringArray(get: PolicyConfigGet, key: string, fallback: string[]): string[] {
  const raw = get<unknown>(key, fallback);
  if (!Array.isArray(raw)) return fallback;
  return raw.map((x) => String(x)).filter((s) => s.trim().length > 0);
}

function normalizeFsPath(p: string): string {
  return path.normalize(p).replace(/\\/g, "/");
}

function workspaceRelPath(absPath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, absPath);
  return normalizeFsPath(rel);
}

/** True when absPath is under prefix (both normalized). */
function isUnderRoot(absPath: string, root: string): boolean {
  const a = normalizeFsPath(absPath);
  const r = normalizeFsPath(root);
  return a === r || a.startsWith(r + path.sep) || a.startsWith(r + "/");
}

/**
 * Extension-core = under extension install dir but not under the opened workspace root
 * (avoids classifying every file as extension_core when developing with workspace = extension folder).
 */
export function isExtensionCorePath(
  absPath: string,
  extensionRoot: string | undefined,
  workspaceRoot: string | undefined
): boolean {
  if (!extensionRoot) return false;
  if (!isUnderRoot(absPath, extensionRoot)) return false;
  if (workspaceRoot && isUnderRoot(absPath, workspaceRoot)) return false;
  return true;
}

export function matchesWorkspaceRelativeGlob(relPath: string, patternRaw: string): boolean {
  const pat = normalizeFsPath(patternRaw.trim().replace(/^\.\//, ""));
  if (!pat) return false;
  const rel = normalizeFsPath(relPath);
  if (pat.endsWith("/**")) {
    const prefix = pat.slice(0, -3);
    return rel === prefix || rel.startsWith(prefix + "/");
  }
  return rel === pat;
}

function matchesAnyGlob(relPath: string, globs: string[]): boolean {
  for (const g of globs) {
    if (matchesWorkspaceRelativeGlob(relPath, g)) return true;
  }
  return false;
}

export function classifyPathZone(
  resolvedAbsPath: string,
  workspaceRoot: string | undefined,
  extensionRoot: string | undefined,
  autonomy: MissionAutonomyPolicy
): { zone: PathZone; rel?: string; recoverySpineProtected?: boolean } {
  if (!workspaceRoot) {
    if (isExtensionCorePath(resolvedAbsPath, extensionRoot, undefined)) {
      return { zone: "extension_core" };
    }
    return { zone: "outside_workspace" };
  }

  const rootNorm = normalizeFsPath(workspaceRoot);
  const absNorm = normalizeFsPath(resolvedAbsPath);

  if (!isPathInWorkspace(workspaceRoot, resolvedAbsPath)) {
    if (isExtensionCorePath(resolvedAbsPath, extensionRoot, workspaceRoot)) {
      return { zone: "extension_core" };
    }
    return { zone: "outside_workspace", rel: absNorm };
  }

  const rel = workspaceRelPath(absNorm, rootNorm);

  if (matchesAnyGlob(rel, autonomy.blockedPathGlobs)) {
    return { zone: "workspace_blocked", rel };
  }

  const spine = classifyRecoverySpineTarget(resolvedAbsPath);
  if (spine.protected) {
    return { zone: "workspace_protected", rel: spine.rel || rel, recoverySpineProtected: true };
  }

  if (matchesAnyGlob(rel, autonomy.protectedPathGlobs)) {
    return { zone: "workspace_protected", rel, recoverySpineProtected: false };
  }

  return { zone: "workspace_open", rel };
}

/** Shell commands that must not run autonomously (host-risk). */
const HOST_RISK_PATTERNS: RegExp[] = [
  /\bsudo\b/i,
  /\bsu\s+[/-]/i,
  /\bssh\b/i,
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)*\/\s*$/i,
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)*\/[^/\s]/i,
  /\bmkfs\./i,
  /\bdd\s+if=/i,
  />\s*\/dev\/(sd|nvme|hd)/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/i,
  /\bchmod\s+[-+]?[rwxXst,0-7]+\s+\//i,
  /\bchown\s+[^/]+\s+\//i,
  /\bwget\s+https?:/i,
  /\bcurl\s+[^|]*\|\s*(ba)?sh\b/i,
  /\bpowershell(\.exe)?\s+.*-enc(odedcommand)?/i
];

export function classifyCommandZone(command: string): CommandZone {
  const c = String(command || "");
  for (const p of HOST_RISK_PATTERNS) {
    if (p.test(c)) return "host_risk";
  }
  return "workspace_safe";
}

function legacyWriteRequiresApproval(settings: PolicySettings, inWorkspace: boolean): boolean {
  return (
    settings.requireApprovalForWrite && (!inWorkspace || settings.requireApprovalForInWorkspaceWrites)
  );
}

function strictPathMutationDecision(
  zone: PathZone,
  settings: PolicySettings,
  inWorkspace: boolean,
  recoverySpineProtected: boolean | undefined,
  extensionCoreMutationPolicy: "deny" | "require_approval"
): ActionDecision {
  if (zone === "outside_workspace") {
    return { kind: "deny", reason: "Path is outside workspace (strict policy)." };
  }
  if (zone === "workspace_blocked") {
    return { kind: "deny", reason: "Path matches a blocked-path glob." };
  }
  if (zone === "extension_core") {
    if (extensionCoreMutationPolicy === "deny") {
      return { kind: "deny", reason: "Extension-core path mutation is denied by policy." };
    }
    return {
      kind: "require_approval",
      reason: "Extension-core path mutation requires operator approval.",
      recoverySpineProtected: false
    };
  }
  if (zone === "workspace_protected") {
    return {
      kind: "require_approval",
      reason: "Protected path (recovery spine or autonomy protected glob) requires approval.",
      recoverySpineProtected: Boolean(recoverySpineProtected)
    };
  }
  if (legacyWriteRequiresApproval(settings, inWorkspace)) {
    return { kind: "require_approval", reason: "Strict mode: write/delete/rename requires approval (legacy tool settings)." };
  }
  return { kind: "allow", reason: "Strict mode: mutation allowed without approval." };
}

function workspaceCoderPathMutationDecision(
  zone: PathZone,
  kind: "write" | "delete",
  autonomy: MissionAutonomyPolicy,
  recoverySpineProtected: boolean | undefined,
  extensionCoreMutationPolicy: "deny" | "require_approval"
): ActionDecision {
  if (zone === "outside_workspace") {
    return { kind: "deny", reason: "Path is outside workspace." };
  }
  if (zone === "workspace_blocked") {
    return { kind: "deny", reason: "Path matches a blocked-path glob." };
  }
  if (zone === "extension_core") {
    if (extensionCoreMutationPolicy === "deny") {
      return { kind: "deny", reason: "Extension-core path mutation is denied by policy." };
    }
    return {
      kind: "require_approval",
      reason: "Extension-core path mutation requires operator approval.",
      recoverySpineProtected: false
    };
  }
  if (zone === "workspace_protected") {
    return {
      kind: "require_approval",
      reason: "Protected path requires operator approval.",
      recoverySpineProtected: Boolean(recoverySpineProtected)
    };
  }
  const auto =
    kind === "delete" ? autonomy.autoApproveWorkspaceDeletes : autonomy.autoApproveWorkspaceWrites;
  if (auto) {
    return { kind: "allow", reason: "Workspace coder mode: ordinary workspace mutation auto-approved." };
  }
  return { kind: "require_approval", reason: "Autonomy auto-approve for this mutation kind is disabled." };
}

export function evaluatePathRead(
  resolvedPath: string,
  workspaceRoot: string | undefined,
  extensionRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: PolicySettings
): ActionDecision {
  if (autonomy.restrictToWorkspace && workspaceRoot && !isPathInWorkspace(workspaceRoot, resolvedPath)) {
    if (isExtensionCorePath(resolvedPath, extensionRoot, workspaceRoot)) {
      return { kind: "allow", reason: "Read under extension bundle (outside workspace root)." };
    }
    return { kind: "deny", reason: `Path is outside workspace: ${resolvedPath}` };
  }
  const { zone, rel } = classifyPathZone(resolvedPath, workspaceRoot, extensionRoot, autonomy);
  if (zone === "workspace_blocked" && rel && matchesAnyGlob(rel, autonomy.blockedPathGlobs)) {
    return { kind: "deny", reason: "Path matches blocked glob (read denied)." };
  }
  return { kind: "allow", reason: "Read permitted." };
}

export function evaluatePathWrite(
  resolvedPath: string,
  workspaceRoot: string | undefined,
  extensionRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: PolicySettings
): ActionDecision {
  const inWorkspace = Boolean(workspaceRoot && isPathInWorkspace(workspaceRoot, resolvedPath));
  const { zone, recoverySpineProtected } = classifyPathZone(resolvedPath, workspaceRoot, extensionRoot, autonomy);

  if (autonomy.mode === "strict") {
    return strictPathMutationDecision(zone, settings, inWorkspace, recoverySpineProtected, autonomy.extensionCoreMutationPolicy);
  }
  return workspaceCoderPathMutationDecision(zone, "write", autonomy, recoverySpineProtected, autonomy.extensionCoreMutationPolicy);
}

export function evaluatePathDelete(
  resolvedPath: string,
  workspaceRoot: string | undefined,
  extensionRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: PolicySettings
): ActionDecision {
  const inWorkspace = Boolean(workspaceRoot && isPathInWorkspace(workspaceRoot, resolvedPath));
  const { zone, recoverySpineProtected } = classifyPathZone(resolvedPath, workspaceRoot, extensionRoot, autonomy);

  if (autonomy.mode === "strict") {
    return strictPathMutationDecision(zone, settings, inWorkspace, recoverySpineProtected, autonomy.extensionCoreMutationPolicy);
  }
  return workspaceCoderPathMutationDecision(zone, "delete", autonomy, recoverySpineProtected, autonomy.extensionCoreMutationPolicy);
}

export function evaluatePathRename(
  resolvedFrom: string,
  resolvedTo: string,
  workspaceRoot: string | undefined,
  extensionRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: PolicySettings
): ActionDecision {
  const a = evaluatePathDelete(resolvedFrom, workspaceRoot, extensionRoot, autonomy, settings);
  const b = evaluatePathWrite(resolvedTo, workspaceRoot, extensionRoot, autonomy, settings);
  if (a.kind === "deny" || b.kind === "deny") {
    return {
      kind: "deny",
      reason: [a.kind === "deny" ? a.reason : "", b.kind === "deny" ? b.reason : ""].filter(Boolean).join(" | ")
    };
  }
  if (a.kind === "require_approval" || b.kind === "require_approval") {
    const spine = Boolean(a.recoverySpineProtected || b.recoverySpineProtected);
    return {
      kind: "require_approval",
      reason: "Rename involves a path that requires approval (source and/or destination).",
      recoverySpineProtected: spine
    };
  }
  return { kind: "allow", reason: "Rename permitted." };
}

export type ShellInvocationKind = "agent" | "git_or_infra";

export function evaluateRunCommand(
  command: string,
  cwd: string | undefined,
  workspaceRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: PolicySettings,
  opts?: { shellInvocationKind?: ShellInvocationKind }
): ActionDecision {
  const kind = opts?.shellInvocationKind ?? "agent";
  if (!autonomy.allowTerminal) {
    return { kind: "deny", reason: "Command execution disabled by policy (myAi.tools.allowTerminal)." };
  }
  const cz = classifyCommandZone(command);
  if (cz === "host_risk") {
    return { kind: "deny", reason: "Host-risk command pattern detected (central policy)." };
  }
  if (autonomy.restrictToWorkspace && cwd && workspaceRoot) {
    const cwdAbs = path.resolve(cwd);
    if (!isPathInWorkspace(workspaceRoot, cwdAbs)) {
      return { kind: "deny", reason: "Working directory is outside workspace." };
    }
  }
  if (autonomy.mode === "strict") {
    if (settings.requireApprovalForTerminal) {
      return { kind: "require_approval", reason: "Strict mode: terminal/command requires approval." };
    }
    return { kind: "allow", reason: "Strict mode: command allowed without approval." };
  }
  if (kind === "git_or_infra" && !autonomy.autoApproveInfrastructureMutations) {
    return {
      kind: "require_approval",
      reason: "Infrastructure / VCS mutating tool requires approval (myAi.missions.autonomy.autoApproveInfrastructureMutations is false)."
    };
  }
  if (autonomy.autoApproveWorkspaceSafeCommands) {
    return { kind: "allow", reason: "Workspace coder mode: safe workspace command auto-approved." };
  }
  return { kind: "require_approval", reason: "Autonomy auto-approve for commands is disabled." };
}

export function evaluateRunTerminal(
  command: string,
  workspaceRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: PolicySettings
): ActionDecision {
  return evaluateRunCommand(command, workspaceRoot, workspaceRoot, autonomy, settings);
}

/** Test / CLI hook: build policy from explicit fields. */
export function mayRead(
  resolvedPath: string,
  workspaceRoot: string | undefined,
  extensionRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: import("./TrustPolicyEngine").PolicySettings
): boolean {
  return evaluatePathRead(resolvedPath, workspaceRoot, extensionRoot, autonomy, settings).kind === "allow";
}

export function mayWrite(
  resolvedPath: string,
  workspaceRoot: string | undefined,
  extensionRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: import("./TrustPolicyEngine").PolicySettings
): boolean {
  return evaluatePathWrite(resolvedPath, workspaceRoot, extensionRoot, autonomy, settings).kind === "allow";
}

export function mayDelete(
  resolvedPath: string,
  workspaceRoot: string | undefined,
  extensionRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: import("./TrustPolicyEngine").PolicySettings
): boolean {
  return evaluatePathDelete(resolvedPath, workspaceRoot, extensionRoot, autonomy, settings).kind === "allow";
}

export function mayRename(
  from: string,
  to: string,
  workspaceRoot: string | undefined,
  extensionRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: import("./TrustPolicyEngine").PolicySettings
): boolean {
  return evaluatePathRename(from, to, workspaceRoot, extensionRoot, autonomy, settings).kind === "allow";
}

export function mayRunCommand(
  command: string,
  cwd: string | undefined,
  workspaceRoot: string | undefined,
  autonomy: MissionAutonomyPolicy,
  settings: import("./TrustPolicyEngine").PolicySettings,
  opts?: { shellInvocationKind?: ShellInvocationKind }
): boolean {
  return evaluateRunCommand(command, cwd, workspaceRoot, autonomy, settings, opts).kind === "allow";
}

export function missionAutonomyPolicyForTest(partial: Partial<MissionAutonomyPolicy>): MissionAutonomyPolicy {
  const base: MissionAutonomyPolicy = {
    mode: "workspace_coder",
    blueprintPlanning: "optional",
    autoApproveWorkspaceWrites: true,
    autoApproveWorkspaceDeletes: true,
    autoApproveWorkspaceSafeCommands: true,
    protectedPathGlobs: [],
    blockedPathGlobs: [],
    extensionCoreMutationPolicy: "require_approval",
    restrictToWorkspace: true,
    allowTerminal: true,
    autoApproveInfrastructureMutations: false
  };
  return { ...base, ...partial };
}
