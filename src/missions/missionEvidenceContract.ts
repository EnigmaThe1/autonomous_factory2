import { MissionAgentRole, type Mission, type ToolCall, type WorkItem } from "../types";

export type ToolEvidenceNecessity = "required" | "preferred" | "optional";

const PATH_LIKE =
  /<MISSION_ROOT>\/[\w./-]+\.(?:md|txt|json|ts|tsx|py|yaml|yml|toml)|(?:^|[\s`'"(])((?:\.?\/)?[\w./-]+\.(?:md|txt|json|ts|tsx|py|yaml|yml|toml))(?:\b|$)/gi;
const GIT_POSITIVE_EVIDENCE_RE =
  /\b(use|check|confirm|inspect|review|compare|verify|examine|require|must use|needs?)\b.{0,48}\b(git|git status|git diff|git log|git blame|working tree|repository status|repo status|commit|branch|history|staged|unstaged|uncommitted|patch)\b|\b(git status|git diff|git log|git blame)\b/i;
const ARTIFACT_SCOPED_RE =
  /\b(artifact|deliverable|mission root|current[- ]phase|phase[- ]scoped|phase|final report|review scope|validation scope|root binding|scope audit|phase timing|document-only|artifact-only)\b/i;

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

export function workItemExplicitlyRequestsGitEvidence(mission: Mission, item: WorkItem): boolean {
  const blob = collectContractTexts(mission, item).join("\n");
  return GIT_POSITIVE_EVIDENCE_RE.test(blob);
}

export function shouldPreferArtifactScopedEvidence(mission: Mission, item: WorkItem): boolean {
  const role = normalizedRole(item);
  if (role !== MissionAgentRole.Reviewer && role !== MissionAgentRole.Validator) return false;
  if (mission.runtime?.resolvedArtifactRootRelative?.trim()) return true;
  const texts = collectContractTexts(mission, item);
  return hasPathLikeReference(texts) || ARTIFACT_SCOPED_RE.test(texts.join("\n"));
}

export function classifyToolEvidenceNecessity(args: {
  mission: Mission;
  item: WorkItem;
  call: ToolCall;
}): ToolEvidenceNecessity {
  const { mission, item, call } = args;
  const role = normalizedRole(item);
  const explicitGit = workItemExplicitlyRequestsGitEvidence(mission, item);

  if ((role === MissionAgentRole.Reviewer || role === MissionAgentRole.Validator) && call.tool.startsWith("git.")) {
    return explicitGit ? "required" : "optional";
  }

  if (role === MissionAgentRole.Validator && (call.tool === "runTests" || call.tool === "runLinter")) {
    return mission.policy.requireValidationEvidence ? "required" : "preferred";
  }

  if (
    role === MissionAgentRole.Reviewer ||
    role === MissionAgentRole.Validator
  ) {
    if (
      call.tool === "readFile" ||
      call.tool === "listFiles" ||
      call.tool === "fileTree" ||
      call.tool === "grepSearch" ||
      call.tool === "searchFiles" ||
      call.tool === "findRelevantFiles" ||
      call.tool === "getDiagnostics"
    ) {
      return shouldPreferArtifactScopedEvidence(mission, item) ? "preferred" : "preferred";
    }
  }

  return "preferred";
}

export function buildReviewerValidatorEvidenceContractLines(mission: Mission, item: WorkItem): string[] {
  const role = normalizedRole(item);
  if (role !== MissionAgentRole.Reviewer && role !== MissionAgentRole.Validator) return [];

  const artifactScoped = shouldPreferArtifactScopedEvidence(mission, item);
  const explicitGit = workItemExplicitlyRequestsGitEvidence(mission, item);
  const lines = [
    "EVIDENCE CONTRACT: Use only evidence that the current work item actually needs."
  ];

  if (artifactScoped) {
    lines.push(
      mission.runtime?.resolvedArtifactRootRelative
        ? `PRIMARY ARTIFACT ROOT: ${mission.runtime.resolvedArtifactRootRelative}`
        : "PRIMARY EVIDENCE: current mission-created artifacts and scoped file reads."
    );
    lines.push(
      "TOOL NECESSITY: listFiles/fileTree/readFile over current-phase artifacts are preferred. Repo-level git probes are optional unless the task explicitly asks for git state, history, blame, or diff evidence."
    );
  } else if (explicitGit) {
    lines.push(
      "TOOL NECESSITY: this task explicitly asks for git evidence, so git probes are required; still corroborate with direct file evidence when possible."
    );
  } else {
    lines.push(
      "TOOL NECESSITY: treat repo-level git probes as optional by default. Prefer direct evidence from the current scope before escalating to repo-wide probes."
    );
  }

  lines.push(
    "If an optional probe fails, continue with remaining evidence sources and only emit BLOCKER when required evidence is still unavailable."
  );

  if (role === MissionAgentRole.Validator) {
    lines.push("Validation evidence rule: run tests/lint/diagnostics when they are relevant and supported by the repo.");
  }

  return lines;
}
