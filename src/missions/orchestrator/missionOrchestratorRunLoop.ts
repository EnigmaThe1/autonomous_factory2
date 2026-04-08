import * as vscode from "vscode";
import type { RunMissionPassOutcome } from "../missionActionResult";
import type { Mission, WorkItem } from "../../types";
import { uid } from "../../util";
import { resolveCompletionReasonForCompletedMission } from "../alreadySatisfiedWorkItem";
import { shouldCollapseToComplete } from "../missionCompletionCollapse";
import {
  dependencyEdgeSatisfied,
  hasRequiredUnresolvedWork,
  obsolescentTodoSkipReason,
  supersededReviewerTerminalSkipReason,
  supersededValidatorTerminalSkipReason
} from "../requiredWork";
import {
  classifyImplementerHardStopDownstreamGate,
  type ImplementerHardStopGateResult
} from "../requiredImplementerHardStopGate";
import { missionBlockReasonFromDownstreamGate } from "../missionBlockReasonCode";
import { shouldAutoRetry, createRetryWorkItem, shouldMarkWorkItemDeadLetter } from "../workItemAutoRetry";
import { computeEffectiveMaxAutoRounds } from "../adaptiveMissionScaling";
import { blueprintBlocksMissionCompletion, computeBlueprintProgress } from "../blueprintProgress";
import { resolveCompletionStatus } from "../LifecycleRules";
import { recoverInterruptedQueueItems } from "../resumeRecovery";
import type { MissionStore } from "../MissionStore";
import type { MissionOrchestratorWorkItemRunner } from "./missionOrchestratorWorkItemRunner";

export interface RunLoopHost {
  store: MissionStore;
  running: Set<string>;
  inFlightRunPass: Map<string, { done: Promise<void>; finish: () => void }>;
  pendingCompletionReason: Map<string, NonNullable<Mission["completionReason"]>>;
  workItemRunner: MissionOrchestratorWorkItemRunner;
  onMissionTerminal?: (missionId: string, status: string) => void;
  updateWorkItemWithHardStopInvariant(
    missionId: string,
    itemBeforePatch: WorkItem,
    patch: Partial<WorkItem>
  ): Promise<void>;
  noteMalformedImplementerHardStopEvent(
    missionId: string,
    mission: Mission,
    gate: ImplementerHardStopGateResult
  ): Promise<void>;
  ensureClosurePolicy(mission: Mission): Promise<boolean>;
  abortMissionWork(missionId: string): void;
}

export class MissionOrchestratorRunLoop {
  constructor(private readonly host: RunLoopHost) {}

  /** Await the current `runMission` pass for `id`, if any; otherwise resolve immediately. */
  public joinInFlightRunLoopPass(id: string): Promise<void> {
    return this.host.inFlightRunPass.get(id)?.done ?? Promise.resolve();
  }

  /**
   * When `shouldCollapseToComplete` holds, persist terminal `completed`. Used at loop start and
   * immediately after `runWorkItem` so the last allowed iteration can finish without requiring a
   * follow-up loop header (avoids hitting `maxStepsPerRun` then `queued` + heartbeat recovery).
   */
  /** Prefer explicit pending reason (e.g. stale patch); else note no-tool already_satisfied work items. */
  private resolveCompletionReasonForCompleted(id: string, queue: WorkItem[]): Mission["completionReason"] | undefined {
    const pending = this.host.pendingCompletionReason.get(id);
    if (pending) this.host.pendingCompletionReason.delete(id);
    return resolveCompletionReasonForCompletedMission(pending, queue);
  }

  private async tryCollapseMissionToCompleted(id: string): Promise<boolean> {
    await this.autoDemoteObsolescentQueueItems(id);
    await this.autoDemoteSupersededTerminalItems(id);
    const m = this.host.store.get(id);
    if (!m || !shouldCollapseToComplete(m)) return false;
    if (blueprintBlocksMissionCompletion(m)) return false;
    const completionReason = this.resolveCompletionReasonForCompleted(id, m.queue);
    await this.host.store.updateMission(id, {
      status: "completed",
      blocker: undefined,
      blockReasonCode: undefined,
      result: m.memory
        .slice(-8)
        .map((mem) => `- ${mem.text}`)
        .join("\n"),
      ...(completionReason ? { completionReason } : {})
    });
    return true;
  }

  /** Mark known-redundant todo items as `skipped` so completion rules can distinguish them from required work. */
  private async autoDemoteObsolescentQueueItems(missionId: string): Promise<void> {
    for (;;) {
      const mission = this.host.store.get(missionId);
      if (!mission) return;
      const todo = mission.queue.find((w) => w.status === "todo" && obsolescentTodoSkipReason(mission, w));
      if (!todo) return;
      const reason = obsolescentTodoSkipReason(mission, todo)!;
      await this.host.updateWorkItemWithHardStopInvariant(missionId, todo, { status: "skipped", output: reason });
      await this.host.store.saveEvent(missionId, {
        level: "info",
        source: "orchestrator",
        message: reason
      });
      await this.host.store.noteProgress(missionId);
    }
  }

  /**
   * Demotes stale reviewer/validator rows left `blocked`/`failed` after a later same-role pass completed
   * and `validationState` is `passed`, so collapse and terminal reconciliation do not treat them as
   * active failures.
   */
  private async autoDemoteSupersededTerminalItems(missionId: string): Promise<void> {
    for (;;) {
      const mission = this.host.store.get(missionId);
      if (!mission) return;
      const row = mission.queue.find(
        (w) => supersededValidatorTerminalSkipReason(mission, w) || supersededReviewerTerminalSkipReason(mission, w)
      );
      if (!row) return;
      const reason =
        supersededValidatorTerminalSkipReason(mission, row) || supersededReviewerTerminalSkipReason(mission, row)!;
      await this.host.updateWorkItemWithHardStopInvariant(missionId, row, { status: "skipped", output: reason });
      await this.host.store.saveEvent(missionId, {
        level: "info",
        source: "orchestrator",
        message: reason
      });
      await this.host.store.noteProgress(missionId);
    }
  }

  /**
   * Runs at most one pass per mission at a time. If a pass is already active, awaits that pass
   * (join) and returns without starting another. Returned `statusAfterPass` is observational only.
   */
  public async runMission(id: string): Promise<RunMissionPassOutcome> {
    if (this.host.running.has(id)) {
      await this.joinInFlightRunLoopPass(id);
      return { kind: "joined_in_flight_pass", missionId: id };
    }
    let finishPass!: () => void;
    const passDone = new Promise<void>((resolve) => {
      finishPass = resolve;
    });
    this.host.inFlightRunPass.set(id, { done: passDone, finish: finishPass });
    this.host.running.add(id);
    this.host.pendingCompletionReason.delete(id);

    try {
      let mission = this.host.store.get(id);
      if (!mission) return this.runPassOutcomeAfterStoreRead(id);
      await this.host.store.updateMission(id, { status: "running", blockReasonCode: undefined });
      const maxSteps = Math.max(1, vscode.workspace.getConfiguration().get<number>("myAi.missions.maxStepsPerRun", 16));

      for (let step = 0; step < maxSteps; step++) {
        mission = this.host.store.get(id);
        if (!mission) return this.runPassOutcomeAfterStoreRead(id);

        if (mission.status === "cancelled") {
          this.host.abortMissionWork(id);
          return this.runPassOutcomeAfterStoreRead(id);
        }

        if (mission.status === "awaiting_input") {
          return this.runPassOutcomeAfterStoreRead(id);
        }

        const effectiveMaxRounds = computeEffectiveMaxAutoRounds(mission, vscode.workspace.getConfiguration());
        if ((mission.roundsCompleted || 0) >= effectiveMaxRounds) {
          this.host.pendingCompletionReason.delete(id);
          await this.host.store.updateMission(id, {
            status: "blocked",
            blocker: "Reached maxAutoRounds safety limit",
            validationState: "failed",
            blockReasonCode: "max_auto_rounds"
          });
          await this.host.store.updateRuntime(id, { loopGuardTrips: (mission.runtime?.loopGuardTrips || 0) + 1 });
          return this.runPassOutcomeAfterStoreRead(id);
        }

        if (await this.tryCollapseMissionToCompleted(id)) return this.runPassOutcomeAfterStoreRead(id);

        const pendingApproval = mission.approvals.find((a) => a.status === "pending");
        if (pendingApproval) {
          await this.host.store.updateMission(id, {
            status: "awaiting_input",
            blocker: pendingApproval.title,
            blockReasonCode: "approval_pending"
          });
          return this.runPassOutcomeAfterStoreRead(id);
        }

        const gate = classifyImplementerHardStopDownstreamGate(mission);
        await this.host.noteMalformedImplementerHardStopEvent(id, mission, gate);
        const allowRoleWhileGated = (role: WorkItem["role"]): boolean =>
          role === "implementer" || role === "planner" || role === "architect";
        const next = mission.queue.find(
          (w) =>
            w.status === "todo" &&
            this.dependenciesMet(mission!, w) &&
            (!gate.gate || allowRoleWhileGated(w.role))
        );

        if (!next) {
          const emptyQueueResult = await this.handleEmptyQueue(id, mission, gate);
          if (emptyQueueResult === "continue") continue;
          return this.runPassOutcomeAfterStoreRead(id);
        }

        const outcome = await this.host.workItemRunner.runWorkItem(mission, next);
        const latest = this.host.store.get(id)!;
        await this.host.store.updateMission(id, { roundsCompleted: (latest.roundsCompleted || 0) + 1 });
        if (outcome === "awaiting_input" || outcome === "blocked") return this.runPassOutcomeAfterStoreRead(id);

        const maxRetries = vscode.workspace.getConfiguration().get<number>("myAi.missions.maxAutoRetries", 2);
        const markDeadLetterAfterRetries = vscode.workspace
          .getConfiguration()
          .get<boolean>("myAi.missions.markDeadLetterAfterRetryExhaustion", true);
        const freshMission = this.host.store.get(id)!;
        const failedItem = freshMission.queue.find((w) => w.id === next.id);
        if (failedItem?.status === "failed") {
          const retryDecision = shouldAutoRetry(failedItem, maxRetries);
          if (retryDecision.shouldRetry) {
            const retryItem = createRetryWorkItem(failedItem);
            await this.host.store.enqueue(id, [retryItem]);
            await this.host.store.saveEvent(id, {
              level: "info",
              source: "orchestrator",
              message: `Auto-retry: enqueued "${retryItem.title}" (${retryDecision.reason}) after failure: ${(failedItem.output || "").slice(0, 200)}`
            });
          } else if (markDeadLetterAfterRetries && shouldMarkWorkItemDeadLetter(failedItem, retryDecision)) {
            await this.markDeadLetterAfterRetryExhaustion(id, failedItem, retryDecision.reason);
          }
        }

        if (await this.tryCollapseMissionToCompleted(id)) return this.runPassOutcomeAfterStoreRead(id);
      }

      await this.host.store.saveEvent(id, {
        level: "warn",
        source: "orchestrator",
        message: "Run reached maxStepsPerRun. Mission remains resumable."
      });
      this.host.pendingCompletionReason.delete(id);
      await this.host.store.updateMission(id, { status: "queued", blockReasonCode: undefined });
      return this.runPassOutcomeAfterStoreRead(id);
    } catch (err) {
      this.host.pendingCompletionReason.delete(id);
      const detail = err instanceof Error ? err.stack || err.message : String(err);
      const blockerShort = err instanceof Error ? err.message : String(err);
      try {
        const missionSnap = this.host.store.get(id);
        if (missionSnap) {
          const running = missionSnap.queue.filter((w) => w.status === "running");
          for (const wi of running) {
            await this.host.updateWorkItemWithHardStopInvariant(id, wi, {
              status: "failed",
              hardStopClass: "unknown_hard_stop",
              output: `[orchestrator_uncaught_error] ${detail}`.slice(0, 12_000),
              activeMutatingToolCall: undefined
            });
          }
        }
      } catch (reconcileErr) {
        await this.host.store.saveEvent(id, {
          level: "error",
          source: "orchestrator",
          message: `Failed to reconcile running work items after uncaught error: ${
            reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr)
          }`
        });
      }
      await this.host.store.updateMission(id, {
        status: "failed",
        blocker: blockerShort,
        validationState: "failed",
        blockReasonCode: undefined,
        failureReasonCode: "orchestrator_uncaught_error"
      });
      await this.host.store.saveEvent(id, {
        level: "error",
        source: "orchestrator",
        message: detail
      });
      return this.runPassOutcomeAfterStoreRead(id);
    } finally {
      const pass = this.host.inFlightRunPass.get(id);
      this.host.running.delete(id);
      if (pass) {
        this.host.inFlightRunPass.delete(id);
        pass.finish();
      } else {
        finishPass();
      }
    }
  }

  private runPassOutcomeAfterStoreRead(missionId: string): RunMissionPassOutcome {
    const m = this.host.store.get(missionId);
    if (!m) return { kind: "noop_missing_mission", missionId };
    return { kind: "ran_pass", missionId, statusAfterPass: m.status };
  }

  private async markDeadLetterAfterRetryExhaustion(
    missionId: string,
    item: WorkItem,
    retryReason: string
  ): Promise<void> {
    if (item.deadLetter) return;
    const note = `\n\n---\nDEAD LETTER: Automatic retry budget exhausted (${retryReason}). Operator next steps: fix the root cause, skip or remove this work item, or reset it to todo after adjusting inputs. No further automatic retries will be enqueued for this failure row.`;
    await this.host.updateWorkItemWithHardStopInvariant(missionId, item, {
      deadLetter: true,
      deadLetterAt: Date.now(),
      output: `${item.output || ""}${note}`.trim()
    });
    await this.host.store.saveEvent(missionId, {
      level: "error",
      source: "orchestrator",
      message: `Work item marked dead letter (retries exhausted): "${item.title}" (${item.id})`,
      data: { workItemId: item.id, role: item.role, reason: retryReason }
    });
  }

  /**
   * Handles the case where the main loop finds no eligible next work item.
   * Returns "continue" to retry the loop iteration, or "terminal" to exit the loop.
   */
  private async handleEmptyQueue(
    id: string,
    mission: Mission,
    gate: ImplementerHardStopGateResult
  ): Promise<"continue" | "terminal"> {
    if (gate.gate) {
      const desiredStatus =
        gate.failureClass === "approval_pending"
          ? "awaiting_input"
          : gate.failureClass === "timeout_or_system_abort"
            ? undefined
            : "blocked";
      if (desiredStatus) {
        const blocker =
          mission.blocker ||
          (desiredStatus === "awaiting_input"
            ? "Awaiting approval"
            : `Blocked: ${gate.reason || gate.failureClass || "required implementer blocked/failed"}`);
        await this.host.store.updateMission(id, {
          status: desiredStatus,
          blocker,
          blockReasonCode: missionBlockReasonFromDownstreamGate(gate.failureClass, desiredStatus, gate.reason)
        });
        return "terminal";
      }
    }

    const enforced = await this.host.ensureClosurePolicy(mission);
    if (enforced) return "continue";

    await this.autoDemoteObsolescentQueueItems(id);
    await this.autoDemoteSupersededTerminalItems(id);
    let refreshed = this.host.store.get(id)!;
    const stillRunning = refreshed.queue.some((w) => w.status === "running");
    if (stillRunning) {
      const normalized = recoverInterruptedQueueItems(refreshed.queue);
      if (normalized.recoveredCount > 0) {
        await this.host.store.updateMission(id, { queue: normalized.queue });
        await this.host.store.saveEvent(id, {
          level: "info",
          source: "orchestrator",
          message: `Normalized ${normalized.recoveredCount} stale running work item(s) to todo (no eligible next while queue showed running).`
        });
        await this.host.store.noteProgress(id);
        await this.autoDemoteObsolescentQueueItems(id);
      }
      if (normalized.replayRiskCount > 0) {
        await this.host.store.saveEvent(id, {
          level: "warn",
          source: "orchestrator",
          message: `Blocked ${normalized.replayRiskCount} stale running work item(s) from automatic replay because a mutating tool may already have executed.`
        });
      }
      return "continue";
    }

    refreshed = this.host.store.get(id)!;
    if (
      refreshed.blueprint?.status === "awaiting_approval" &&
      !refreshed.queue.some((w) => w.status === "todo" || w.status === "running")
    ) {
      await this.host.store.updateMission(id, {
        status: "awaiting_input",
        blocker: "Approve or revise the mission blueprint.",
        blockReasonCode: "awaiting_blueprint_approval"
      });
      return "terminal";
    }

    const hasBlocked = refreshed.queue.some((w) => w.status === "blocked" || w.status === "failed");
    let terminalStatus = resolveCompletionStatus(hasBlocked, refreshed.policy.closureRequired, refreshed.validationState);
    if (terminalStatus === "completed" && blueprintBlocksMissionCompletion(refreshed)) {
      await this.host.store.enqueue(id, [
        {
          id: uid("work"),
          title: "Blueprint completion gap",
          role: "planner",
          status: "todo",
          prompt: `Approved blueprint is not fully satisfied. Pending steps: ${(computeBlueprintProgress(refreshed)?.pendingStepIds || []).join(", ")}. Emit WORK: lines to close gaps.`
        }
      ]);
      await this.host.store.saveEvent(id, {
        level: "warn",
        source: "blueprint-contract",
        message: "Blocked premature completion: blueprint steps remain."
      });
      await this.host.store.noteProgress(id);
      return "continue";
    }
    if (terminalStatus === "completed" && hasRequiredUnresolvedWork(refreshed)) {
      terminalStatus = "blocked";
      this.host.pendingCompletionReason.delete(id);
      await this.host.store.updateMission(id, {
        status: terminalStatus,
        blocker: "Mission cannot complete while required work items are still todo or running.",
        blockReasonCode: "required_work_open",
        result: refreshed.memory
          .slice(-8)
          .map((m) => `- ${m.text}`)
          .join("\n")
      });
      this.host.onMissionTerminal?.(id, terminalStatus);
      return "terminal";
    }
    const terminalCompletionReason =
      terminalStatus === "completed" ? this.resolveCompletionReasonForCompleted(id, refreshed.queue) : undefined;
    if (
      terminalStatus === "blocked" &&
      this.hasBlockingImplementerOutcome(refreshed) &&
      refreshed.validationState === "passed"
    ) {
      await this.host.store.saveEvent(id, {
        level: "warn",
        source: "orchestrator",
        message:
          "Mission blocked with failed/blocked required implementer work while validationState is passed; do not treat as successfully shipped."
      });
    }
    const finalBlocker =
      terminalStatus === "completed" ? undefined : refreshed.blocker || "Closure policy not satisfied";
    const terminalBlockReason =
      terminalStatus === "completed"
        ? undefined
        : terminalStatus === "blocked" && finalBlocker === "Closure policy not satisfied"
          ? ("closure_not_satisfied" as const)
          : terminalStatus === "blocked" &&
              typeof finalBlocker === "string" &&
              /manual review required before retrying interrupted mutating work/i.test(finalBlocker)
            ? ("manual_review_required" as const)
          : terminalStatus === "blocked"
            ? ("generic_blocked" as const)
            : undefined;
    await this.host.store.updateMission(id, {
      status: terminalStatus,
      blocker: finalBlocker,
      blockReasonCode: terminalBlockReason,
      result: refreshed.memory
        .slice(-8)
        .map((m) => `- ${m.text}`)
        .join("\n"),
      ...(terminalStatus === "completed" && terminalCompletionReason ? { completionReason: terminalCompletionReason } : {})
    });
    this.host.onMissionTerminal?.(id, terminalStatus);
    return "terminal";
  }

  private dependenciesMet(mission: Mission, item: WorkItem): boolean {
    if (!item.dependsOn?.length) return true;
    return item.dependsOn.every((dep) => dependencyEdgeSatisfied(mission.queue.find((w) => w.id === dep)?.status));
  }

  /**
   * Required implementer work did not succeed (blocked on approval/policy/abort, or tool failure).
   * Used for terminal honesty signaling only (warn event); we do not mutate `validationState` here because
   * closure/resume logic still keys off `validationState === "passed"` for inject/skip decisions.
   *
   * Current progression policy (minimal queue — no role gating):
   * - Approval-rejected / tool-failed / policy-blocked / operator-aborted implementer: same pass stops; later
   *   `runMission`/`resumeMission` may still run reviewer and validator todos (no `dependsOn` on standard queue).
   * - Timeout/system stream abort on implementer: item `failed`, mission continues in-pass (recovery path).
   * - Terminal: `resolveCompletionStatus` keeps mission `blocked` (not `completed`) while any blocked/failed item
   *   remains; if validator already set `validationState: "passed"`, UI must not equate that with shipped code —
   *   see terminal warn event when implementer is still blocked/failed.
   */
  private hasBlockingImplementerOutcome(mission: Mission): boolean {
    return mission.queue.some(
      (w) =>
        w.role === "implementer" &&
        (w.status === "blocked" || w.status === "failed") &&
        w.requiredForCompletion !== false
    );
  }
}
