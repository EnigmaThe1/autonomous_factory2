import { trimText } from "../../util";
import { MissionAgentRole, type AgentRole, type ChatContext, type Mission, type WorkItem } from "../../types";
import { extractKeywords } from "../orchestrator/orchestratorLeafHelpers";
import {
  buildReviewerValidatorEvidenceContractLines,
  workItemExplicitlyRequestsGitEvidence
} from "../missionEvidenceContract";
import { allowedToolIdsForRole } from "./roleAllowedTools";

const OPTIONAL_LABELS = {
  missionMemory: "MISSION MEMORY",
  globalMemory: "GLOBAL MEMORY",
  projectOverview: "PROJECT OVERVIEW",
  gitStatus: "GIT STATUS",
  diagnostics: "WORKSPACE DIAGNOSTICS",
  relevantFiles: "RELEVANT FILES"
} as const;

/** Heavy keyword / snippet collection for researcher only when diagnosis or explicit research is needed. */
export function researcherTargetedEnrichmentNeeded(item: WorkItem, mission: Mission): boolean {
  if (item.role !== MissionAgentRole.Researcher) return false;
  const p = item.workItemPurpose;
  if (p === "failure_investigation_diagnose" || p === "web_research_consolidate") return true;
  if (/investigate|diagnos|evidence|web search|fetch.*http|research failure/i.test(item.title)) return true;
  if (mission.blocker?.trim() && /tool failure|blocked|investigate|unknown root/i.test(mission.blocker)) return true;
  return false;
}

/**
 * Keywords passed to EnhancedContextCollector (rg-backed snippets). Empty for roles that should not trigger broad file discovery every step.
 */
export function missionWorkItemContextKeywords(mission: Mission, item: WorkItem): string[] {
  if (item.role === MissionAgentRole.Planner || item.role === MissionAgentRole.Architect) return [];
  if (item.role === MissionAgentRole.Researcher && !researcherTargetedEnrichmentNeeded(item, mission)) return [];
  if (item.role === MissionAgentRole.Validator) {
    const hint = item.validationScopeHint?.trim();
    if (hint) return extractKeywords(hint, 5);
    if (item.changedFiles?.length) return item.changedFiles.slice(0, 5).map((p) => p.replace(/^.*[/\\]/, ""));
  }
  if (item.role === MissionAgentRole.Reviewer) {
    const hint = item.validationScopeHint?.trim();
    if (hint) return extractKeywords(hint, 5);
    if (item.changedFiles?.length) return item.changedFiles.slice(0, 5).map((p) => p.replace(/^.*[/\\]/, ""));
  }
  return extractKeywords(item.prompt, 5);
}

function formatQueueSummary(mission: Mission): string {
  const lines = mission.queue.map((w) => `- [${w.status}] ${w.role}: ${w.title}`);
  return trimText(lines.join("\n"), 8000);
}

function changedFilesSummary(mission: Mission, item: WorkItem): string {
  const fromMission = mission.filesModified?.length ? `Mission-tracked modified paths:\n${mission.filesModified.slice(0, 40).join("\n")}` : "";
  const fromItem = item.changedFiles?.length ? `Work-item hint paths:\n${item.changedFiles.slice(0, 40).join("\n")}` : "";
  return [fromMission, fromItem].filter(Boolean).join("\n\n");
}

/** Drop context fields that are irrelevant or noisy for the active work item (Phase 4). */
export function filterChatContextForWorkItem(mission: Mission, item: WorkItem, ctx: ChatContext): ChatContext {
  const out: ChatContext = { ...ctx };
  if (item.role === MissionAgentRole.Validator) {
    delete out.projectOverview;
  }
  if (item.role === MissionAgentRole.Planner || item.role === MissionAgentRole.Architect) {
    delete out.allDiagnosticsSummary;
  }
  if (item.role === MissionAgentRole.Researcher && !researcherTargetedEnrichmentNeeded(item, mission)) {
    delete out.projectOverview;
    delete out.relevantFileSnippets;
    delete out.allDiagnosticsSummary;
  }
  return out;
}

export function shouldAttachOptionalContextLabel(mission: Mission, item: WorkItem, label: string): boolean {
  const r =
    item.role === MissionAgentRole.Architect
      ? MissionAgentRole.Planner
      : item.role;
  if (r === MissionAgentRole.Implementer) return true;
  if (label === OPTIONAL_LABELS.missionMemory || label === OPTIONAL_LABELS.globalMemory) return true;
  if (label === OPTIONAL_LABELS.gitStatus) {
    if (r === MissionAgentRole.Reviewer || r === MissionAgentRole.Validator) {
      return workItemExplicitlyRequestsGitEvidence(mission, item);
    }
    return true;
  }
  if (r === MissionAgentRole.Planner) {
    return (
      label === OPTIONAL_LABELS.projectOverview ||
      label === OPTIONAL_LABELS.missionMemory ||
      label === OPTIONAL_LABELS.globalMemory
    );
  }
  if (r === MissionAgentRole.Researcher) {
    const targeted = researcherTargetedEnrichmentNeeded(item, mission);
    if (!targeted) {
      return label === OPTIONAL_LABELS.missionMemory || label === OPTIONAL_LABELS.globalMemory;
    }
    return true;
  }
  if (r === MissionAgentRole.Reviewer) {
    return label !== OPTIONAL_LABELS.projectOverview;
  }
  if (r === MissionAgentRole.Validator) {
    return label !== OPTIONAL_LABELS.projectOverview;
  }
  return true;
}

export function buildRoleSpecificUserPromptCoreLines(mission: Mission, item: WorkItem): string[] {
  const r =
    item.role === MissionAgentRole.Architect
      ? MissionAgentRole.Planner
      : item.role;

  if (r === MissionAgentRole.Planner) {
    return [
      `MISSION: ${mission.title}`,
      `MISSION GOAL:\n${mission.prompt}`,
      mission.blocker ? `CURRENT BLOCKER / PAUSE:\n${mission.blocker}` : "",
      `QUEUE (work items):\n${formatQueueSummary(mission)}`,
      mission.blueprint ? `BLUEPRINT STATUS: ${mission.blueprint.status}` : "",
      `YOUR ROLE: planner — decompose, sequence work, and emit WORK: lines; do not mutate the workspace directly.`,
      `TASK: ${item.title}`,
      `TASK PROMPT:\n${item.prompt}`
    ].filter(Boolean);
  }

  if (r === MissionAgentRole.Researcher) {
    const targeted = researcherTargetedEnrichmentNeeded(item, mission);
    return [
      `MISSION: ${mission.title}`,
      `MISSION GOAL (context only):\n${trimText(mission.prompt, 2500)}`,
      targeted
        ? "MODE: Targeted research / diagnosis — gather evidence (web or repo reads) and record MEMORY lines others can rely on."
        : "MODE: Lightweight pass — prefer existing mission MEMORY; avoid broad repo scans unless the task explicitly requires new evidence.",
      `TASK: ${item.title}`,
      `TASK PROMPT:\n${item.prompt}`,
      item.scopeSummary?.trim() ? `SCOPE NOTE: ${item.scopeSummary.trim()}` : "",
      mission.blocker && targeted ? `RELATED BLOCKER:\n${trimText(mission.blocker, 1500)}` : ""
    ].filter(Boolean);
  }

  if (r === MissionAgentRole.Implementer) {
    return [
      `MISSION: ${mission.title}`,
      `MISSION PROMPT:\n${mission.prompt}`,
      `ROLE: implementer`,
      `TASK: ${item.title}`,
      `TASK PROMPT:\n${item.prompt}`,
      item.scopeSummary?.trim() ? `WRITE SCOPE (stay in bounds): ${item.scopeSummary.trim()}` : "",
      item.validationHint?.trim() ? `VALIDATION HINT: ${item.validationHint.trim()}` : "",
      item.retryCount
        ? `RETRY ATTEMPT: ${item.retryCount}. A previous attempt failed. Analyze the error below and try a DIFFERENT approach.`
        : "",
      item.previousError ? `PREVIOUS ERROR:\n${item.previousError}` : "",
      item.spawnedFromFailureOf ? `RECOVERY: spawned from failed work item ${item.spawnedFromFailureOf}.` : "",
      mission.policy.closureRequired
        ? "CLOSURE REQUIRED: continue until validation passes or a real blocker exists."
        : ""
    ].filter(Boolean);
  }

  if (r === MissionAgentRole.Reviewer) {
    const cf = changedFilesSummary(mission, item);
    return [
      `MISSION: ${mission.title}`,
      `REVIEW TARGET: ${item.title}`,
      `STEP / TASK CONTEXT (canonical scope — do not chase end-state filenames from the overall mission unless this task or CHANGED AREAS names them):\n${trimText(item.prompt, 3500)}`,
      cf ? `CHANGED / TOUCHED AREAS:\n${cf}` : "(No mission-level modified file list yet — discover paths with listFiles only under hints above; avoid speculative final-report reads.)",
      item.scopeSummary?.trim() ? `SCOPE NOTE: ${item.scopeSummary.trim()}` : "",
      item.validationHint?.trim() ? `VALIDATION HINT: ${item.validationHint.trim()}` : "",
      item.validationScopeHint?.trim() ? `REVIEW SCOPE HINT:\n${item.validationScopeHint.trim()}` : "",
      mission.runtime?.resolvedArtifactRootRelative
        ? `BOUND ARTIFACT ROOT (workspace-relative): ${mission.runtime.resolvedArtifactRootRelative}`
        : "",
      ...buildReviewerValidatorEvidenceContractLines(mission, item)
    ].filter(Boolean);
  }

  if (r === MissionAgentRole.Validator) {
    return [
      `MISSION: ${mission.title}`,
      `VALIDATION TARGET: ${item.title}`,
      `MISSION VALIDATION STATE: ${mission.validationState}`,
      item.validationScopeHint?.trim() ? `VALIDATION SCOPE HINT:\n${item.validationScopeHint.trim()}` : "",
      changedFilesSummary(mission, item)
        ? `CHANGED AREAS (hints):\n${trimText(changedFilesSummary(mission, item), 2000)}`
        : "",
      `TASK PROMPT:\n${item.prompt}`,
      `Use runTests / runLinter / getDiagnostics as appropriate; require evidence before COMPLETE:.`,
      ...buildReviewerValidatorEvidenceContractLines(mission, item)
    ].filter(Boolean);
  }

  return [
    `MISSION: ${mission.title}`,
    `MISSION PROMPT:\n${mission.prompt}`,
    `ROLE: ${item.role}`,
    `TASK: ${item.title}`,
    `TASK PROMPT:\n${item.prompt}`
  ];
}

export function attachRoleDispatchMeta(role: AgentRole, ctx: ChatContext): ChatContext {
  return {
    ...ctx,
    roleDispatch: { allowedToolIds: allowedToolIdsForRole(role) }
  };
}
