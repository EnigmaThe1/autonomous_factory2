import type { ReviewerOutcomeKind, ReviewerSeverity, ReviewerStructuredOutcome } from "./reviewValidatorOutcomeContracts";

const OUTCOMES = new Set<ReviewerOutcomeKind>(["approved", "revision_required", "findings"]);
const SEVERITIES = new Set<ReviewerSeverity>(["info", "low", "medium", "high"]);
const MAX_FIELD = 4000;

function matchLine(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  const t = m?.[1]?.trim();
  return t || undefined;
}

/**
 * Parse optional REVIEW_* lines from reviewer model output.
 * When absent, callers should fall back to keyword heuristics.
 */
export function extractReviewerStructuredOutcome(text: string): Partial<ReviewerStructuredOutcome> {
  if (!text || typeof text !== "string") return {};
  const rawOutcome = matchLine(text, /^REVIEW_OUTCOME:\s*(\S+)/im)?.toLowerCase();
  let outcome: ReviewerOutcomeKind | undefined;
  if (rawOutcome && OUTCOMES.has(rawOutcome as ReviewerOutcomeKind)) {
    outcome = rawOutcome as ReviewerOutcomeKind;
  }
  const findings = matchLine(text, /^REVIEW_FINDINGS:\s*(.+)$/im)?.slice(0, MAX_FIELD);
  const rawSev = matchLine(text, /^REVIEW_SEVERITY:\s*(\S+)/im)?.toLowerCase();
  let severity: ReviewerSeverity | undefined;
  if (rawSev && SEVERITIES.has(rawSev as ReviewerSeverity)) severity = rawSev as ReviewerSeverity;

  const out: Partial<ReviewerStructuredOutcome> = {};
  if (outcome) out.outcome = outcome;
  if (findings) out.findings = findings;
  if (severity) out.severity = severity;
  return out;
}

export function reviewerStructuredOutcomeIsExplicitlyApproved(parsed: Partial<ReviewerStructuredOutcome>): boolean {
  return parsed.outcome === "approved";
}

export function reviewerStructuredOutcomeRequiresImplementerFollowUp(
  parsed: Partial<ReviewerStructuredOutcome>,
  summary: string,
  nextWorkItems: { role: string }[]
): boolean {
  if (nextWorkItems.some((w) => w.role === "implementer")) return false;
  if (parsed.outcome === "approved") return false;
  if (parsed.outcome === "revision_required") return true;
  if (parsed.outcome === "findings" && (parsed.severity === "high" || parsed.severity === "medium")) return true;
  if (parsed.findings?.trim() && (parsed.severity === "high" || parsed.severity === "medium")) return true;
  return false;
}
