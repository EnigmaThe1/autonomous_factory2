import type { Mission } from "../types";

/** Config reader for unit tests (matches `vscode.workspace.getConfiguration` shape). */
export type ScalingConfigReader = { get<T>(key: string, defaultValue?: T): T };

/**
 * Effective max orchestration rounds under fixed vs adaptive scaling.
 * Adaptive mode grows with queue size but shrinks when failures, dead letters, or loop-guard trips indicate churn.
 */
export function computeEffectiveMaxAutoRounds(mission: Mission, cfg: ScalingConfigReader): number {
  const mode = cfg.get<string>("myAi.missions.scalingMode", "fixed");
  if (mode !== "adaptive") return mission.policy.maxAutoRounds;

  const cap = cfg.get<number>("myAi.missions.adaptiveMaxRounds", 200);
  const base = mission.policy.maxAutoRounds;
  const workItemCount = mission.queue.length;
  const failedOrDeadLetter = mission.queue.filter((w) => w.status === "failed" || w.deadLetter).length;
  const failurePenalty = cfg.get<number>("myAi.missions.adaptiveFailurePenaltyRounds", 4);
  const loopTrips = mission.runtime?.loopGuardTrips || 0;
  const loopPenalty = cfg.get<number>("myAi.missions.adaptiveLoopGuardPenaltyRounds", 8);

  const bonus = workItemCount * 2;
  const penalties = failedOrDeadLetter * failurePenalty + loopTrips * loopPenalty;
  const raw = base + bonus - penalties;
  return Math.min(Math.max(raw, base), cap);
}
