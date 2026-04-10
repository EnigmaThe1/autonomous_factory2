/**
 * First-class mission blueprint (upfront plan + traceability to work items).
 * Persisted on `Mission.blueprint` when blueprint mode is enabled.
 */

export type MissionBlueprintStatus = "draft" | "awaiting_approval" | "approved" | "superseded";

export type BlueprintStepStatus = "pending" | "in_progress" | "done" | "skipped" | "blocked";

export interface BlueprintStep {
  id: string;
  title: string;
  summary: string;
  /** Suggested primary role for synthesized work (host may map to implementer/researcher cycles). */
  roleHint: "planner" | "researcher" | "implementer" | "reviewer" | "validator" | "architect";
  dependsOn?: string[];
  acceptanceCriteria: string[];
  status: BlueprintStepStatus;
  optional?: boolean;
  /** Optional structured scope line for synthesized work items. */
  scopeSummary?: string;
  /** Optional validation hint for synthesized work items. */
  validationHint?: string;
}

export interface BlueprintAmendment {
  at: number;
  reason: string;
  addedStepIds: string[];
  modifiedStepIds?: string[];
}

export interface MissionBlueprint {
  version: 1;
  createdAt: number;
  approvedAt?: number;
  status: MissionBlueprintStatus;
  /** High-level goal restatement + implicit requirements (free text, bounded). */
  requirementsSummary: string;
  /** Architecture / stack intent at summary level (bounded). */
  architectureSummary: string;
  /** Optional: what “done” looks like for the deliverable (behavior, artifacts). Parsed from planner JSON when present. */
  goalEndState?: string;
  /** Optional: at least two viable approaches the planner compared (goal-first discipline). */
  approachOptions?: string[];
  /** Optional: which approach the mission executes and why. */
  chosenApproach?: string;
  steps: BlueprintStep[];
  amendments: BlueprintAmendment[];
}
