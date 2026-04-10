/**
 * Central place for tool-recovery and follow-up limits so missions can favor
 * more agent-driven investigation (exploratory) vs tighter caps (standard).
 */

export type ToolRecoveryAutonomyPreset = "standard" | "exploratory";

export interface ConfigSliceForToolRecovery {
  get<T>(key: string, defaultValue: T): T;
}

export interface ResolvedToolRecoveryLimits {
  maxRecoverableReadonlyFailuresPerWorkItem: number;
  maxTransientMutatingFailuresPerWorkItem: number;
  maxRunCommandProbeFailuresPerWorkItem: number;
  maxRunCommandAgentRetry: number;
  maxWriteFileAgentRetry: number;
  maxApplyPatchAgentRetry: number;
}

const CAP = {
  readonly: 48,
  transient: 16,
  probe: 48,
  agentRetry: 48
} as const;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function exploratoryBoost(n: number, maxCap: number): number {
  if (n <= 0) return n;
  return clamp(Math.ceil(n * 1.75), 1, maxCap);
}

export function resolveToolRecoveryAutonomyPreset(cfg: ConfigSliceForToolRecovery): ToolRecoveryAutonomyPreset {
  const raw = String(cfg.get<string>("myAi.missions.toolRecoveryAutonomyPreset", "standard") || "standard");
  return raw === "exploratory" ? "exploratory" : "standard";
}

export function resolveToolRecoveryLimits(cfg: ConfigSliceForToolRecovery): ResolvedToolRecoveryLimits {
  const preset = resolveToolRecoveryAutonomyPreset(cfg);
  const boost = preset === "exploratory" ? exploratoryBoost : (x: number, _cap: number) => x;

  const ro = clamp(cfg.get<number>("myAi.missions.maxRecoverableReadonlyFailuresPerWorkItem", 10), 0, CAP.readonly);
  const tm = clamp(cfg.get<number>("myAi.missions.maxTransientMutatingFailuresPerWorkItem", 4), 0, CAP.transient);
  const probe = clamp(cfg.get<number>("myAi.missions.maxRunCommandProbeFailuresPerWorkItem", 12), 0, CAP.probe);
  const rc = clamp(cfg.get<number>("myAi.missions.maxRunCommandRecoveryAttemptsPerWorkItem", 12), 0, CAP.agentRetry);
  const wf = clamp(cfg.get<number>("myAi.missions.maxWriteFileRecoveryAttemptsPerWorkItem", 12), 0, CAP.agentRetry);
  const ap = clamp(cfg.get<number>("myAi.missions.maxApplyPatchRecoveryAttemptsPerWorkItem", 12), 0, CAP.agentRetry);

  return {
    maxRecoverableReadonlyFailuresPerWorkItem: boost(ro, CAP.readonly),
    maxTransientMutatingFailuresPerWorkItem: boost(tm, CAP.transient),
    maxRunCommandProbeFailuresPerWorkItem: boost(probe, CAP.probe),
    maxRunCommandAgentRetry: boost(rc, CAP.agentRetry),
    maxWriteFileAgentRetry: boost(wf, CAP.agentRetry),
    maxApplyPatchAgentRetry: boost(ap, CAP.agentRetry)
  };
}

/**
 * Production: maxToolFollowUpTurns, optionally scaled for exploratory preset.
 * Test harness: maxToolFollowUpsWhenTestHarness (unchanged by preset — tests stay deterministic).
 */
export function resolveMaxToolFollowUpTurns(cfg: ConfigSliceForToolRecovery, agentRunForTest: boolean | undefined): number {
  if (agentRunForTest) {
    return clamp(cfg.get<number>("myAi.missions.maxToolFollowUpsWhenTestHarness", 0), 0, 32);
  }
  const preset = resolveToolRecoveryAutonomyPreset(cfg);
  let base = clamp(cfg.get<number>("myAi.missions.maxToolFollowUpTurns", 10), 0, 32);
  if (preset === "exploratory" && base > 0) {
    base = clamp(Math.max(base, Math.ceil(base * 1.6)), 1, 32);
  }
  return base;
}
