import * as vscode from "vscode";
import { ContextCollector } from "../context/ContextCollector";
import { EnhancedContextCollector } from "../context/EnhancedContextCollector";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { MissionStore } from "./MissionStore";
import { AgentFactory } from "../agents/AgentFactory";
import { Mission, WorkItem } from "../types";
import { uid } from "../util";
import { ApprovalManager } from "../approvals/ApprovalManager";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import { isMissionTerminalLifecycleStatus } from "./LifecycleRules";
import {
  countOperatorStreamAbortRequeues,
  recoverInterruptedQueueItems,
  requeueOperatorStreamAbortedWorkItems
} from "./resumeRecovery";
import { isActiveWorkItemStatus, isRunnableWorkItemStatus } from "./workItemLifecycle";
import { reconcileStaleApprovalPendingHardStops } from "./missionApprovalGateReconcile";
import { normalizeMissionQueueForRunner } from "./missionQueueNormalize";
import { autonomyShouldScheduleNextPassAfterStepCap } from "./missionRunnerAutonomy";
import { loadMissionAutonomyPolicy } from "../security/missionAutonomyPolicy";
import { enforceClosurePolicy } from "./missionClosurePolicy";
import type { MissionFileTracker } from "./MissionFileTracker";
import type {
  ResolveApprovalOutcome,
  ResumeMissionOutcome,
  RunMissionPassOutcome,
  StartMissionResult
} from "./missionActionResult";
import { updateWorkItemWithImplementerHardStopInvariant } from "./implementerHardStopWorkItemWrite";
import { extractKeywords } from "./orchestrator/orchestratorLeafHelpers";
import {
  MissionOrchestratorWorkItemRunner,
  type WorkItemRunnerHost
} from "./orchestrator/missionOrchestratorWorkItemRunner";
import { MissionOrchestratorRunLoop } from "./orchestrator/missionOrchestratorRunLoop";
import { MissionOrchestratorApprovalResolver } from "./orchestrator/missionOrchestratorApprovalResolver";
import { MissionOrchestratorBlueprintFlow } from "./orchestrator/missionOrchestratorBlueprintFlow";
import { MissionOrchestratorHardStopTelemetry } from "./orchestrator/missionOrchestratorHardStopTelemetry";
import { waitForMissionTerminalLifecycleWhileIdle } from "./orchestrator/missionOrchestratorLifecycleWaits";
import { blueprintStructuredFlowEnabled, normalizeBlueprintModeSetting } from "./missionBlueprintMode";
import { compileMissionPreflight } from "./missionCompiler";

import type { MissionAgentRunForTest, MissionToolExecutor } from "./missionOrchestratorContracts";
export type { MissionAgentRunForTest, MissionToolExecutor } from "./missionOrchestratorContracts";

export type {
  ResolveApprovalOutcome,
  ResumeMissionOutcome,
  RunMissionPassOutcome,
  StartMissionResult
} from "./missionActionResult";

/**
 * Architecture map: regions and invariants for this large coordinator live in
 * `.dev/ARCHITECTURE_ORCHESTRATOR.md` (P3-T-001). Quick index:
 * - Public entry: `startMission`, `resumeMission`, `runMission`, `resolveApproval`, blueprint APIs.
 * - Approval resolution: `resolveApproval` in `./orchestrator/missionOrchestratorApprovalResolver.ts`.
 * - Run loop: `runMission` in `./orchestrator/missionOrchestratorRunLoop.ts` (maxSteps, collapse, gate, next item, retries).
 * - Work item + tool follow-up: `runWorkItem`, `executeWorkItemToolCalls`, mutating markers.
 * - Empty queue / terminal: `handleEmptyQueue`, `tryCollapseMissionToCompleted`.
 * - Concurrency: `running`, `inFlightRunPass`, `joinInFlightRunLoopPass`.
 * - Pure helpers: `./orchestrator/orchestratorLeafHelpers.ts`.
 * - Work item + tools slice: `./orchestrator/missionOrchestratorWorkItemRunner.ts`.
 * - Blueprint operator flow: `./orchestrator/missionOrchestratorBlueprintFlow.ts`.
 * - Hard-stop contract telemetry: `./orchestrator/missionOrchestratorHardStopTelemetry.ts`.
 * - Terminal lifecycle wait (store subscription): `./orchestrator/missionOrchestratorLifecycleWaits.ts`.
 */
export class MissionOrchestrator {
  private readonly agents: AgentFactory;
  private readonly approvals = new ApprovalManager();
  private readonly running = new Set<string>();
  /**
   * Single in-flight `runMission` pass per mission: `done` settles after `running` clears for that pass.
   * Used so concurrent `runMission` / `resumeMission` calls join the active pass instead of no-op returning.
   */
  private readonly inFlightRunPass = new Map<string, { done: Promise<void>; finish: () => void }>();
  /** When set, merged into `completionReason` on next terminal `completed` transition for this mission. */
  private readonly pendingCompletionReason = new Map<string, NonNullable<Mission["completionReason"]>>();
  /** One controller per mission for the currently executing work item LLM stream. */
  private readonly missionWorkAbort = new Map<string, AbortController>();
  /** Track the reason why a mission work item was aborted. */
  private readonly missionAbortReason = new Map<string, "operator" | "system" | "timeout" | "unknown">();
  /** Dedupe stale-research warnings when the same evidence rows remain stale across multiple mutations. */
  private readonly lastStaleEvidenceWarnSigByMission = new Map<string, string>();
  private readonly hardStopTelemetry: MissionOrchestratorHardStopTelemetry;
  private readonly blueprintFlow: MissionOrchestratorBlueprintFlow;
  private readonly workItemRunner: MissionOrchestratorWorkItemRunner;
  private readonly runLoop: MissionOrchestratorRunLoop;
  private readonly approvalResolver: MissionOrchestratorApprovalResolver;
  /** External callback for streaming LLM tokens to UI during agent runs. */
  onAgentStreamChunk?: (missionId: string, workItemId: string, role: string, text: string) => void;
  /** External callback when an agent's LLM stream finishes for a work item. */
  onAgentStreamDone?: (missionId: string, workItemId: string) => void;
  /** External callback when a mission reaches terminal status (completed/blocked/failed/cancelled). */
  onMissionTerminal?: (missionId: string, status: string) => void;

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly collector: ContextCollector,
    private readonly store: MissionStore,
    private readonly tools: MissionToolExecutor,
    private readonly globalMemory: GlobalMemoryStore,
    private readonly agentRunForTest?: MissionAgentRunForTest,
    private readonly fileTracker?: MissionFileTracker
  ) {
    this.agents = new AgentFactory(providers, globalMemory, collector);
    this.hardStopTelemetry = new MissionOrchestratorHardStopTelemetry(this.store);
    const o = this;
    let runLoopRef!: MissionOrchestratorRunLoop;
    this.blueprintFlow = new MissionOrchestratorBlueprintFlow({
      store: o.store,
      globalMemory: o.globalMemory,
      fileTracker: o.fileTracker,
      scheduleRunMission: (missionId) => void o.runMission(missionId)
    });
    this.workItemRunner = new MissionOrchestratorWorkItemRunner(this.createWorkItemRunnerHost());
    this.runLoop = runLoopRef = new MissionOrchestratorRunLoop(this.createRunLoopHost());
    this.approvalResolver = new MissionOrchestratorApprovalResolver(this.createApprovalResolverHost());
  }

  private createWorkItemRunnerHost(): WorkItemRunnerHost {
    const o = this;
    return {
      store: o.store,
      tools: o.tools,
      globalMemory: o.globalMemory,
      collector: o.collector,
      agents: o.agents,
      agentRunForTest: o.agentRunForTest,
      approvals: o.approvals,
      pendingCompletionReason: o.pendingCompletionReason,
      missionWorkAbort: o.missionWorkAbort,
      missionAbortReason: o.missionAbortReason,
      lastStaleEvidenceWarnSigByMission: o.lastStaleEvidenceWarnSigByMission,
      get onAgentStreamChunk() {
        return o.onAgentStreamChunk;
      },
      get onAgentStreamDone() {
        return o.onAgentStreamDone;
      },
      updateWorkItemWithHardStopInvariant: (missionId, itemBeforePatch, patch) =>
        o.updateWorkItemWithHardStopInvariant(missionId, itemBeforePatch, patch),
      enqueueSynthesizedBlueprintWork: (missionId) => o.blueprintFlow.enqueueSynthesizedBlueprintWork(missionId),
      addBlueprintMemoryMirror: (missionId) => o.blueprintFlow.addBlueprintMemoryMirror(missionId),
      maybeEnqueuePlanFidelityReview: (missionId, implementerItem) =>
        o.blueprintFlow.maybeEnqueuePlanFidelityReview(missionId, implementerItem)
    };
  }

  /**
   * Persists the mission, enqueues initial planning, and schedules `runMission` without awaiting it.
   * The returned mission is typically `queued`; do not treat this snapshot as terminal completion.
   * To wait until automatic execution stops at a terminal lifecycle status (`blocked`, `failed`,
   * `cancelled`, or `completed`), use `whenMissionReachesTerminalLifecycleStatus` (still not “success”).
   */
  async startMission(title: string, prompt: string, providerId: string, model?: string): Promise<StartMissionResult> {
    const mission = await this.store.create(title, prompt, providerId, model);
    await this.compileMissionContractPreflight(mission.id);
    const compiledMission = this.store.get(mission.id) || mission;
    await this.recordMissionStartBaseline(compiledMission);
    const blueprintMode = normalizeBlueprintModeSetting(
      vscode.workspace.getConfiguration().get<unknown>("myAi.missions.blueprintMode", "off")
    );
    if (blueprintStructuredFlowEnabled(blueprintMode)) {
      const preQ = vscode.workspace.getConfiguration().get<boolean>("myAi.missions.preBlueprintClarification", false);
      if (preQ) {
        await this.store.enqueue(mission.id, [
          {
            id: uid("work"),
            title: "Pre-blueprint clarification",
            role: "planner",
            status: "todo",
            workItemPurpose: "pre_blueprint_clarify",
            prompt: "Produce structured clarification questions only (see system instructions)."
          }
        ]);
      } else {
        await this.store.enqueue(mission.id, [
          {
            id: uid("work"),
            title: "Mission blueprint (full plan)",
            role: "planner",
            status: "todo",
            workItemPurpose: "blueprint_generate",
            prompt: "Generate the full mission blueprint as structured JSON (see system instructions)."
          }
        ]);
      }
    } else {
      await this.store.enqueue(mission.id, [
        {
          id: uid("work"),
          title: "Initial planning",
          role: "planner",
          status: "todo",
          prompt: "Break down the mission into bounded work items and propose an execution order."
        }
      ]);
    }
    await this.store.noteProgress(mission.id);
    void this.runMission(mission.id);
    const m = this.store.get(mission.id)!;
    return { mission: m, pass: { kind: "scheduled_pass", missionId: m.id } };
  }

  /**
   * Operator-facing resume: normalize interrupted `running` items, re-queue work blocked only by an
   * operator stream abort, then run the mission loop. Resolves when the `runMission` pass this call
   * cares about finishes: either the pass this invocation schedules, or — if a pass is already in
   * flight — that existing pass (join; no second pass, no resume side-effects while the loop runs).
   * No-op for terminal missions, `awaiting_input` (except `post_validator_checkpoint` and
   * `approval_gate_stale` — those clear to `queued` and run; stale gate reconciles queue first), or
   * pending approvals (promise resolves immediately).
   * A `queued` mission after `maxStepsPerRun` is normal: awaiting this method completes only that pass,
   * not full terminal completion unless policy/queue allow it in one pass.
   * For “idle and terminal lifecycle” in one call, see `whenMissionReachesTerminalLifecycleStatus`.
   */
  async resumeMission(id: string): Promise<ResumeMissionOutcome> {
    if (this.running.has(id)) {
      await this.joinInFlightRunLoopPass(id);
      return { kind: "joined_in_flight_pass", missionId: id };
    }
    const mission = this.store.get(id);
    if (!mission) throw new Error(`Mission not found: ${id}`);
    if (["completed", "cancelled"].includes(mission.status)) {
      return { kind: "noop_terminal", missionId: id, status: mission.status };
    }
    if (mission.status === "failed") {
      await this.store.updateMission(id, {
        status: "queued",
        blocker: undefined,
        blockReasonCode: undefined,
        failureReasonCode: undefined
      });
      await this.store.saveEvent(id, {
        level: "info",
        source: "orchestrator",
        message:
          "Operator resumed after mission failure; status reset to queued for a salvage pass. Review recent events and queue before relying on automatic execution."
      });
    }
    const awaitingInputResumable =
      mission.blockReasonCode === "post_validator_checkpoint" ||
      mission.blockReasonCode === "approval_gate_stale";
    if (mission.status === "awaiting_input" && !awaitingInputResumable) {
      return { kind: "gated_awaiting_input", missionId: id };
    }
    if (mission.approvals.some((a) => a.status === "pending")) {
      return { kind: "gated_pending_approval", missionId: id };
    }
    let queueForRecovery = mission.queue;
    if (mission.blockReasonCode === "approval_gate_stale") {
      const { queue: reconciled, changedIds } = reconcileStaleApprovalPendingHardStops(mission.queue, mission.approvals);
      queueForRecovery = reconciled;
      if (changedIds.length > 0) {
        await this.store.saveEvent(id, {
          level: "info",
          source: "orchestrator",
          message: `Reconciled approval_gate_stale: cleared stale approval_pending on work item(s): ${changedIds.join(", ")}.`,
          data: { workItemIds: changedIds }
        });
      } else {
        await this.store.saveEvent(id, {
          level: "warn",
          source: "orchestrator",
          message:
            "Resume on approval_gate_stale: no queue rows had stale approval_pending (continuing with recovery pass)."
        });
      }
    }
    const recovered = recoverInterruptedQueueItems(queueForRecovery);
    const queueAfterAbortRequeue = requeueOperatorStreamAbortedWorkItems(recovered.queue);
    const operatorAbortRequeues = countOperatorStreamAbortRequeues(mission.queue, queueAfterAbortRequeue);
    await this.store.updateMission(id, {
      status: "queued",
      blocker: undefined,
      blockReasonCode: undefined,
      queue: queueAfterAbortRequeue
    });
    if (recovered.recoveredCount > 0) {
      await this.store.saveEvent(id, {
        level: "warn",
        source: "orchestrator",
        message: `Recovered ${recovered.recoveredCount} interrupted running work item(s) and re-queued them for resume.`
      });
    }
    if (recovered.replayRiskCount > 0) {
      await this.store.saveEvent(id, {
        level: "warn",
        source: "orchestrator",
        message: `Blocked ${recovered.replayRiskCount} interrupted running work item(s) from automatic replay because a mutating tool may already have executed.`
      });
    }
    if (operatorAbortRequeues > 0) {
      await this.store.saveEvent(id, {
        level: "info",
        source: "orchestrator",
        message: `Re-queued ${operatorAbortRequeues} work item(s) blocked by operator stream abort so they can run again after resume.`
      });
    }

    if (this.collector instanceof EnhancedContextCollector) {
      try {
        const resumeCtx = await this.collector.collectForMission({ isFirstWorkItem: false, keywords: extractKeywords(mission.prompt, 3) });
        const contextParts: string[] = [];
        if (resumeCtx.gitStatus) contextParts.push(`Git: ${resumeCtx.gitStatus.slice(0, 300)}`);
        if (resumeCtx.allDiagnosticsSummary) contextParts.push(`Diagnostics: ${resumeCtx.allDiagnosticsSummary.slice(0, 300)}`);
        if (contextParts.length) {
          await this.store.addMemory(id, {
            kind: "checkpoint",
            text: `[Resume context refresh] ${contextParts.join(" | ")}`,
            tags: ["resume", "context"],
            sourceMissionId: id,
          });
        }
      } catch { /* context reload is best-effort */ }
    }

    return await this.runMission(id);
  }

  async resumeActiveMissions(): Promise<void> {
    for (const id of this.store.getActiveMissionIds()) {
      const mission = this.store.get(id);
      if (!mission) continue;
      if (mission.status === "awaiting_input") continue;
      if (mission.approvals.some((a) => a.status === "pending")) continue;
      if (mission.status === "blocked") {
        const recoverableBlockedWork = mission.queue.some(
          (item) =>
            isActiveWorkItemStatus(item.status) ||
            (item.status === "blocked" && item.hardStopClass === "operator_abort")
        );
        if (!recoverableBlockedWork) continue;
      }
      await this.resumeMission(id);
    }
  }

  /** Abort the in-flight LLM stream for a mission (sidebar / operator cancel). */
  abortMissionWork(missionId: string, reason: "operator" | "system" | "timeout" = "operator"): void {
    const ac = this.missionWorkAbort.get(missionId);
    // Avoid "sticky" abort reasons: if no stream is in-flight, do not record a reason
    // that could be misattributed to a later unrelated cancellation/timeout.
    if (!ac) return;
    this.missionAbortReason.set(missionId, reason);
    ac.abort();
  }

  /** True while `runMission` holds this mission in its main loop (heartbeat must not count as stalled). */
  isMissionRunLoopActive(missionId: string): boolean {
    return this.running.has(missionId);
  }

  /**
   * Resolves when no `runMission` pass is in progress for this id (`running` set is clear).
   * This is **not** “mission finished”: after idle, `store.get(id).status` may still be `queued`,
   * `awaiting_input`, `blocked`, etc. Use `isMissionTerminalLifecycleStatus` on the stored status when
   * you need “no further automatic work until operator acts.”
   *
   * Pairs with: `startMission` / `resolveApproval` (fire-and-forget `runMission`), and with
   * `resumeMission` / `runMission` joins on an in-flight pass (all await the same pass completion).
   */
  async whenMissionRunLoopIdle(missionId: string, options?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 15_000;
    const start = Date.now();
    while (this.running.has(missionId)) {
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs) {
        throw new Error(`whenMissionRunLoopIdle: timeout after ${timeoutMs}ms for mission ${missionId}`);
      }
      const pass = this.inFlightRunPass.get(missionId);
      if (pass) {
        await Promise.race([
          pass.done,
          new Promise<never>((_, rej) =>
            setTimeout(
              () => rej(new Error(`whenMissionRunLoopIdle: timeout after ${timeoutMs}ms for mission ${missionId}`)),
              timeoutMs - elapsed
            )
          )
        ]);
        continue;
      }
      await new Promise<void>((r) => setImmediate(r));
    }
  }
  private createRunLoopHost(): import("./orchestrator/missionOrchestratorRunLoop").RunLoopHost {
    const o = this;
    return {
      store: o.store,
      running: o.running,
      inFlightRunPass: o.inFlightRunPass,
      pendingCompletionReason: o.pendingCompletionReason,
      workItemRunner: o.workItemRunner,
      get onMissionTerminal() {
        return o.onMissionTerminal;
      },
      updateWorkItemWithHardStopInvariant: (missionId, itemBeforePatch, patch) =>
        o.updateWorkItemWithHardStopInvariant(missionId, itemBeforePatch, patch),
      noteMalformedImplementerHardStopEvent: (missionId, mission, gate) =>
        o.hardStopTelemetry.noteMalformedImplementerHardStopEvent(missionId, mission, gate),
      ensureClosurePolicy: (mission) => o.ensureClosurePolicy(mission),
      abortMissionWork: (missionId) => o.abortMissionWork(missionId),
      normalizeQueueBeforeRunStep: (missionId) => o.normalizeQueueBeforeRunStep(missionId)
    };
  }

  private async normalizeQueueBeforeRunStep(missionId: string): Promise<void> {
    const m = this.store.get(missionId);
    if (!m) return;
    const { queue, staleApprovalIds, mutated } = normalizeMissionQueueForRunner(m.queue, m.approvals);
    if (!mutated) return;
    await this.store.updateMission(missionId, { queue });
    if (staleApprovalIds.length) {
      await this.store.saveEvent(missionId, {
        level: "info",
        source: "orchestrator",
        message: `Queue normalized: reconciled ${staleApprovalIds.length} stale approval gate(s).`,
        data: { workItemIds: staleApprovalIds }
      });
    }
    await this.store.noteProgress(missionId);
  }

  private missionHasRunnableOrActiveWork(m: Mission): boolean {
    return m.queue.some((w) => isRunnableWorkItemStatus(w.status) || isActiveWorkItemStatus(w.status));
  }

  private createApprovalResolverHost(): import("./orchestrator/missionOrchestratorApprovalResolver").ApprovalResolverHost {
    const o = this;
    return {
      store: o.store,
      workItemRunner: o.workItemRunner,
      pendingCompletionReason: o.pendingCompletionReason,
      updateWorkItemWithHardStopInvariant: (missionId, itemBeforePatch, patch) =>
        o.updateWorkItemWithHardStopInvariant(missionId, itemBeforePatch, patch),
      scheduleRunMission: (missionId) => void o.runMission(missionId)
    };
  }

  /** Await the current `runMission` pass for `id`, if any; otherwise resolve immediately. */
  private joinInFlightRunLoopPass(id: string): Promise<void> {
    return this.runLoop.joinInFlightRunLoopPass(id);
  }

  async runMission(id: string): Promise<RunMissionPassOutcome> {
    const outcome = await this.runLoop.runMission(id);
    if (outcome.kind === "ran_pass" && outcome.stopReason) {
      await this.store.updateRuntime(id, { lastRunPassStopReason: outcome.stopReason });
    }
    if (outcome.kind !== "ran_pass" || outcome.stopReason !== "max_steps_per_run") {
      return outcome;
    }
    const cfg = vscode.workspace.getConfiguration();
    const policy = loadMissionAutonomyPolicy((key, def) => cfg.get(key, def));
    if (!autonomyShouldScheduleNextPassAfterStepCap(policy.mode, policy.autoContinuePasses)) {
      return outcome;
    }
    const maxChains = cfg.get<number>("myAi.missions.autonomy.maxAutonomousStepCapChains", 2000);
    const m = this.store.get(id);
    if (!m || m.status !== "queued") {
      return outcome;
    }
    const chains = m.runtime?.autonomousStepCapChainCount ?? 0;
    if (chains > maxChains) {
      await this.store.saveEvent(id, {
        level: "warn",
        source: "orchestrator",
        message: `Autonomous step-cap chaining stopped: exceeded myAi.missions.autonomy.maxAutonomousStepCapChains (${maxChains}).`
      });
      return outcome;
    }
    if (!this.missionHasRunnableOrActiveWork(m)) {
      return outcome;
    }
    queueMicrotask(() => {
      void this.runMission(id);
    });
    return outcome;
  }


  /**
   * Waits until `store.get(missionId).status` satisfies `isMissionTerminalLifecycleStatus` (`completed`,
   * `blocked`, `failed`, or `cancelled`) or `timeoutMs` elapses.
   *
   * This is **not** “mission succeeded”: `blocked` / `failed` are terminal for automatic execution too.
   * It is also **not** run-loop idle: `queued`, `running`, and `awaiting_input` keep waiting (subject to
   * timeout) unless something else drives the mission to a terminal status.
   *
   * Implementation reuses `whenMissionRunLoopIdle` while a pass is active; when idle and non-terminal,
   * waits on `MissionStore` mutation notifications until status becomes terminal or the deadline elapses.
   * Does not call `resumeMission` or change queue/approval policy.
   */
  async whenMissionReachesTerminalLifecycleStatus(
    missionId: string,
    options?: { timeoutMs?: number }
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 120_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const mission = this.store.get(missionId);
      if (!mission) {
        throw new Error(`Mission not found: ${missionId}`);
      }
      if (isMissionTerminalLifecycleStatus(mission.status)) {
        return;
      }

      const now = Date.now();
      if (now >= deadline) {
        throw new Error(
          `whenMissionReachesTerminalLifecycleStatus: timeout after ${timeoutMs}ms for mission ${missionId} (status=${mission.status})`
        );
      }
      const remaining = deadline - now;

      if (this.running.has(missionId)) {
        await this.whenMissionRunLoopIdle(missionId, { timeoutMs: remaining });
      } else {
        await waitForMissionTerminalLifecycleWhileIdle(this.store, missionId, deadline, timeoutMs);
        return;
      }
    }
  }


  /**
   * Records the decision and applies it (including executing the approved tool once). Schedules mission
   * continuation with `runMission` without awaiting it, so callers return promptly; mission status may
   * still be `running` or `queued` afterward. Await `whenMissionRunLoopIdle` after this resolves to know
   * the scheduled pass finished; use `store` + `isMissionTerminalLifecycleStatus` for terminal semantics,
   * or `whenMissionReachesTerminalLifecycleStatus` to wait for a terminal lifecycle outcome (not only success).
   */
  async resolveApproval(
    missionId: string,
    approvalId: string,
    approved: boolean,
    note?: string
  ): Promise<ResolveApprovalOutcome> {
    return this.approvalResolver.resolveApproval(missionId, approvalId, approved, note);
  }


  /** Durable preflight-style record: workspace + policy at mission start (rules-aligned baseline, JSON memory). */
  private async recordMissionStartBaseline(mission: Mission): Promise<void> {
    const names = vscode.workspace.workspaceFolders?.map((f) => f.name) ?? [];
    const rootHint = names.length ? names.join(", ") : "(no workspace folder)";
    const blueprintMode = normalizeBlueprintModeSetting(
      vscode.workspace.getConfiguration().get<unknown>("myAi.missions.blueprintMode", "off")
    );
    const preset = mission.policy.policyPreset ?? "custom";
    const text = `Mission start baseline: workspace folder(s): ${rootHint}; policy preset: ${preset}; blueprintMode: ${blueprintMode}.`;
    await this.store.addMemory(mission.id, {
      kind: "summary",
      text,
      tags: ["mission_baseline", "preflight"],
      sourceMissionId: mission.id
    });
    await this.store.saveEvent(mission.id, {
      level: "info",
      source: "orchestrator",
      message: `Mission start baseline recorded (folders: ${rootHint}; preset ${preset}).`
    });
  }

  private async compileMissionContractPreflight(missionId: string): Promise<void> {
    const mission = this.store.get(missionId);
    if (!mission) return;
    const compiledContract = await compileMissionPreflight(mission);
    await this.store.updateMission(mission.id, { compiledContract });
    await this.store.updateRuntime(mission.id, {
      compilerPreflightAt: compiledContract.compiledAt,
      compilerPathCorrectionsApplied: compiledContract.metrics.pathCorrectionsApplied,
      compilerIoReclassificationsApplied:
        compiledContract.metrics.inputPathsClassified + compiledContract.metrics.outputPathsClassified,
      compilerContradictionsFound: compiledContract.metrics.contradictionsFound,
      compilerAssumptionsFilled: compiledContract.metrics.assumptionsFilled,
      compilerBlockingIssues: compiledContract.metrics.blockingIssues
    });
    await this.store.addMemory(mission.id, {
      kind: "decision",
      text: [
        `Mission compiler preflight normalized objective: ${compiledContract.normalizedObjective}`,
        compiledContract.outputRootHint ? `Output root hint: ${compiledContract.outputRootHint}` : "",
        compiledContract.inputPaths.length ? `Inputs: ${compiledContract.inputPaths.join(", ")}` : "",
        compiledContract.outputPaths.length ? `Outputs: ${compiledContract.outputPaths.join(", ")}` : "",
        compiledContract.findings.length
          ? `Findings: ${compiledContract.findings.slice(0, 4).map((finding) => finding.summary).join(" | ")}`
          : "Findings: none."
      ]
        .filter(Boolean)
        .join("\n"),
      tags: ["mission_compiler", "preflight"],
      sourceMissionId: mission.id
    });
    await this.store.saveEvent(mission.id, {
      level: compiledContract.metrics.blockingIssues > 0 ? "warn" : "info",
      source: "mission_compiler",
      telemetryKind: "compiler_preflight",
      message:
        `Mission compiler preflight completed: ${compiledContract.metrics.pathReferencesDetected} path refs, ` +
        `${compiledContract.metrics.pathCorrectionsApplied} corrections, ` +
        `${compiledContract.metrics.contradictionsFound} contradictions, ` +
        `${compiledContract.metrics.blockingIssues} blocking issue(s).`,
      data: {
        compilerVersion: compiledContract.compilerVersion,
        normalizedObjective: compiledContract.normalizedObjective,
        outputRootHint: compiledContract.outputRootHint,
        metrics: compiledContract.metrics,
        findings: compiledContract.findings
      }
    });
  }

  private async updateWorkItemWithHardStopInvariant(
    missionId: string,
    itemBeforePatch: WorkItem,
    patch: Partial<WorkItem>
  ): Promise<void> {
    await updateWorkItemWithImplementerHardStopInvariant(this.store, missionId, itemBeforePatch, patch);
  }

  private async runWorkItem(mission: Mission, item: WorkItem): Promise<"continue" | "awaiting_input" | "blocked"> {
    return this.workItemRunner.runWorkItem(mission, item);
  }


  private async ensureClosurePolicy(mission: Mission): Promise<boolean> {
    return enforceClosurePolicy(mission, this.store);
  }

  async submitPreBlueprintClarificationAnswers(
    missionId: string,
    answersMarkdown: string
  ): Promise<{ ok: boolean; message: string }> {
    return this.blueprintFlow.submitPreBlueprintClarificationAnswers(missionId, answersMarkdown);
  }

  async approveMissionBlueprint(missionId: string): Promise<{ ok: boolean; message: string }> {
    return this.blueprintFlow.approveMissionBlueprint(missionId);
  }

  async rejectMissionBlueprint(missionId: string): Promise<{ ok: boolean; message: string }> {
    return this.blueprintFlow.rejectMissionBlueprint(missionId);
  }

  async requestMissionBlueprintRevision(missionId: string, note: string): Promise<{ ok: boolean; message: string }> {
    return this.blueprintFlow.requestMissionBlueprintRevision(missionId, note);
  }

}
