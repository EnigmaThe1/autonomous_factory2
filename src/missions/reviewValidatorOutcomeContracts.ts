/**
 * Structured outcomes for Reviewer / Validator agent outputs (host-enforced routing).
 * Models emit optional single-line prefixes; host parses and routes the autonomous loop.
 */

export type ReviewerOutcomeKind = "approved" | "revision_required" | "findings";

export type ReviewerSeverity = "info" | "low" | "medium" | "high";

export interface ReviewerStructuredOutcome {
  outcome: ReviewerOutcomeKind;
  /** Free-text defects / notes (single line from model). */
  findings?: string;
  severity?: ReviewerSeverity;
}

export type ValidatorOutcomeKind = "pass" | "fail" | "inconclusive";

export type ValidatorSuspectedClass = "code" | "environment" | "unknown";

export interface ValidatorStructuredOutcome {
  outcome: ValidatorOutcomeKind;
  suspectedClass?: ValidatorSuspectedClass;
}
