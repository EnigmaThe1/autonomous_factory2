import type { AgentRole, WorkItem } from "../types";
import {
  extractReviewerStructuredOutcome,
  reviewerStructuredOutcomeIsExplicitlyApproved,
  reviewerStructuredOutcomeRequiresImplementerFollowUp
} from "./reviewerOutcomeExtract";

/**
 * Heuristic used by reviewer auto-remediation: model text looks like it reported problems without
 * an implementer follow-up in the same turn.
 */
export function reviewerModelOutputSuggestsRemediation(summary: string, nextWorkItems: WorkItem[]): boolean {
  if (nextWorkItems.some((w) => w.role === "implementer")) return false;
  const normalized = summary.toLowerCase();
  const signals = [
    "issue",
    "risk",
    "missing",
    "defect",
    "bug",
    "fix",
    "failing",
    "error",
    "regression",
    "todo",
    "insufficient"
  ];
  return signals.some((s) => normalized.includes(s));
}

/**
 * Whether `MissionOrchestrator.maybeEnforcePostAgentContracts` should enqueue reviewer remediation
 * work items (pure mirror of the orchestrator gate).
 */
export function shouldEnqueueReviewerAutoRemediation(args: {
  itemRole: AgentRole;
  skipBecauseAlreadySatisfiedNoTool: boolean;
  autoCreateFixTasksSetting: boolean;
  summary: string;
  nextWorkItems: WorkItem[];
}): boolean {
  if (args.itemRole !== "reviewer" || args.skipBecauseAlreadySatisfiedNoTool || !args.autoCreateFixTasksSetting) {
    return false;
  }
  const structured = extractReviewerStructuredOutcome(args.summary);
  if (reviewerStructuredOutcomeIsExplicitlyApproved(structured)) return false;
  if (reviewerStructuredOutcomeRequiresImplementerFollowUp(structured, args.summary, args.nextWorkItems)) return true;
  return reviewerModelOutputSuggestsRemediation(args.summary, args.nextWorkItems);
}
