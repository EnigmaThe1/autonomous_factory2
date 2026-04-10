/**
 * Canonical failure taxonomy for autonomous mission recovery (Phase 2).
 * Work-item / tool failures are classified here before routing.
 */

export type FailureClass = "transient" | "repairable" | "environmental" | "hard_deny";

export type FailureDomain = "tool" | "validation" | "blueprint" | "policy" | "runtime";

/** High-level structured failure emitted by classifiers and consumed by the recovery router. */
export interface StructuredFailure {
  class: FailureClass;
  domain: FailureDomain;
  /** Stable sub-code for tests / telemetry (e.g. tool_crashed, host_risk_denial). */
  code: string;
  message: string;
  tool?: string;
}

/**
 * Recovery actions chosen by the router. Distinct from FailureClass — describes what the orchestrator should do next.
 */
export type RecoveryRoute =
  | "retry_direct"
  | "spawn_recovery_work"
  | "replan"
  | "pause_for_approval"
  | "block"
  | "fail";

export interface RecoveryRouterContext {
  /** Same fingerprint streak after this attempt (1 = first time seeing this fingerprint). */
  sameFingerprintStreak: number;
  failureInvestigationEnabled: boolean;
  failureInvestigationWavesRemaining: number;
  /** Work item role when the failure occurred (tool / validation paths). */
  workItemRole?: string;
  /** When true, router may choose fail (terminal mission failure) instead of block. */
  allowTerminalMissionFail?: boolean;
}

export interface RecoveryDecision {
  route: RecoveryRoute;
  /** Optional operator-facing reason for logs / events. */
  reason: string;
}
