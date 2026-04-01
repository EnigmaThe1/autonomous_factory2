import * as vscode from "vscode";
import { uid } from "../util";
import { MissionOrchestrator } from "./MissionOrchestrator";
import { MissionStore } from "./MissionStore";
import { tryAcquireRunnerLease } from "./RunnerLease";
import { decideStallRecovery, leaseTtlMsFromHeartbeatSeconds } from "./runnerRecoveryPolicy";

export class BackgroundMissionRunner implements vscode.Disposable {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly ownerId = uid("runner");
  /**
   * Optional: after a tick that injected stall recovery replan or auto-blocked a mission (not routine
   * heartbeat/resume noise). Extension wires sidebar mission `snapshotSection` refresh.
   */
  onSignificantMissionMutation?: () => void;

  constructor(private readonly orchestrator: MissionOrchestrator, private readonly store: MissionStore) {}

  start(): void {
    this.stop();
    const seconds = Math.max(3, vscode.workspace.getConfiguration().get<number>("myAi.missions.heartbeatSeconds", 8));
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.stop();
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let significantMissionMutation = false;
    try {
      const missions = this.store.list().filter((m) => ["queued", "running"].includes(m.status));
      const threshold = Math.max(1, vscode.workspace.getConfiguration().get<number>("myAi.missions.stallHeartbeatThreshold", 10));
      const maxAutoReplans = Math.max(1, vscode.workspace.getConfiguration().get<number>("myAi.missions.maxStallAutoReplans", 2));
      const seconds = Math.max(3, vscode.workspace.getConfiguration().get<number>("myAi.missions.heartbeatSeconds", 8));
      const leaseTtlMs = leaseTtlMsFromHeartbeatSeconds(seconds);

      for (const mission of missions) {
        const lease = tryAcquireRunnerLease(mission.runtime, this.ownerId, Date.now(), leaseTtlMs);
        if (!lease.acquired) {
          continue;
        }
        if (lease.runtimePatch) {
          await this.store.updateRuntime(mission.id, lease.runtimePatch);
        }

        if (this.orchestrator.isMissionRunLoopActive(mission.id)) {
          await this.store.updateRuntime(mission.id, {
            lastRunnerHeartbeatAt: Date.now(),
            stalledHeartbeats: 0
          });
          continue;
        }

        const runtime = mission.runtime || { stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 0 };
        await this.store.updateRuntime(mission.id, {
          lastRunnerHeartbeatAt: Date.now(),
          stalledHeartbeats: (runtime.stalledHeartbeats || 0) + 1
        });
        await this.store.saveEvent(mission.id, { level: "info", source: "background-runner", message: "Heartbeat resume check" });

        const refreshed = this.store.get(mission.id);
        const refreshedRuntime = refreshed?.runtime;
        if (!refreshed || !refreshedRuntime) continue;

        const alreadyQueued = refreshed.queue.some((w) => w.title === "Runner recovery replan" && ["todo", "running"].includes(w.status));
        const recovery = decideStallRecovery({
          stalledHeartbeats: refreshedRuntime.stalledHeartbeats || 0,
          threshold,
          autoReplans: refreshedRuntime.autoReplans || 0,
          maxAutoReplans: maxAutoReplans,
          alreadyQueuedRecoveryReplan: alreadyQueued
        });
        if (recovery === "inject_replan") {
          await this.store.enqueue(mission.id, [{
            id: uid("work"),
            title: "Runner recovery replan",
            role: "planner",
            status: "todo",
            prompt: "The mission appears stalled. Re-plan from current state, identify the next concrete tranche, and re-seed implementer/reviewer/validator work if needed."
          }]);
          await this.store.updateRuntime(mission.id, {
            autoReplans: (refreshedRuntime.autoReplans || 0) + 1,
            stalledHeartbeats: 0
          });
          await this.store.saveEvent(mission.id, { level: "warn", source: "background-runner", message: "Injected automatic recovery replan after stall detection" });
          significantMissionMutation = true;
        } else if (recovery === "mark_blocked") {
          await this.store.updateMission(mission.id, {
            status: "blocked",
            blocker: "Mission exceeded automatic recovery attempts",
            blockReasonCode: "stall_recovery_limit"
          });
          await this.store.updateRuntime(mission.id, {
            loopGuardTrips: (refreshedRuntime.loopGuardTrips || 0) + 1
          });
          await this.store.saveEvent(mission.id, { level: "warn", source: "background-runner", message: "Mission paused after exceeding automatic recovery attempts" });
          significantMissionMutation = true;
          continue;
        }

        await this.orchestrator.resumeMission(mission.id);
      }
      if (significantMissionMutation) {
        try {
          this.onSignificantMissionMutation?.();
        } catch {
          /* never break runner tick */
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
