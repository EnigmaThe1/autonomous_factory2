import type { Mission } from "../types";
import type { MissionProgressStats } from "./protocol";

export function computeMissionProgressStats(mission: Mission): MissionProgressStats {
  const queue = mission.queue;
  const total = queue.length;
  const done = queue.filter((w) => w.status === "done").length;
  const running = queue.filter((w) => w.status === "running").length;
  const todo = queue.filter((w) => w.status === "todo").length;
  const blocked = queue.filter((w) => w.status === "blocked").length;
  const failed = queue.filter((w) => w.status === "failed").length;
  const skipped = queue.filter((w) => w.status === "skipped").length;
  const completionPercent = total > 0 ? Math.round(((done + skipped) / total) * 100) : 0;

  const roundsCompleted = mission.roundsCompleted || 0;
  const maxAutoRounds = mission.policy.maxAutoRounds;
  const elapsedMs = mission.updatedAt - mission.createdAt;

  const completedItems = done + skipped;
  const avgStepMs = completedItems > 0 ? Math.round(elapsedMs / completedItems) : 0;
  const remaining = todo + running;
  const estimatedRemainingMs = avgStepMs > 0 ? avgStepMs * remaining : 0;

  return {
    total,
    done,
    running,
    todo,
    blocked,
    failed,
    skipped,
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
