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
  steps: BlueprintStep[];
  amendments: BlueprintAmendment[];
}
