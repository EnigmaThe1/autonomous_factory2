import type { Mission } from "../types";
import type { MissionProgressStats } from "./protocol";
import { isActiveWorkItemStatus, isRunnableWorkItemStatus } from "../missions/workItemLifecycle";

export function computeMissionProgressStats(mission: Mission): MissionProgressStats {
  const queue = mission.queue;
  const total = queue.length;
  const done = queue.filter((w) => w.status === "done").length;
  const running = queue.filter((w) => isActiveWorkItemStatus(w.status)).length;
  const todo = queue.filter((w) => w.status === "todo").length;
  const blocked = queue.filter((w) => w.status === "blocked").length;
  const failed = queue.filter((w) => w.status === "failed").length;
  const skipped = queue.filter((w) => w.status === "skipped").length;
  const diagnosing = queue.filter((w) => w.status === "diagnosing").length;
  const repairing = queue.filter((w) => w.status === "repairing").length;
  const retryReady = queue.filter((w) => w.status === "retry_ready").length;
  const reviewPending = queue.filter((w) => w.status === "review_pending").length;
  const validationPending = queue.filter((w) => w.status === "validation_pending").length;
  const awaitingApproval = queue.filter((w) => w.status === "awaiting_approval").length;
  const deadLetter = queue.filter((w) => w.status === "dead_letter").length;
  const inRecoveryChain = queue.filter((w) => Boolean(w.recoveryChainId)).length;
  const completionPercent = total > 0 ? Math.round(((done + skipped) / total) * 100) : 0;

  const roundsCompleted = mission.roundsCompleted || 0;
  const maxAutoRounds = mission.policy.maxAutoRounds;
  const elapsedMs = mission.updatedAt - mission.createdAt;

  const completedItems = done + skipped;
  const avgStepMs = completedItems > 0 ? Math.round(elapsedMs / completedItems) : 0;
  const remaining =
    queue.filter((w) => isRunnableWorkItemStatus(w.status)).length +
    queue.filter((w) => isActiveWorkItemStatus(w.status)).length;
  const estimatedRemainingMs = avgStepMs > 0 ? avgStepMs * remaining : 0;

  return {
    total,
    done,
    running,
    todo,
    blocked,
    failed,
    skipped,
    diagnosing,
    repairing,
    retryReady,
    reviewPending,
    validationPending,
    awaitingApproval,
    deadLetter,
    inRecoveryChain,
    completionPercent,
    roundsCompleted,
    maxAutoRounds,
    elapsedMs,
    avgStepMs,
    estimatedRemainingMs,
    dryRun: mission.dryRun || false,
  };
}

export function computeAllMissionProgressStats(missions: Mission[]): Record<string, MissionProgressStats> {
  const result: Record<string, MissionProgressStats> = {};
  for (const m of missions) {
    if (m.status !== "completed" && m.status !== "failed" && !m.archivedAt) {
      result[m.id] = computeMissionProgressStats(m);
    }
  }
  return result;
}
