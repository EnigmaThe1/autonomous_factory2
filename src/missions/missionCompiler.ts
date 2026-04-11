import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { trimText } from "../util";
import { classifyPathZone, loadMissionAutonomyPolicy } from "../security/missionAutonomyPolicy";
import { isPathInWorkspace } from "../security/workspacePathUtils";
import type {
  Mission,
  MissionCompiledContract,
  MissionCompilerFinding,
  MissionCompilerPathReference,
  MissionCompilerPathRole
} from "../types";
import { normalizeWorkspaceRelPath } from "./missionReviewReadScope";

const PATH_TOKEN_RE =
  /(?:^|[\s`'"(])((?:\/?[\w.-]+)+(?:\/[\w.-]+)+(?:\/[\w.-]+)*(?:\.[A-Za-z0-9_-]+)?\/?)(?=[\s`'"),:;]|$)/g;
const INPUT_HINT_RE =
  /\b(read|review|inspect|reference|use|using|based on|from|input|context|open tab|active file|look at|analyze)\b/i;
const OUTPUT_HINT_RE =
  /\b(write|create|generate|produce|emit|save|update|modify|edit|output|deliver|place|build|add|under)\b/i;
const CONSTRAINT_HINT_RE =
  /\b(do not|don't|must not|preserve|keep|avoid|never|without)\b/i;
const SUCCESS_HINT_RE = /\b(success criteria|acceptance criteria|required deliverables|done only when|required validations)\b/i;
const OUTPUT_INTENT_HINT_RE = /\b(write|create|generate|produce|deliver|output|artifact|report|matrix|docs|file)\b/i;
const URL_PREFIX_RE = /^(?:https?:|app:\/\/|plugin:\/\/)/i;
const execFileAsync = promisify(execFile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function uniqueStrings(value: unknown, limit = 128): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

function sanitizeCompilerPathReference(value: unknown): MissionCompilerPathReference | undefined {
  if (!isRecord(value)) return undefined;
  const rawPath = asString(value.rawPath).trim();
  if (!rawPath) return undefined;
  const role = value.role === "input" || value.role === "output" || value.role === "ambiguous" ? value.role : "ambiguous";
  const existence =
    value.existence === "exists" ||
    value.existence === "corrected_exists" ||
    value.existence === "planned_output" ||
    value.existence === "unresolved"
      ? value.existence
      : "unresolved";
  const policyZone =
    value.policyZone === "workspace_open" ||
    value.policyZone === "workspace_protected" ||
    value.policyZone === "workspace_blocked" ||
    value.policyZone === "outside_workspace" ||
    value.policyZone === "extension_core"
      ? value.policyZone
      : undefined;
  return {
    rawPath,
    normalizedPath: asOptionalString(value.normalizedPath),
    role,
    existence,
    evidence: asString(value.evidence),
    correctionKind: asOptionalString(value.correctionKind),
    policyZone
  };
}

function sanitizeCompilerFinding(value: unknown): MissionCompilerFinding | undefined {
  if (!isRecord(value)) return undefined;
  const code = asString(value.code).trim();
  const summary = asString(value.summary).trim();
  if (!code || !summary) return undefined;
  const severity = value.severity === "info" || value.severity === "warn" || value.severity === "error" ? value.severity : "warn";
  const resolution =
    value.resolution === "safe_auto_resolved" ||
    value.resolution === "conservative_default" ||
    value.resolution === "needs_attention" ||
    value.resolution === "blocking"
      ? value.resolution
      : "needs_attention";
  return {
    code,
    severity,
    resolution,
    summary,
    detail: asOptionalString(value.detail),
    affectedPath: asOptionalString(value.affectedPath),
    correctedPath: asOptionalString(value.correctedPath)
  };
}

function normalizePromptLine(raw: string): string {
  return String(raw || "").trim();
}

function normalizePathToken(raw: string): string | undefined {
  const trimmed = String(raw || "")
    .trim()
    .replace(/^[("'`]+/, "")
    .replace(/[),:;`"']+$/, "")
    .replace(/\\/g, "/");
  if (!trimmed || trimmed.includes("..") || URL_PREFIX_RE.test(trimmed)) return undefined;
  return trimmed;
}

function classifyLinePathRole(line: string): MissionCompilerPathRole {
  const input = INPUT_HINT_RE.test(line);
  const output = OUTPUT_HINT_RE.test(line);
  if (input && output) return "ambiguous";
  if (output) return "output";
  if (input) return "input";
  return "ambiguous";
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.stat(absPath);
    return true;
  } catch {
    return false;
  }
}

async function readTopLevelEntries(workspaceRoot: string | undefined): Promise<string[]> {
  if (!workspaceRoot) return [];
  try {
    const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
    return entries.map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function discoverRepoTruthRoot(workspaceRoot: string | undefined): Promise<string | undefined> {
  const cwd = workspaceRoot || process.cwd();
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
    const resolved = String(stdout || "").trim();
    return resolved || workspaceRoot;
  } catch {
    return workspaceRoot;
  }
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function extractSectionLines(prompt: string, headerRe: RegExp): string[] {
  const out: string[] = [];
  const lines = prompt.split(/\r?\n/);
  let active = false;
  for (const line of lines) {
    if (headerRe.test(line)) {
      active = true;
      continue;
    }
    if (active && /^\s*[A-Z][\w /-]+:\s*$/.test(line)) break;
    if (active && /^\s*##\s+/.test(line)) break;
    if (active && !line.trim()) {
      if (out.length > 0) break;
      continue;
    }
    if (active) out.push(line.trim());
  }
  return out.filter(Boolean);
}

function extractBullets(prompt: string, headerPattern: string): string[] {
  const section = extractSectionLines(prompt, new RegExp(`^\\s*${headerPattern}\\s*$`, "i"));
  const bullets = section
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim())
    .filter(Boolean);
  return unique(bullets).slice(0, 24);
}

function inferNormalizedObjective(mission: Mission): string {
  const objectiveLines =
    extractSectionLines(mission.prompt, /^\s*(?:Authoritative objective|Primary objective|Objective):\s*$/i) ||
    [];
  if (objectiveLines.length) return trimText(objectiveLines.join(" "), 600);
  const firstParagraph = mission.prompt
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean);
  return trimText(firstParagraph || mission.title, 600);
}

function inferNormalizedConstraints(mission: Mission): string[] {
  const fromSection = extractBullets(mission.prompt, "(?:Canonical architecture constraints|Operating rules|Core design principle|Safety boundaries)");
  if (fromSection.length) return fromSection.slice(0, 24);
  const fromLines = mission.prompt
    .split(/\r?\n/)
    .map(normalizePromptLine)
    .filter((line) => CONSTRAINT_HINT_RE.test(line))
    .slice(0, 24);
  return unique(fromLines);
}

function inferSuccessCriteria(mission: Mission): string[] {
  const explicit = extractBullets(mission.prompt, "(?:Success criteria|Acceptance criteria|Required validations|Required deliverables)");
  if (explicit.length) return explicit.slice(0, 24);
  const lines = mission.prompt
    .split(/\r?\n/)
    .map(normalizePromptLine)
    .filter((line) => SUCCESS_HINT_RE.test(line) || /\b(done only when|must|should)\b/i.test(line))
    .slice(0, 16);
  return unique(lines);
}

function inferScopeLines(mission: Mission): string[] {
  const scope = extractBullets(mission.prompt, "(?:Mission scope|Scope|Focus especially on|Required investigation tasks)");
  if (scope.length) return scope.slice(0, 24);
  return unique(
    mission.prompt
      .split(/\r?\n/)
      .map(normalizePromptLine)
      .filter(Boolean)
      .filter((line) => !CONSTRAINT_HINT_RE.test(line))
      .slice(0, 12)
  );
}

function commonOutputRoot(paths: readonly string[]): string | undefined {
  const split = paths
    .map((p) => p.split("/").filter(Boolean))
    .filter((parts) => parts.length >= 2);
  if (split.length < 2) return undefined;
  const prefix: string[] = [];
  for (let idx = 0; idx < split[0].length; idx += 1) {
    const segment = split[0][idx];
    if (!segment) break;
    if (split.every((parts) => parts[idx] === segment)) {
      prefix.push(segment);
      continue;
    }
    break;
  }
  return prefix.length >= 2 ? prefix.join("/") : undefined;
}

function describeFindings(findings: readonly MissionCompilerFinding[]): string {
  if (!findings.length) return "No compiler findings.";
  return findings
    .slice(0, 6)
    .map((finding) => `${finding.code}: ${finding.summary}`)
    .join(" | ");
}

function buildCandidateCorrections(
  rawPath: string,
  repoTruthRoot: string | undefined,
  workspaceName: string | undefined,
  topLevelEntries: readonly string[]
): string[] {
  const out = new Set<string>();
  const normalized = normalizePathToken(rawPath);
  if (!normalized) return [];

  if (path.isAbsolute(normalized)) {
    if (repoTruthRoot && isPathInWorkspace(repoTruthRoot, normalized)) {
      const rel = normalizeWorkspaceRelPath(path.relative(repoTruthRoot, normalized));
      if (rel) out.add(rel);
    }
    return [...out];
  }

  const rel = normalizeWorkspaceRelPath(normalized);
  if (rel) out.add(rel);

  const repoBaseName = repoTruthRoot ? path.basename(repoTruthRoot) : undefined;
  const folderNames = unique([repoBaseName, workspaceName].filter(Boolean) as string[]);
  for (const baseName of folderNames) {
    if (rel?.startsWith(`${baseName}/`)) {
      out.add(rel.slice(baseName.length + 1));
    }
    if (rel?.includes(`/${baseName}/`)) {
      const idx = rel.indexOf(`/${baseName}/`);
      out.add(rel.slice(idx + baseName.length + 2));
    }
  }

  if (rel) {
    for (const entry of topLevelEntries) {
      if (rel.startsWith(`${entry}/`)) {
        out.add(rel.slice(entry.length + 1));
      }
      const marker = `/${entry}/`;
      if (rel.includes(marker)) {
        const idx = rel.indexOf(marker);
        out.add(rel.slice(idx + 1));
      }
    }
  }

  return [...out].filter(Boolean);
}

async function resolveReference(args: {
  rawPath: string;
  role: MissionCompilerPathRole;
  line: string;
  repoTruthRoot: string | undefined;
  workspaceName: string | undefined;
  topLevelEntries: readonly string[];
}): Promise<MissionCompilerPathReference> {
  const { rawPath, role, line, repoTruthRoot, workspaceName, topLevelEntries } = args;
  const correctionCandidates = buildCandidateCorrections(rawPath, repoTruthRoot, workspaceName, topLevelEntries);

  if (path.isAbsolute(rawPath) && (!repoTruthRoot || !isPathInWorkspace(repoTruthRoot, rawPath))) {
    return {
      rawPath,
      role,
      existence: "unresolved",
      evidence: trimText(line, 240),
      policyZone: "outside_workspace"
    };
  }

  for (const candidate of correctionCandidates) {
    if (!repoTruthRoot) break;
    const abs = path.join(repoTruthRoot, candidate);
    if (await pathExists(abs)) {
      return {
        rawPath,
        normalizedPath: candidate,
        role,
        existence: candidate === normalizeWorkspaceRelPath(rawPath) ? "exists" : "corrected_exists",
        evidence: trimText(line, 240),
        correctionKind: candidate === normalizeWorkspaceRelPath(rawPath) ? undefined : "safe_workspace_suffix_match"
      };
    }
  }

  if (role === "output") {
    const planned = correctionCandidates.find((candidate) => {
      const dir = path.dirname(candidate);
      if (dir === ".") return topLevelEntries.includes(candidate.split("/")[0] || "");
      return topLevelEntries.includes(candidate.split("/")[0] || "") || dir === "" || dir === candidate;
    }) || correctionCandidates[0];
    if (planned) {
      return {
        rawPath,
        normalizedPath: planned,
        role,
        existence: "planned_output",
        evidence: trimText(line, 240),
        correctionKind: planned === normalizeWorkspaceRelPath(rawPath) ? undefined : "safe_workspace_suffix_match"
      };
    }
  }

  return {
    rawPath,
    normalizedPath: correctionCandidates[0],
    role,
    existence: "unresolved",
    evidence: trimText(line, 240),
    correctionKind: correctionCandidates[0] && correctionCandidates[0] !== normalizeWorkspaceRelPath(rawPath)
      ? "safe_workspace_suffix_match"
      : undefined
  };
}

function buildPolicyZoneForReference(
  ref: MissionCompilerPathReference,
  repoTruthRoot: string | undefined,
  workspaceRoot: string | undefined
): MissionCompilerPathReference {
  if (!repoTruthRoot || !workspaceRoot || !ref.normalizedPath || ref.role !== "output") return ref;
  const autonomy = loadMissionAutonomyPolicy(vscode.workspace.getConfiguration().get.bind(vscode.workspace.getConfiguration()));
  const abs = path.join(repoTruthRoot, ref.normalizedPath);
  const zone = classifyPathZone(abs, workspaceRoot, undefined, autonomy).zone;
  return { ...ref, policyZone: zone };
}

function buildContractFindings(
  refs: readonly MissionCompilerPathReference[],
  observedRefs: readonly MissionCompilerPathReference[] = refs
): MissionCompilerFinding[] {
  const findings: MissionCompilerFinding[] = [];
  for (const ref of refs) {
    if (ref.existence === "corrected_exists" || ref.existence === "planned_output") {
      findings.push({
        code: "path_normalized",
        severity: "info",
        resolution: "safe_auto_resolved",
        summary: `Normalized mission path '${ref.rawPath}' to '${ref.normalizedPath}'.`,
        affectedPath: ref.rawPath,
        correctedPath: ref.normalizedPath
      });
    }
    if (ref.existence === "unresolved") {
      findings.push({
        code: "path_unresolved",
        severity: ref.role === "output" ? "error" : "warn",
        resolution: ref.role === "output" ? "blocking" : "needs_attention",
        summary: `Could not reconcile mission path '${ref.rawPath}' against workspace truth.`,
        detail: ref.evidence,
        affectedPath: ref.rawPath
      });
    }
    if (ref.role === "output" && ref.policyZone === "workspace_blocked") {
      findings.push({
        code: "output_hits_blocked_path",
        severity: "error",
        resolution: "blocking",
        summary: `Mission output path '${ref.normalizedPath || ref.rawPath}' falls under a blocked workspace policy zone.`,
        affectedPath: ref.normalizedPath || ref.rawPath
      });
    }
    if (ref.role === "output" && ref.policyZone === "workspace_protected") {
      findings.push({
        code: "output_hits_protected_path",
        severity: "warn",
        resolution: "conservative_default",
        summary: `Mission output path '${ref.normalizedPath || ref.rawPath}' is under a protected workspace path and will require approval.`,
        affectedPath: ref.normalizedPath || ref.rawPath
      });
    }
    if (ref.role === "output" && ref.policyZone === "outside_workspace") {
      findings.push({
        code: "output_outside_workspace",
        severity: "error",
        resolution: "blocking",
        summary: `Mission output path '${ref.rawPath}' is outside the workspace and cannot be executed autonomously.`,
        affectedPath: ref.rawPath
      });
    }
  }

  const byPath = new Map<string, Set<MissionCompilerPathRole>>();
  for (const ref of observedRefs) {
    const key = ref.normalizedPath || ref.rawPath;
    const roles = byPath.get(key) || new Set<MissionCompilerPathRole>();
    roles.add(ref.role);
    byPath.set(key, roles);
  }
  for (const [key, roles] of byPath.entries()) {
    if (roles.has("input") && roles.has("output")) {
      findings.push({
        code: "path_role_conflict",
        severity: "warn",
        resolution: "needs_attention",
        summary: `Mission path '${key}' appears as both read-only input and intended output.`,
        affectedPath: key
      });
    }
  }

  return findings;
}

function buildCompilerMetrics(contract: Omit<MissionCompiledContract, "metrics">): MissionCompiledContract["metrics"] {
  return {
    pathReferencesDetected: contract.pathReferences.length,
    pathCorrectionsApplied: contract.pathReferences.filter((ref) => Boolean(ref.correctionKind)).length,
    inputPathsClassified: contract.inputPaths.length,
    outputPathsClassified: contract.outputPaths.length,
    ambiguousPathsClassified: contract.ambiguousPaths.length,
    contradictionsFound: contract.findings.filter((finding) => finding.code === "path_role_conflict").length,
    assumptionsFilled: contract.findings.filter((finding) => finding.resolution === "conservative_default").length,
    blockingIssues: contract.findings.filter((finding) => finding.resolution === "blocking").length,
    unresolvedPaths: contract.pathReferences.filter((ref) => ref.existence === "unresolved").length
  };
}

export function normalizeMissionCompiledContract(contract: unknown): MissionCompiledContract | undefined {
  if (!isRecord(contract)) return undefined;
  const pathReferences = Array.isArray(contract.pathReferences)
    ? contract.pathReferences.map((entry) => sanitizeCompilerPathReference(entry)).filter(Boolean) as MissionCompilerPathReference[]
    : [];
  const findings = Array.isArray(contract.findings)
    ? contract.findings.map((entry) => sanitizeCompilerFinding(entry)).filter(Boolean) as MissionCompilerFinding[]
    : [];
  const policyBinding = isRecord(contract.policyBinding) ? contract.policyBinding : undefined;
  const contractBase: Omit<MissionCompiledContract, "metrics"> = {
    compilerVersion: asString(contract.compilerVersion, "unknown"),
    compiledAt: asFiniteNumber(contract.compiledAt, Date.now()),
    normalizedObjective: asString(contract.normalizedObjective),
    normalizedScope: uniqueStrings(contract.normalizedScope),
    normalizedConstraints: uniqueStrings(contract.normalizedConstraints),
    successCriteria: uniqueStrings(contract.successCriteria),
    inputPaths: uniqueStrings(contract.inputPaths),
    outputPaths: uniqueStrings(contract.outputPaths),
    ambiguousPaths: uniqueStrings(contract.ambiguousPaths),
    outputRootHint: asOptionalString(contract.outputRootHint),
    pathReferences,
    findings,
    unresolvedAmbiguities: uniqueStrings(contract.unresolvedAmbiguities),
    policyBinding: {
      workspaceRootName: asOptionalString(policyBinding?.workspaceRootName),
      workspaceRootPath: asOptionalString(policyBinding?.workspaceRootPath),
      autonomyMode: asString(policyBinding?.autonomyMode),
      blueprintMode: asString(policyBinding?.blueprintMode),
      restrictToWorkspace: Boolean(policyBinding?.restrictToWorkspace),
      extensionCoreMutationPolicy:
        policyBinding?.extensionCoreMutationPolicy === "deny" ||
        policyBinding?.extensionCoreMutationPolicy === "require_approval"
          ? policyBinding.extensionCoreMutationPolicy
          : "deny",
      protectedPathGlobs: uniqueStrings(policyBinding?.protectedPathGlobs),
      blockedPathGlobs: uniqueStrings(policyBinding?.blockedPathGlobs)
    },
    repoTopLevelEntries: uniqueStrings(contract.repoTopLevelEntries)
  };

  return {
    ...contractBase,
    metrics: buildCompilerMetrics(contractBase)
  };
}

export async function compileMissionPreflight(mission: Mission): Promise<MissionCompiledContract> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder?.uri.fsPath;
  const workspaceName = workspaceFolder?.name;
  const repoTruthRoot = await discoverRepoTruthRoot(workspaceRoot);
  const topLevelEntries = await readTopLevelEntries(repoTruthRoot);
  const autonomy = loadMissionAutonomyPolicy(vscode.workspace.getConfiguration().get.bind(vscode.workspace.getConfiguration()));
  const blueprintMode = String(vscode.workspace.getConfiguration().get<unknown>("myAi.missions.blueprintMode", "off") || "off");
  const lines = mission.prompt.split(/\r?\n/);
  const rawRefs: Array<{ rawPath: string; role: MissionCompilerPathRole; line: string }> = [];

  for (const line of lines) {
    PATH_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATH_TOKEN_RE.exec(line)) !== null) {
      const token = normalizePathToken(match[1] || match[0]);
      if (!token) continue;
      rawRefs.push({ rawPath: token, role: classifyLinePathRole(line), line });
    }
  }

  const resolvedRefs: MissionCompilerPathReference[] = [];
  for (const candidate of rawRefs) {
        const resolved = await resolveReference({
          ...candidate,
          repoTruthRoot,
          workspaceName,
          topLevelEntries
        });
    resolvedRefs.push(buildPolicyZoneForReference(resolved, repoTruthRoot, workspaceRoot));
  }

  const merged = new Map<string, MissionCompilerPathReference>();
  for (const ref of resolvedRefs) {
    const key = ref.normalizedPath || ref.rawPath;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, ref);
      continue;
    }
    const role: MissionCompilerPathRole =
      existing.role === ref.role ? ref.role : existing.role === "ambiguous" || ref.role === "ambiguous" ? "ambiguous" : "ambiguous";
    const existenceOrder = ["exists", "corrected_exists", "planned_output", "unresolved"] as const;
    const nextExistence =
      existenceOrder.indexOf(ref.existence) < existenceOrder.indexOf(existing.existence) ? ref.existence : existing.existence;
    merged.set(key, {
      ...existing,
      role,
      existence: nextExistence,
      evidence: trimText(`${existing.evidence} | ${ref.evidence}`, 240),
      correctionKind: existing.correctionKind || ref.correctionKind,
      policyZone: existing.policyZone || ref.policyZone
    });
  }

  const pathReferences = [...merged.values()];
  const findings = buildContractFindings(pathReferences, resolvedRefs);
  if (!pathReferences.length && OUTPUT_INTENT_HINT_RE.test(mission.prompt)) {
    findings.push({
      code: "deliverable_semantics_missing",
      severity: "warn",
      resolution: "conservative_default",
      summary: "Mission describes creation or delivery work but does not declare concrete output paths.",
      detail: "The compiler preserved the mission objective but downstream deliverable shaping will remain heuristic."
    });
  }

  const inputPaths = unique(
    pathReferences
      .filter((ref) => ref.role === "input" && ref.normalizedPath)
      .map((ref) => ref.normalizedPath as string)
  );
  const outputPaths = unique(
    pathReferences
      .filter((ref) => ref.role === "output" && ref.normalizedPath)
      .map((ref) => ref.normalizedPath as string)
  );
  const ambiguousPaths = unique(
    pathReferences
      .filter((ref) => ref.role === "ambiguous")
      .map((ref) => ref.normalizedPath || ref.rawPath)
  );
  const unresolvedAmbiguities = unique(
    findings
      .filter((finding) => finding.resolution === "blocking" || finding.resolution === "needs_attention")
      .map((finding) => finding.summary)
  );

  const contractBase: Omit<MissionCompiledContract, "metrics"> = {
    compilerVersion: "phase13_preflight_v1",
    compiledAt: Date.now(),
    normalizedObjective: inferNormalizedObjective(mission),
    normalizedScope: inferScopeLines(mission),
    normalizedConstraints: inferNormalizedConstraints(mission),
    successCriteria: inferSuccessCriteria(mission),
    inputPaths,
    outputPaths,
    ambiguousPaths,
    outputRootHint: commonOutputRoot(outputPaths),
    pathReferences,
    findings,
    unresolvedAmbiguities,
    policyBinding: {
      workspaceRootName: workspaceName,
      workspaceRootPath: workspaceRoot,
      autonomyMode: autonomy.mode,
      blueprintMode,
      restrictToWorkspace: autonomy.restrictToWorkspace,
      extensionCoreMutationPolicy: autonomy.extensionCoreMutationPolicy,
      protectedPathGlobs: autonomy.protectedPathGlobs,
      blockedPathGlobs: autonomy.blockedPathGlobs
    },
    repoTopLevelEntries: topLevelEntries
  };

  return {
    ...contractBase,
    metrics: buildCompilerMetrics(contractBase)
  };
}

export function buildCompiledMissionContractLines(mission: Mission): string[] {
  const contract = mission.compiledContract;
  if (!contract) return [];
  const lines = [
    `COMPILED OBJECTIVE: ${contract.normalizedObjective}`,
    contract.outputRootHint ? `COMPILED OUTPUT ROOT: ${contract.outputRootHint}` : "",
    contract.inputPaths.length ? `READ-ONLY INPUTS: ${contract.inputPaths.join(", ")}` : "",
    contract.outputPaths.length ? `INTENDED OUTPUTS: ${contract.outputPaths.join(", ")}` : "",
    contract.ambiguousPaths.length ? `AMBIGUOUS PATHS: ${contract.ambiguousPaths.join(", ")}` : "",
    contract.findings.length
      ? `COMPILER FINDINGS: ${describeFindings(contract.findings)}`
      : "COMPILER FINDINGS: none."
  ].filter(Boolean);
  return lines;
}

export function compiledMissionContractTexts(mission: Mission): string[] {
  const contract = mission.compiledContract;
  if (!contract) return [];
  return [
    contract.normalizedObjective,
    ...contract.normalizedScope,
    ...contract.normalizedConstraints,
    ...contract.successCriteria,
    ...contract.inputPaths,
    ...contract.outputPaths,
    ...contract.ambiguousPaths
  ].filter(Boolean);
}

export function isCompiledMissionInputPath(mission: Mission, relPath: string | undefined): boolean {
  const normalized = relPath ? normalizeWorkspaceRelPath(relPath) : undefined;
  if (!normalized) return false;
  return Boolean(mission.compiledContract?.inputPaths.includes(normalized));
}

export function isCompiledMissionOutputPath(mission: Mission, relPath: string | undefined): boolean {
  const normalized = relPath ? normalizeWorkspaceRelPath(relPath) : undefined;
  if (!normalized) return false;
  return Boolean(mission.compiledContract?.outputPaths.includes(normalized));
}
