import { MissionAgentRole, type Mission, type ToolCall, type WorkItem } from "../types";

export type ToolEvidenceNecessity = "required" | "preferred" | "optional";
export type ToolEvidenceSourceKind =
  | "artifact_read"
  | "artifact_listing"
  | "workspace_search"
  | "repo_git"
  | "diagnostics"
  | "validation_execution"
  | "unknown";
export type WorkItemEvidenceStrategy = "artifact_scoped" | "repo_scoped" | "mixed";

export interface EvidenceRequirement {
  id: string;
  description: string;
  necessity: ToolEvidenceNecessity;
  primarySources: ToolEvidenceSourceKind[];
  substituteSources: ToolEvidenceSourceKind[];
}

export interface WorkItemEvidenceContract {
  strategy: WorkItemEvidenceStrategy;
  primaryArtifactRoot?: string;
  explicitGitEvidence: boolean;
  requirements: EvidenceRequirement[];
}

export interface ToolFailureEvidenceAssessment {
  strategy: WorkItemEvidenceStrategy;
  primaryArtifactRoot?: string;
  requirementId: string;
  requirementDescription: string;
  necessity: ToolEvidenceNecessity;
  sourceKind: ToolEvidenceSourceKind;
  requirementSatisfied: boolean;
  substituteEvidenceAvailable: boolean;
  handling: "continue_degraded" | "replan" | "block";
  reason: string;
}

const PATH_LIKE =
  /<MISSION_ROOT>\/[\w./-]+\.(?:md|txt|json|ts|tsx|py|yaml|yml|toml)|(?:^|[\s`'"(])((?:\.?\/)?[\w./-]+\.(?:md|txt|json|ts|tsx|py|yaml|yml|toml))(?:\b|$)/gi;
const GIT_POSITIVE_EVIDENCE_RE =
  /\b(use|check|confirm|inspect|review|compare|verify|examine|require|must use|needs?)\b.{0,48}\b(git|git status|git diff|git log|git blame|working tree|repository status|repo status|commit|branch|history|staged|unstaged|uncommitted|patch)\b|\b(git status|git diff|git log|git blame)\b/i;
const ARTIFACT_SCOPED_RE =
  /\b(artifact|deliverable|mission root|current[- ]phase|phase[- ]scoped|phase|final report|review scope|validation scope|root binding|scope audit|phase timing|document-only|artifact-only)\b/i;
const CODE_PATH_RE =
  /(?:^|[\s`'"(])((?:src|lib|app|packages|server|client|web|test|tests)\/[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|cpp|c|h))(?:\b|$)/i;
const CODE_REVIEW_RE =
  /\b(code review|source review|review code|changed files|diff|patch|implementation review|working tree|repo review)\b/i;

function normalizedRole(item: WorkItem): WorkItem["role"] {
  return item.role === MissionAgentRole.Architect
    ? MissionAgentRole.Planner
    : item.role;
}

function collectContractTexts(mission: Mission, item: WorkItem): string[] {
  return [
    item.prompt,
    item.scopeSummary,
    item.validationHint,
    item.validationScopeHint,
    mission.prompt?.slice(0, 12000)
  ].filter((v): v is string => Boolean(v?.trim()));
}

function hasPathLikeReference(texts: readonly string[]): boolean {
  for (const text of texts) {
    PATH_LIKE.lastIndex = 0;
    if (PATH_LIKE.exec(text)) return true;
  }
  return false;
}

function hasArtifactScopedPathReference(texts: readonly string[]): boolean {
  for (const text of texts) {
    PATH_LIKE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATH_LIKE.exec(text)) !== null) {
      const token = String(match[1] || match[0] || "").trim();
      if (!token) continue;
      if (
        token.startsWith("<MISSION_ROOT>/") ||
        token.startsWith("docs/") ||
        /(?:^|\/)(phase_outputs|plans|reviews|evidence|logs|tmp)\//i.test(token) ||
        /\.(?:md|txt|json|yaml|yml|toml)$/i.test(token)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function workItemExplicitlyRequestsGitEvidence(mission: Mission, item: WorkItem): boolean {
  const blob = collectContractTexts(mission, item).join("\n");
  return GIT_POSITIVE_EVIDENCE_RE.test(blob);
}

export function shouldPreferArtifactScopedEvidence(mission: Mission, item: WorkItem): boolean {
  const role = normalizedRole(item);
  if (role !== MissionAgentRole.Reviewer && role !== MissionAgentRole.Validator) return false;
  if (mission.runtime?.resolvedArtifactRootRelative?.trim()) return true;
  const texts = collectContractTexts(mission, item);
  return hasArtifactScopedPathReference(texts) || (hasPathLikeReference(texts) && ARTIFACT_SCOPED_RE.test(texts.join("\n")));
}

function changedFilesBlob(mission: Mission, item: WorkItem): string {
  return [...(mission.filesModified || []), ...(item.changedFiles || [])].join("\n");
}

export function shouldPreferRepositoryHistoryEvidence(mission: Mission, item: WorkItem): boolean {
  const role = normalizedRole(item);
  if (role !== MissionAgentRole.Reviewer && role !== MissionAgentRole.Validator) return false;
  if (shouldPreferArtifactScopedEvidence(mission, item)) return false;
  if (workItemExplicitlyRequestsGitEvidence(mission, item)) return true;
  const blob = [collectContractTexts(mission, item).join("\n"), changedFilesBlob(mission, item)].join("\n");
  return CODE_PATH_RE.test(blob) || CODE_REVIEW_RE.test(blob);
}

export function classifyToolEvidenceSource(call: ToolCall): ToolEvidenceSourceKind {
  if (call.tool.startsWith("git.")) return "repo_git";
  if (call.tool === "readFile") return "artifact_read";
  if (call.tool === "listFiles" || call.tool === "fileTree") return "artifact_listing";
  if (call.tool === "grepSearch" || call.tool === "searchFiles" || call.tool === "findRelevantFiles") {
    return "workspace_search";
  }
  if (call.tool === "getDiagnostics") return "diagnostics";
  if (call.tool === "runTests" || call.tool === "runLinter") return "validation_execution";
  return "unknown";
}

function buildRequirement(
  id: string,
  description: string,
  necessity: ToolEvidenceNecessity,
  primarySources: ToolEvidenceSourceKind[],
  substituteSources: ToolEvidenceSourceKind[] = []
): EvidenceRequirement {
  return {
    id,
    description,
    necessity,
    primarySources: [...new Set(primarySources)],
    substituteSources: [...new Set(substituteSources)]
  };
}

export function buildWorkItemEvidenceContract(mission: Mission, item: WorkItem): WorkItemEvidenceContract {
  const role = normalizedRole(item);
  const explicitGitEvidence = workItemExplicitlyRequestsGitEvidence(mission, item);
  const artifactScoped = shouldPreferArtifactScopedEvidence(mission, item);
  const preferRepoHistory = shouldPreferRepositoryHistoryEvidence(mission, item);
  const strategy: WorkItemEvidenceStrategy = artifactScoped
    ? preferRepoHistory ? "mixed" : "artifact_scoped"
    : preferRepoHistory ? "repo_scoped" : "mixed";
  const requirements: EvidenceRequirement[] = [];

  if (role === MissionAgentRole.Reviewer || role === MissionAgentRole.Validator) {
    requirements.push(
      buildRequirement(
        "direct_scope_evidence",
        artifactScoped
          ? "Review and validation should rely on current mission-root artifacts and scoped file evidence."
          : "Review and validation should rely on direct file evidence from the current task scope.",
        artifactScoped ? "required" : "preferred",
        ["artifact_read", "artifact_listing", "workspace_search"],
        ["diagnostics"]
      )
    );
    requirements.push(
      buildRequirement(
        "repo_history_evidence",
        explicitGitEvidence
          ? "This work item explicitly requires repository-state or history evidence."
          : preferRepoHistory
            ? "Repository-history evidence is helpful for this code-focused review."
            : "Repository-state probes are optional context and should not block artifact-scoped review.",
        explicitGitEvidence ? "required" : preferRepoHistory ? "preferred" : "optional",
        ["repo_git"],
        artifactScoped ? ["artifact_read", "artifact_listing", "workspace_search"] : ["artifact_read", "workspace_search"]
      )
    );
    requirements.push(
      buildRequirement(
        "diagnostic_evidence",
        role === MissionAgentRole.Validator
          ? "Diagnostics are useful corroborating evidence for validator verdicts."
          : "Diagnostics are optional corroboration for reviewer findings.",
        artifactScoped ? "optional" : "preferred",
        ["diagnostics"],
        ["artifact_read", "artifact_listing", "workspace_search"]
      )
    );
  }

  if (role === MissionAgentRole.Validator) {
    requirements.push(
      buildRequirement(
        "validation_execution",
        mission.policy.requireValidationEvidence
          ? "Validation evidence is required before mission completion."
          : "Validation execution is preferred when the repository supports it.",
        mission.policy.requireValidationEvidence ? "required" : "preferred",
        ["validation_execution"],
        mission.policy.requireValidationEvidence ? ["diagnostics"] : ["diagnostics", "artifact_read", "workspace_search"]
      )
    );
  }

  return {
    strategy,
    primaryArtifactRoot: mission.runtime?.resolvedArtifactRootRelative?.trim() || undefined,
    explicitGitEvidence,
    requirements
  };
}

function findRequirementForSource(
  contract: WorkItemEvidenceContract,
  sourceKind: ToolEvidenceSourceKind
): EvidenceRequirement | undefined {
  return (
    contract.requirements.find((req) => req.primarySources.includes(sourceKind)) ||
    contract.requirements.find((req) => req.substituteSources.includes(sourceKind))
  );
}

function sourceKindAvailableUnderContract(
  contract: WorkItemEvidenceContract,
  sourceKind: ToolEvidenceSourceKind
): boolean {
  return contract.requirements.some(
    (req) => req.primarySources.includes(sourceKind) || req.substituteSources.includes(sourceKind)
  );
}

export function assessToolFailureEvidence(args: {
  mission: Mission;
  item: WorkItem;
  call: ToolCall;
  acquiredEvidenceSources?: Iterable<ToolEvidenceSourceKind>;
}): ToolFailureEvidenceAssessment | undefined {
  const contract = buildWorkItemEvidenceContract(args.mission, args.item);
  const sourceKind = classifyToolEvidenceSource(args.call);
  const requirement = findRequirementForSource(contract, sourceKind);
  if (!requirement) return undefined;

  const acquired = new Set(args.acquiredEvidenceSources || []);
  const requirementSatisfied = [...requirement.primarySources, ...requirement.substituteSources].some((src) =>
    acquired.has(src)
  );
  const substituteEvidenceAvailable = [...requirement.primarySources, ...requirement.substituteSources]
    .filter((src) => src !== sourceKind)
    .some((src) => sourceKindAvailableUnderContract(contract, src));

  if (requirement.necessity === "optional") {
    return {
      strategy: contract.strategy,
      primaryArtifactRoot: contract.primaryArtifactRoot,
      requirementId: requirement.id,
      requirementDescription: requirement.description,
      necessity: requirement.necessity,
      sourceKind,
      requirementSatisfied,
      substituteEvidenceAvailable,
      handling: "continue_degraded",
      reason: "This evidence source is optional for the current work-item contract."
    };
  }

  if (requirementSatisfied) {
    return {
      strategy: contract.strategy,
      primaryArtifactRoot: contract.primaryArtifactRoot,
      requirementId: requirement.id,
      requirementDescription: requirement.description,
      necessity: requirement.necessity,
      sourceKind,
      requirementSatisfied,
      substituteEvidenceAvailable,
      handling: "continue_degraded",
      reason: "The underlying evidence requirement is already satisfied by earlier evidence."
    };
  }

  if (substituteEvidenceAvailable) {
    return {
      strategy: contract.strategy,
      primaryArtifactRoot: contract.primaryArtifactRoot,
      requirementId: requirement.id,
      requirementDescription: requirement.description,
      necessity: requirement.necessity,
      sourceKind,
      requirementSatisfied,
      substituteEvidenceAvailable,
      handling: "continue_degraded",
      reason: "Other allowed evidence sources can still satisfy this requirement."
    };
  }

  return {
    strategy: contract.strategy,
    primaryArtifactRoot: contract.primaryArtifactRoot,
    requirementId: requirement.id,
    requirementDescription: requirement.description,
    necessity: requirement.necessity,
    sourceKind,
    requirementSatisfied,
    substituteEvidenceAvailable,
    handling: requirement.necessity === "preferred" ? "replan" : "block",
    reason:
      requirement.necessity === "preferred"
        ? "Preferred evidence is unavailable and no safe substitute remains; replan to recover evidence."
        : "Required evidence is unavailable and no safe substitute remains."
  };
}

export function classifyToolEvidenceNecessity(args: {
  mission: Mission;
  item: WorkItem;
  call: ToolCall;
}): ToolEvidenceNecessity {
  const assessment = assessToolFailureEvidence({
    mission: args.mission,
    item: args.item,
    call: args.call
  });
  return assessment?.necessity || "preferred";
}

export function buildReviewerValidatorEvidenceContractLines(mission: Mission, item: WorkItem): string[] {
  const role = normalizedRole(item);
  if (role !== MissionAgentRole.Reviewer && role !== MissionAgentRole.Validator) return [];

  const contract = buildWorkItemEvidenceContract(mission, item);
  const directScope = contract.requirements.find((r) => r.id === "direct_scope_evidence");
  const repoHistory = contract.requirements.find((r) => r.id === "repo_history_evidence");
  const diagnostics = contract.requirements.find((r) => r.id === "diagnostic_evidence");
  const validation = contract.requirements.find((r) => r.id === "validation_execution");
  const lines = ["EVIDENCE CONTRACT: Use only evidence that the current work item actually needs."];

  if (contract.primaryArtifactRoot) {
    lines.push(`PRIMARY ARTIFACT ROOT: ${contract.primaryArtifactRoot}`);
  }

  lines.push(`EVIDENCE STRATEGY: ${contract.strategy.replace(/_/g, " ")}.`);

  if (directScope) {
    lines.push(
      `DIRECT EVIDENCE (${directScope.necessity}): ${directScope.description}`
    );
  }
  if (repoHistory) {
    lines.push(
      `REPO GIT EVIDENCE (${repoHistory.necessity}): ${repoHistory.description}`
    );
  }
  if (diagnostics) {
    lines.push(
      `DIAGNOSTICS (${diagnostics.necessity}): ${diagnostics.description}`
    );
  }
  if (validation) {
    lines.push(
      `VALIDATION EXECUTION (${validation.necessity}): ${validation.description}`
    );
  }

  lines.push(
    "If a probe fails, reassess evidence sufficiency first: continue when the requirement is already satisfied or substitute evidence remains, replan when only preferred evidence is missing, and block only when required evidence is still unavailable."
  );
  return lines;
}
