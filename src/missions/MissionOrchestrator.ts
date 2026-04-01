import * as vscode from "vscode";
import { ContextCollector } from "../context/ContextCollector";
import { EnhancedContextCollector } from "../context/EnhancedContextCollector";
import { gitStashPush, gitStashPop, gitStatus } from "../tools/GitToolProvider";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import type { ToolResult } from "../tools/ToolRegistry";
import { MissionStore } from "./MissionStore";
import { AgentFactory } from "../agents/AgentFactory";
import {
  AgentRole,
  AgentRunOptions,
  AgentTurnResult,
  ChatContext,
  Mission,
  ToolCall,
  WorkItem
} from "../types";
import { isLikelyStreamAbort, uid } from "../util";
import { ApprovalManager } from "../approvals/ApprovalManager";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import { isMissionTerminalLifecycleStatus, resolveCompletionStatus } from "./LifecycleRules";
import {
  countOperatorStreamAbortRequeues,
  recoverInterruptedQueueItems,
  requeueOperatorStreamAbortedWorkItems
} from "./resumeRecovery";
import { applyToolDrivenValidatorCompletion } from "./toolDrivenValidatorCompletion";
import { shouldSkipRedundantValidatorWork } from "./redundantValidatorSkip";
import { shouldCollapseToComplete } from "./missionCompletionCollapse";
import {
  dependencyEdgeSatisfied,
  hasRequiredUnresolvedWork,
  obsolescentTodoSkipReason,
  supersededReviewerTerminalSkipReason,
  supersededValidatorTerminalSkipReason
} from "./requiredWork";
import { staleImplementerToolFailureRecoveryDecision } from "./staleEditRecovery";
import { workCompletionKindFromSuccessfulToolSteps } from "../tools/applyPatchNoOpPolicy";
import {
  resolveCompletionReasonForCompletedMission,
  shouldHonorAlreadySatisfiedNoToolRun
} from "./alreadySatisfiedWorkItem";
import { shouldEnqueueReviewerAutoRemediation } from "./reviewerRemediationPolicy";
import { computePlannerCoverageItems, enforceClosurePolicy } from "./missionClosurePolicy";
import type {
  ResolveApprovalOutcome,
  ResumeMissionOutcome,
  RunMissionPassOutcome,
  StartMissionResult
} from "./missionActionResult";
import { isKnownImplementerHardStopClassValue } from "./implementerHardStopClassInvariant";
import {
  isRequiredImplementerWorkItem,
  updateWorkItemWithImplementerHardStopInvariant
} from "./implementerHardStopWorkItemWrite";
import {
  classifyImplementerHardStopDownstreamGate,
  type ImplementerHardStopGateResult
} from "./requiredImplementerHardStopGate";
import { missionBlockReasonFromDownstreamGate } from "./missionBlockReasonCode";

/** Minimal tool surface used by the orchestrator (real `ToolRegistry` satisfies this). */
export type MissionToolExecutor = {
  execute(missionId: string, call: ToolCall): Promise<ToolResult>;
};

/** Optional test override: bypass real LLM agents while exercising orchestration. */
export type MissionAgentRunForTest = (
  mission: Mission,
  item: WorkItem,
  context: ChatContext,
  opts: AgentRunOptions
) => Promise<AgentTurnResult>;

function isPotentiallyMutatingToolCall(call: ToolCall): boolean {
  const readOnlyBuiltins = new Set(["readFile", "searchFiles", "listFiles", "getDiagnostics", "listTools", "listMcpTools"]);
  if (readOnlyBuiltins.has(call.tool)) return false;
  if (call.tool === "write_file" || call.tool === "apply_patch" || call.tool === "run_terminal") return true;
  if (call.tool.startsWith("ext.") || call.tool.startsWith("mcp.")) return true;
  return true;
}

function mutatingToolTarget(call: ToolCall): string | undefined {
  const args = (call.args || {}) as Record<string, unknown>;
  const p = args.path;
  return typeof p === "string" && p.trim() ? p : undefined;
}

function checkpointSummaryForTerminalWorkItem(item: WorkItem, terminalStatus: WorkItem["status"]): string {
  switch (terminalStatus) {
    case "blocked":
      return `${item.role} blocked: ${item.title}`;
    case "failed":
      return `${item.role} failed: ${item.title}`;
    case "skipped":
      return `${item.role} skipped: ${item.title}`;
    default:
      return `${item.role} completed: ${item.title}`;
  }
}

export type {
  ResolveApprovalOutcome,
  ResumeMissionOutcome,
  RunMissionPassOutcome,
  StartMissionResult
} from "./missionActionResult";

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
  /** Dedupe `saveEvent` when implementer hardStopClass contract is violated (signature includes offending queue rows). */
  private readonly lastMalformedHardStopEventSig = new Map<string, string>();
  /** External callback for streaming LLM tokens to UI during agent runs. */
  onAgentStreamChunk?: (missionId: string, workItemId: string, role: string, text: string) => void;
  /** External callback when an agent's LLM stream finishes for a work item. */
  onAgentStreamDone?: (missionId: string, workItemId: string) => void;

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly collector: ContextCollector,
    private readonly store: MissionStore,
    private readonly tools: MissionToolExecutor,
    private readonly globalMemory: GlobalMemoryStore,
    private readonly agentRunForTest?: MissionAgentRunForTest
  ) {
    this.agents = new AgentFactory(providers, globalMemory, collector);
  }

  /**
   * Persists the mission, enqueues initial planning, and schedules `runMission` without awaiting it.
   * The returned mission is typically `queued`; do not treat this snapshot as terminal completion.
   * To wait until automatic execution stops at a terminal lifecycle status (`blocked`, `failed`,
   * `cancelled`, or `completed`), use `whenMissionReachesTerminalLifecycleStatus` (still not “success”).
   */
  async startMission(title: string, prompt: string, providerId: string, model?: string): Promise<StartMissionResult> {
    const mission = await this.store.create(title, prompt, providerId, model);
    await this.store.enqueue(mission.id, [
      {
        id: uid("work"),
        title: "Initial planning",
        role: "planner",
        status: "todo",
        prompt: "Break down the mission into bounded work items and propose an execution order."
      }
    ]);
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
   * No-op for terminal missions, `awaiting_input`, or pending approvals (promise resolves immediately).
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
    if (["completed", "cancelled", "failed"].includes(mission.status)) {
      return { kind: "noop_terminal", missionId: id, status: mission.status };
    }
    if (mission.status === "awaiting_input") {
      return { kind: "gated_awaiting_input", missionId: id };
    }
    if (mission.approvals.some((a) => a.status === "pending")) {
      return { kind: "gated_pending_approval", missionId: id };
    }
    const recovered = recoverInterruptedQueueItems(mission.queue);
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
            item.status === "running" ||
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

  /** Await the current `runMission` pass for `id`, if any; otherwise resolve immediately. */
  private joinInFlightRunLoopPass(id: string): Promise<void> {
    return this.inFlightRunPass.get(id)?.done ?? Promise.resolve();
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
        await this.waitForMissionTerminalLifecycleWhileIdle(missionId, deadline, timeoutMs);
        return;
      }
    }
  }

  /**
   * While the run loop is idle, wait for `store` to show a terminal lifecycle status, driven by
   * `MissionStore.subscribeMissionMutation` (no fixed-interval polling).
   */
  private waitForMissionTerminalLifecycleWhileIdle(
    missionId: string,
    deadline: number,
    originalTimeoutMs: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let unsub: (() => void) | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        unsub?.();
        unsub = undefined;
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };

      const tryFinish = (): boolean => {
        const m = this.store.get(missionId);
        if (!m) {
          cleanup();
          reject(new Error(`Mission not found: ${missionId}`));
          return true;
        }
        if (isMissionTerminalLifecycleStatus(m.status)) {
          cleanup();
          resolve();
          return true;
        }
        return false;
      };

      if (tryFinish()) return;

      unsub = this.store.subscribeMissionMutation(missionId, () => {
        tryFinish();
      });

      if (tryFinish()) return;

      const rem = deadline - Date.now();
      if (rem <= 0) {
        cleanup();
        const m = this.store.get(missionId);
        reject(
          new Error(
            `whenMissionReachesTerminalLifecycleStatus: timeout after ${originalTimeoutMs}ms for mission ${missionId} (status=${m?.status})`
          )
        );
        return;
      }
      timeoutId = setTimeout(() => {
        cleanup();
        const m = this.store.get(missionId);
        reject(
          new Error(
            `whenMissionReachesTerminalLifecycleStatus: timeout after ${originalTimeoutMs}ms for mission ${missionId} (status=${m?.status})`
          )
        );
      }, rem);
    });
  }

  /**
   * When `shouldCollapseToComplete` holds, persist terminal `completed`. Used at loop start and
   * immediately after `runWorkItem` so the last allowed iteration can finish without requiring a
   * follow-up loop header (avoids hitting `maxStepsPerRun` then `queued` + heartbeat recovery).
   */
  /** Prefer explicit pending reason (e.g. stale patch); else note no-tool already_satisfied work items. */
  private resolveCompletionReasonForCompleted(id: string, queue: WorkItem[]): Mission["completionReason"] | undefined {
    const pending = this.pendingCompletionReason.get(id);
    if (pending) this.pendingCompletionReason.delete(id);
    return resolveCompletionReasonForCompletedMission(pending, queue);
  }

  private async tryCollapseMissionToCompleted(id: string): Promise<boolean> {
    await this.autoDemoteObsolescentQueueItems(id);
    await this.autoDemoteSupersededTerminalItems(id);
    const m = this.store.get(id);
    if (!m || !shouldCollapseToComplete(m)) return false;
    const completionReason = this.resolveCompletionReasonForCompleted(id, m.queue);
    await this.store.updateMission(id, {
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
      const mission = this.store.get(missionId);
      if (!mission) return;
      const todo = mission.queue.find((w) => w.status === "todo" && obsolescentTodoSkipReason(mission, w));
      if (!todo) return;
      const reason = obsolescentTodoSkipReason(mission, todo)!;
      await this.updateWorkItemWithHardStopInvariant(missionId, todo, { status: "skipped", output: reason });
      await this.store.saveEvent(missionId, {
        level: "info",
        source: "orchestrator",
        message: reason
      });
      await this.store.noteProgress(missionId);
    }
  }

  /**
   * Demotes stale reviewer/validator rows left `blocked`/`failed` after a later same-role pass completed
   * and `validationState` is `passed`, so collapse and terminal reconciliation do not treat them as
   * active failures.
   */
  private async autoDemoteSupersededTerminalItems(missionId: string): Promise<void> {
    for (;;) {
      const mission = this.store.get(missionId);
      if (!mission) return;
      const row = mission.queue.find(
        (w) => supersededValidatorTerminalSkipReason(mission, w) || supersededReviewerTerminalSkipReason(mission, w)
      );
      if (!row) return;
      const reason =
        supersededValidatorTerminalSkipReason(mission, row) || supersededReviewerTerminalSkipReason(mission, row)!;
      await this.updateWorkItemWithHardStopInvariant(missionId, row, { status: "skipped", output: reason });
      await this.store.saveEvent(missionId, {
        level: "info",
        source: "orchestrator",
        message: reason
      });
      await this.store.noteProgress(missionId);
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
    const approval = await this.store.resolveApproval(missionId, approvalId, approved ? "approved" : "rejected", note);
    if (!approval) {
      return { kind: "noop_unknown_approval", missionId, approvalId };
    }

    await this.store.saveEvent(missionId, {
      level: approved ? "info" : "warn",
      source: "approval",
      message: `${approved ? "Approved" : "Rejected"}: ${approval.title}`,
      data: approval
    });

    if (approved) {
      const approvedCall: ToolCall = { ...approval.toolCall, args: { ...approval.toolCall.args, __approved: true } };
      if (approval.workItemId) {
        const m = this.store.get(missionId);
        const wi = m?.queue.find((w) => w.id === approval.workItemId);
        if (wi) {
          await this.updateWorkItemWithHardStopInvariant(missionId, wi, {
            status: "running",
            hardStopClass: undefined,
            output: `${wi.output || ""}\n\nApproved execution in progress.`.trim()
          });
          await this.markMutatingToolExecutionStarted(missionId, wi, approvedCall);
        }
      }
      await this.store.updateMission(missionId, { status: "queued", blocker: undefined, blockReasonCode: undefined });
      const result = await this.executeAndRecordToolCall(missionId, approvedCall, ["approval", approval.kind]);
      if (approval.workItemId) {
        const m = this.store.get(missionId);
        const wi = m?.queue.find((w) => w.id === approval.workItemId);
        if (wi) {
          await this.updateWorkItemWithHardStopInvariant(missionId, wi, {
            status: "done",
            hardStopClass: undefined,
            activeMutatingToolCall: undefined,
            output: `${wi.output || ""}\n\nApproved and executed: ${result.summary}`.trim()
          });
        }
      }
      await this.store.noteProgress(missionId);
      await this.store.updateMission(missionId, { status: "queued", blockReasonCode: undefined });
      void this.runMission(missionId);
      return { kind: "approved_continuation_scheduled", missionId };
    }
    this.pendingCompletionReason.delete(missionId);
    if (approval.workItemId) {
      const m = this.store.get(missionId);
      const wi = m?.queue.find((w) => w.id === approval.workItemId);
      if (wi) {
        await this.updateWorkItemWithHardStopInvariant(missionId, wi, {
          hardStopClass: "approval_rejected"
        });
      }
    }
    await this.store.updateMission(missionId, {
      status: "blocked",
      blocker: approval.resolutionNote || "Tool request rejected",
      validationState: "failed",
      blockReasonCode: "approval_rejected"
    });
    return { kind: "rejected_mission_blocked", missionId, statusAfter: "blocked" };
  }

  /**
   * Runs at most one pass per mission at a time. If a pass is already active, awaits that pass
   * (join) and returns without starting another. Returned `statusAfterPass` is observational only.
   */
  async runMission(id: string): Promise<RunMissionPassOutcome> {
    if (this.running.has(id)) {
      await this.joinInFlightRunLoopPass(id);
      return { kind: "joined_in_flight_pass", missionId: id };
    }
    let finishPass!: () => void;
    const passDone = new Promise<void>((resolve) => {
      finishPass = resolve;
    });
    this.inFlightRunPass.set(id, { done: passDone, finish: finishPass });
    this.running.add(id);
    this.pendingCompletionReason.delete(id);

    try {
      let mission = this.store.get(id);
      if (!mission) return this.runPassOutcomeAfterStoreRead(id);
      await this.store.updateMission(id, { status: "running", blockReasonCode: undefined });
      const maxSteps = Math.max(1, vscode.workspace.getConfiguration().get<number>("myAi.missions.maxStepsPerRun", 16));

      for (let step = 0; step < maxSteps; step++) {
        mission = this.store.get(id);
        if (!mission) return this.runPassOutcomeAfterStoreRead(id);

        if (mission.status === "cancelled") {
          this.abortMissionWork(id);
          return this.runPassOutcomeAfterStoreRead(id);
        }

        const effectiveMaxRounds = computeEffectiveMaxRounds(mission);
        if ((mission.roundsCompleted || 0) >= effectiveMaxRounds) {
          this.pendingCompletionReason.delete(id);
          await this.store.updateMission(id, {
            status: "blocked",
            blocker: "Reached maxAutoRounds safety limit",
            validationState: "failed",
            blockReasonCode: "max_auto_rounds"
          });
          await this.store.updateRuntime(id, { loopGuardTrips: (mission.runtime?.loopGuardTrips || 0) + 1 });
          return this.runPassOutcomeAfterStoreRead(id);
        }

        if (await this.tryCollapseMissionToCompleted(id)) return this.runPassOutcomeAfterStoreRead(id);

        const pendingApproval = mission.approvals.find((a) => a.status === "pending");
        if (pendingApproval) {
          await this.store.updateMission(id, {
            status: "awaiting_input",
            blocker: pendingApproval.title,
            blockReasonCode: "approval_pending"
          });
          return this.runPassOutcomeAfterStoreRead(id);
        }

        const gate = classifyImplementerHardStopDownstreamGate(mission);
        await this.noteMalformedImplementerHardStopEvent(id, mission, gate);
        const allowRoleWhileGated = (role: WorkItem["role"]): boolean => role === "implementer" || role === "planner";
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

        const outcome = await this.runWorkItem(mission, next);
        const latest = this.store.get(id)!;
        await this.store.updateMission(id, { roundsCompleted: (latest.roundsCompleted || 0) + 1 });
        if (outcome === "awaiting_input" || outcome === "blocked") return this.runPassOutcomeAfterStoreRead(id);
        if (await this.tryCollapseMissionToCompleted(id)) return this.runPassOutcomeAfterStoreRead(id);
      }

      await this.store.saveEvent(id, {
        level: "warn",
        source: "orchestrator",
        message: "Run reached maxStepsPerRun. Mission remains resumable."
      });
      this.pendingCompletionReason.delete(id);
      await this.store.updateMission(id, { status: "queued", blockReasonCode: undefined });
      return this.runPassOutcomeAfterStoreRead(id);
    } catch (err) {
      this.pendingCompletionReason.delete(id);
      await this.store.updateMission(id, {
        status: "failed",
        blocker: String(err),
        validationState: "failed",
        blockReasonCode: undefined,
        failureReasonCode: "orchestrator_uncaught_error"
      });
      await this.store.saveEvent(id, {
        level: "error",
        source: "orchestrator",
        message: err instanceof Error ? err.stack || err.message : String(err)
      });
      return this.runPassOutcomeAfterStoreRead(id);
    } finally {
      const pass = this.inFlightRunPass.get(id);
      this.running.delete(id);
      if (pass) {
        this.inFlightRunPass.delete(id);
        pass.finish();
      } else {
        finishPass();
      }
    }
  }

  private runPassOutcomeAfterStoreRead(missionId: string): RunMissionPassOutcome {
    const m = this.store.get(missionId);
    if (!m) return { kind: "noop_missing_mission", missionId };
    return { kind: "ran_pass", missionId, statusAfterPass: m.status };
  }

  private async updateWorkItemWithHardStopInvariant(
    missionId: string,
    itemBeforePatch: WorkItem,
    patch: Partial<WorkItem>
  ): Promise<void> {
    await updateWorkItemWithImplementerHardStopInvariant(this.store, missionId, itemBeforePatch, patch);
  }

  /**
   * Executes tool calls from an agent turn result. Returns early if the mission must pause
   * (approval, policy block, tool failure), otherwise returns the successful tool steps
   * for completion kind derivation.
   */
  private async executeWorkItemToolCalls(
    mission: Mission,
    item: WorkItem,
    result: AgentTurnResult
  ): Promise<{
    earlyReturn?: "awaiting_input" | "blocked";
    derivedCompletionKind?: WorkItem["completionKind"];
    toolResultSummaries?: string[];
  }> {
    if (!result.toolCalls?.length) return {};

    const MUTATING_TOOLS = new Set(["writeFile", "applyPatch", "runTerminal", "runCommand", "git.commit", "git.checkout_file", "git.stash_push", "git.stash_pop", "docker.exec", "db.query"]);
    const successfulToolSteps: Array<{ tool: string; applyPatchNoop?: boolean }> = [];
    const toolResultSummaries: string[] = [];
    for (const call of result.toolCalls) {
      if (mission.dryRun && MUTATING_TOOLS.has(call.tool)) {
        toolResultSummaries.push(`[DRY-RUN] Skipped mutating tool: ${call.tool} ${JSON.stringify(call.args).slice(0, 200)}`);
        await this.store.saveEvent(mission.id, { level: "info", source: "orchestrator", message: `[DRY-RUN] Would execute: ${call.tool}` });
        continue;
      }
      await this.markMutatingToolExecutionStarted(mission.id, item, call);
      const toolResult = await this.tools.execute(mission.id, call);

      if (!toolResult.ok && toolResult.blockedByPolicy) {
        this.pendingCompletionReason.delete(mission.id);
        const blocker = `${call.tool}: ${toolResult.summary}`;
        await this.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: "blocked",
          activeMutatingToolCall: undefined,
          hardStopClass: "policy_blocked",
          output: `${result.summary}\n\nPolicy blocked tool execution: ${blocker}`
        });
        await this.store.updateMission(mission.id, {
          status: "blocked",
          blocker: `Policy blocked mission progress (${blocker})`,
          validationState: "failed",
          blockReasonCode: "policy_blocked"
        });
        await this.store.saveEvent(mission.id, {
          level: "warn",
          source: "orchestrator",
          message: `Mission paused: tool call blocked by policy (${blocker}).`
        });
        return { earlyReturn: "blocked" };
      }

      if (!toolResult.ok && !toolResult.requiresApproval) {
        const latestMission = this.store.get(mission.id)!;
        if (
          staleImplementerToolFailureRecoveryDecision(item.role, latestMission, call, toolResult.summary) ===
          "recover_to_satisfied"
        ) {
          this.pendingCompletionReason.set(mission.id, "stale_patch_but_goal_already_met");
          const blocker = `${call.tool}: ${toolResult.summary}`;
          await this.store.saveEvent(mission.id, {
            level: "info",
            source: "orchestrator",
            message: `Stale edit skipped (${blocker}); validation already passed — no code change required (stale_patch_but_goal_already_met).`
          });
          const saved = await this.store.addMemory(mission.id, {
            kind: "tool_result",
            text: `${call.tool}: ${toolResult.summary} [stale_patch_but_goal_already_met: validation already passed, patch skipped]`,
            tags: [call.tool, "stale_patch_recovery"],
            sourceMissionId: mission.id
          });
          await this.globalMemory.add(saved);
          continue;
        }
        this.pendingCompletionReason.delete(mission.id);
        const blocker = `${call.tool}: ${toolResult.summary}`;
        await this.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: "failed",
          hardStopClass: "tool_failure",
          output: `${result.summary}\n\nTool execution failed: ${blocker}`
        });
        await this.store.updateMission(mission.id, {
          status: "blocked",
          blocker: `Mission halted after tool failure (${blocker})`,
          validationState: "failed",
          blockReasonCode: "tool_failure"
        });
        await this.store.saveEvent(mission.id, {
          level: "warn",
          source: "orchestrator",
          message: `Mission paused: tool call failed (${blocker}).`
        });
        return { earlyReturn: "blocked" };
      }

      if (toolResult.requiresApproval) {
        this.pendingCompletionReason.delete(mission.id);
        const req = this.approvals.create(mission.id, call, toolResult.requiresApproval, item.id);
        await this.store.addApproval(mission.id, req);
        await this.store.updateMission(mission.id, {
          status: "awaiting_input",
          blocker: req.title,
          validationState: "failed",
          blockReasonCode: "approval_pending"
        });
        await this.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: "blocked",
          activeMutatingToolCall: undefined,
          hardStopClass: "approval_pending",
          output: `${result.summary}\n\nPending approval: ${req.title}`
        });
        await this.store.saveEvent(mission.id, {
          level: "warn",
          source: "approval",
          message: `Approval required: ${req.title}`,
          data: req
        });
        return { earlyReturn: "awaiting_input" };
      }

      successfulToolSteps.push({ tool: call.tool, applyPatchNoop: toolResult.applyPatchNoop });
      toolResultSummaries.push(`[${call.tool}] ${toolResult.summary}`);
      const isApplyPatchNoop = toolResult.applyPatchNoop === true;
      const tags = isApplyPatchNoop ? [call.tool, "apply_patch_noop"] : [call.tool];
      const prefix = isApplyPatchNoop ? "[apply_patch_noop] " : "";
      await this.recordToolResultMemoryAndEvent(mission.id, call, toolResult, tags, prefix);
    }

    const derivedCompletionKind = workCompletionKindFromSuccessfulToolSteps(successfulToolSteps) || undefined;
    return { derivedCompletionKind, toolResultSummaries };
  }

  private async markMutatingToolExecutionStarted(missionId: string, item: WorkItem, call: ToolCall): Promise<void> {
    if (!isPotentiallyMutatingToolCall(call)) return;
    await this.updateWorkItemWithHardStopInvariant(missionId, item, {
      activeMutatingToolCall: {
        tool: call.tool,
        approved: Boolean(call.args?.__approved),
        target: mutatingToolTarget(call),
        startedAt: Date.now()
      }
    });
  }

  /**
   * Execute a single tool call and record memory + event.
   * Shared between `executeWorkItemToolCalls` (agent-driven) and `resolveApproval` (operator-driven).
   */
  private async executeAndRecordToolCall(
    missionId: string,
    call: ToolCall,
    extraTags: string[] = []
  ): Promise<ToolResult> {
    const result = await this.tools.execute(missionId, call);
    await this.recordToolResultMemoryAndEvent(missionId, call, result, extraTags);
    return result;
  }

  private async recordToolResultMemoryAndEvent(
    missionId: string,
    call: ToolCall,
    result: ToolResult,
    extraTags: string[] = [],
    textPrefix = ""
  ): Promise<void> {
    const saved = await this.store.addMemory(missionId, {
      kind: "tool_result",
      text: `${textPrefix}${call.tool}: ${result.summary}`,
      tags: [call.tool, ...extraTags],
      sourceMissionId: missionId
    });
    await this.globalMemory.add(saved);
    if (result.data !== undefined) {
      await this.store.saveEvent(missionId, {
        level: result.ok ? "info" : "warn",
        source: `tool:${call.tool}`,
        message: result.summary,
        data: result.data
      });
    }
  }

  private malformedHardStopEventSignature(mission: Mission, gate: ImplementerHardStopGateResult): string {
    const impl = mission.queue.filter(
      (w) =>
        w.role === "implementer" &&
        (w.status === "blocked" || w.status === "failed") &&
        w.requiredForCompletion !== false
    );
    const kind = gate.malformed ?? "ok";
    return `${kind}:${impl
      .map((w) => `${w.id}:${w.status}:${w.hardStopClass ?? "∅"}`)
      .sort()
      .join("|")}`;
  }

  private async noteMalformedImplementerHardStopEvent(
    missionId: string,
    mission: Mission,
    gate: ImplementerHardStopGateResult
  ): Promise<void> {
    if (!gate.malformed) {
      this.lastMalformedHardStopEventSig.delete(missionId);
      return;
    }
    const sig = this.malformedHardStopEventSignature(mission, gate);
    if (this.lastMalformedHardStopEventSig.get(missionId) === sig) return;
    this.lastMalformedHardStopEventSig.set(missionId, sig);
    const message =
      gate.malformed === "missing_hard_stop_class"
        ? "Invariant: required implementer work is blocked or failed but hardStopClass is missing (contract violation). Downstream gating uses safe unknown handling; repair the queue or discard corrupt missions."
        : "Invariant: required implementer work has an invalid hardStopClass value (contract violation). Downstream gating uses safe unknown handling; repair the queue or discard corrupt missions.";
    await this.store.saveEvent(missionId, {
      level: "error",
      source: "orchestrator",
      message
    });
  }

  private ensurePlannerCoverageItems(mission: Mission): WorkItem[] {
    return computePlannerCoverageItems(mission);
  }

  private async maybeEnforcePostAgentContracts(
    missionId: string,
    item: WorkItem,
    summary: string,
    nextWorkItems: WorkItem[],
    skipReviewerRemediationForAlreadySatisfiedNoTool?: boolean
  ): Promise<void> {
    const mission = this.store.get(missionId);
    if (!mission) return;

    if (item.role === "planner" && vscode.workspace.getConfiguration().get<boolean>("myAi.missions.requirePlannerCoverage", true)) {
      const coverage = this.ensurePlannerCoverageItems(mission);
      if (coverage.length) {
        await this.store.enqueue(missionId, coverage);
        await this.store.saveEvent(missionId, { level: "info", source: "planner-contract", message: `Injected ${coverage.length} missing role coverage work items.` });
      }
    }

    if (
      shouldEnqueueReviewerAutoRemediation({
        itemRole: item.role,
        skipBecauseAlreadySatisfiedNoTool: skipReviewerRemediationForAlreadySatisfiedNoTool === true,
        autoCreateFixTasksSetting: vscode.workspace.getConfiguration().get<boolean>("myAi.reviewers.autoCreateFixTasks", true),
        summary,
        nextWorkItems
      })
    ) {
      const remediation: WorkItem[] = [
        { id: uid("work"), title: `Reviewer remediation for ${item.title}`, role: "implementer", status: "todo", prompt: `Address the concrete reviewer findings from this output and make bounded fixes with evidence: ${summary.slice(0, 500)}` },
        { id: uid("work"), title: `Re-review after ${item.title}`, role: "reviewer", status: "todo", prompt: "Re-review the remediation and confirm whether the reported defects were closed." },
        { id: uid("work"), title: `Re-validation after ${item.title}`, role: "validator", status: "todo", prompt: "Validate the remediation and decide whether further work is required." }
      ];
      await this.store.enqueue(missionId, remediation);
      await this.store.saveEvent(missionId, { level: "warn", source: "reviewer-contract", message: "Reviewer reported issues without an implementer follow-up; remediation work was injected automatically." });
    }
  }

  private async runWorkItem(mission: Mission, item: WorkItem): Promise<"continue" | "awaiting_input" | "blocked"> {
    const fresh = this.store.get(mission.id)!;
    if (shouldSkipRedundantValidatorWork(fresh, item)) {
      await this.store.updateWorkItem(mission.id, item.id, {
        status: "skipped",
        output: "Skipped: redundant validator after validation already passed."
      });
      await this.store.saveEvent(mission.id, {
        level: "info",
        source: "orchestrator",
        message: `Skipped redundant validator work item: ${item.title}`
      });
      await this.store.noteProgress(mission.id);
      return "continue";
    }

    await this.updateWorkItemWithHardStopInvariant(mission.id, item, { status: "running" });
    await this.store.saveEvent(mission.id, {
      level: "info",
      source: `agent:${item.role}`,
      message: `Starting ${item.title}`
    });

    const useGitCheckpoint = item.role === "implementer" &&
      vscode.workspace.getConfiguration().get<boolean>("myAi.missions.gitCheckpointBeforeImpl", false);
    let didStash = false;
    if (useGitCheckpoint) {
      try {
        const status = await gitStatus();
        const hasChanges = status.ok && status.data && (status.data as { changedFiles: string[] }).changedFiles?.length > 0;
        if (hasChanges) {
          const stash = await gitStashPush(`pre-workitem-${item.id}`);
          didStash = stash.ok;
        }
      } catch { /* git not available — skip */ }
    }

    const completedCount = mission.queue.filter((w) => w.status === "done" || w.status === "skipped").length;
    const context = this.collector instanceof EnhancedContextCollector
      ? await this.collector.collectForMission({
        isFirstWorkItem: completedCount === 0,
        keywords: extractKeywords(item.prompt, 5),
      })
      : await this.collector.collect();
    this.missionWorkAbort.get(mission.id)?.abort();
    const ac = new AbortController();
    this.missionWorkAbort.set(mission.id, ac);
    let result: AgentTurnResult;
    const onChunk = this.onAgentStreamChunk
      ? (chunk: string) => this.onAgentStreamChunk!(mission.id, item.id, item.role, chunk)
      : undefined;
    try {
      if (this.agentRunForTest) {
        result = await this.agentRunForTest(mission, item, context, { signal: ac.signal, onChunk });
      } else {
        const agent = this.agents.create(item.role);
        result = await agent.run(mission, item, context, { signal: ac.signal, onChunk });
      }
    } catch (err) {
      if (isLikelyStreamAbort(err, ac.signal)) {
        const bySignal = ac.signal.aborted;
        let reason = this.missionAbortReason.get(mission.id) || "unknown";
        // Only trust "operator" when the mission signal was actually aborted.
        if (reason === "operator" && !bySignal) reason = "unknown";
        // Timeout-origin AbortError can happen without mission-level signal abort.
        if (reason === "unknown" && !bySignal) {
          const e = err as { name?: string; message?: string } | undefined;
          const msg = typeof e?.message === "string" ? e.message.toLowerCase() : "";
          if (e?.name === "AbortError" || msg.includes("timeout") || msg.includes("timed out")) {
            reason = "timeout";
          }
        }
        
        // Determine output message based on abort reason
        let outputMessage = "Model stream cancelled.";
        if (reason === "operator") {
          outputMessage = "Model stream cancelled (operator abort).";
        } else if (reason === "timeout") {
          outputMessage = "Model stream cancelled (request timeout).";
        } else if (reason === "system") {
          outputMessage = "Model stream cancelled (system).";
        }
        
        // Determine whether to block the mission based on reason
        const shouldBlockMission = reason === "operator";
        const workItemStatus = shouldBlockMission ? "blocked" : "failed";
        const hardStopClass =
          reason === "operator"
            ? ("operator_abort" as const)
            : reason === "timeout" || reason === "system"
              ? ("timeout_or_system_abort" as const)
              : ("unknown_hard_stop" as const);

        await this.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: workItemStatus,
          hardStopClass,
          output: outputMessage
        });

        if (shouldBlockMission) {
          this.pendingCompletionReason.delete(mission.id);
          // Operator abort: block the mission and require explicit resume
          await this.store.updateMission(mission.id, {
            status: "blocked",
            blocker: "Model stream cancelled (operator abort). Resume when ready.",
            blockReasonCode: "operator_stream_abort"
          });
          await this.store.saveEvent(mission.id, {
            level: "warn",
            source: "orchestrator",
            message: "Work item LLM stream aborted by operator."
          });
          return "blocked";
        } else {
          // System/timeout abort: work item fails but mission continues for recovery
          await this.store.saveEvent(mission.id, {
            level: "warn",
            source: "orchestrator",
            message: `Work item LLM stream cancelled (${reason}). Mission will attempt recovery.`
          });
          // Continue to next work item instead of blocking
          return "continue";
        }
      }
      throw err;
    } finally {
      if (this.missionWorkAbort.get(mission.id) === ac) {
        this.missionWorkAbort.delete(mission.id);
      }
      this.missionAbortReason.delete(mission.id);
      this.onAgentStreamDone?.(mission.id, item.id);

      if (didStash) {
        const fresh = this.store.get(mission.id);
        const itemFinal = fresh?.queue.find((w) => w.id === item.id);
        if (itemFinal?.status === "failed" || itemFinal?.status === "blocked") {
          try {
            await gitStashPop();
            await this.store.saveEvent(mission.id, { level: "info", source: "orchestrator", message: `Restored git stash after ${itemFinal.status} work item: ${item.title}` });
          } catch { /* stash restore best-effort */ }
        }
      }
    }

    const alreadySatisfiedNoTool = shouldHonorAlreadySatisfiedNoToolRun(item.role, result.summary, result.toolCalls);
    if (alreadySatisfiedNoTool) {
      result = {
        ...result,
        toolCalls: [],
        markStatus: "done",
        summary: `[already_satisfied] ${alreadySatisfiedNoTool.reason}\n\n${result.summary.trim()}`.trim()
      };
      await this.store.saveEvent(mission.id, {
        level: "info",
        source: "orchestrator",
        message: `Work item completed without tools (already_satisfied): ${alreadySatisfiedNoTool.reason}`
      });
    }

    let toolExecResult = await this.executeWorkItemToolCalls(mission, item, result);
    if (toolExecResult.earlyReturn) return toolExecResult.earlyReturn;

    const maxToolFollowUps = this.agentRunForTest ? 0 : vscode.workspace.getConfiguration().get<number>("myAi.missions.maxToolFollowUpTurns", 3);
    const toolLoopRoles: AgentRole[] = ["implementer", "researcher", "reviewer"];
    let followUpTurn = 0;
    while (
      followUpTurn < maxToolFollowUps &&
      toolLoopRoles.includes(item.role) &&
      toolExecResult.toolResultSummaries?.length &&
      !this.missionWorkAbort.get(mission.id)?.signal.aborted
    ) {
      followUpTurn++;
      const followUpPrompt = [
        `Previous TOOL results (turn ${followUpTurn}):`,
        ...toolExecResult.toolResultSummaries,
        "",
        "Review the tool results above. If more tool calls are needed, emit TOOL: lines. If the task is now complete, output your final summary. Do not re-emit tools that already succeeded."
      ].join("\n");

      const ac = this.missionWorkAbort.get(mission.id);
      const followUpOnChunk = this.onAgentStreamChunk
        ? (chunk: string) => this.onAgentStreamChunk!(mission.id, item.id, item.role, chunk)
        : undefined;

      const followUpItem: WorkItem = { ...item, prompt: `${item.prompt}\n\n${followUpPrompt}` };
      let followUpResult: AgentTurnResult;
      try {
        if (this.agentRunForTest) {
          followUpResult = await this.agentRunForTest(mission, followUpItem, context, { signal: ac?.signal, onChunk: followUpOnChunk });
        } else {
          const agent = this.agents.create(item.role);
          followUpResult = await agent.run(mission, followUpItem, context, { signal: ac?.signal, onChunk: followUpOnChunk });
        }
      } catch {
        break;
      }

      await this.store.saveEvent(mission.id, {
        level: "info",
        source: `agent:${item.role}`,
        message: `Tool follow-up turn ${followUpTurn} completed`
      });

      result = {
        ...result,
        summary: `${result.summary}\n\n--- Follow-up turn ${followUpTurn} ---\n${followUpResult.summary}`,
        toolCalls: followUpResult.toolCalls,
        nextWorkItems: [...(result.nextWorkItems || []), ...(followUpResult.nextWorkItems || [])],
        newMemory: [...(result.newMemory || []), ...(followUpResult.newMemory || [])],
        decision: followUpResult.decision || result.decision
      };

      if (!followUpResult.toolCalls?.length) break;
      toolExecResult = await this.executeWorkItemToolCalls(mission, item, followUpResult);
      if (toolExecResult.earlyReturn) return toolExecResult.earlyReturn;
    }

    let workCompletionKind = alreadySatisfiedNoTool ? "already_satisfied" as WorkItem["completionKind"] : undefined;
    if (!workCompletionKind && toolExecResult.derivedCompletionKind) {
      workCompletionKind = toolExecResult.derivedCompletionKind;
    }

    if (item.role === "validator" && result.toolCalls?.length) {
      const beforeDecision = result.decision;
      result = applyToolDrivenValidatorCompletion(item.role, result);
      if (beforeDecision !== result.decision && result.decision === "complete") {
        await this.store.saveEvent(mission.id, {
          level: "info",
          source: "orchestrator",
          message:
            "tool-driven-validator: inferred COMPLETE after successful tool calls with no BLOCKER/WORK lines (model omitted COMPLETE:)."
        });
      }
    }

    if (result.events?.length) {
      for (const event of result.events) await this.store.saveEvent(mission.id, event);
    }
    if (result.newMemory?.length) {
      for (const mem of result.newMemory) {
        const saved = await this.store.addMemory(mission.id, { ...mem, sourceMissionId: mission.id });
        await this.globalMemory.add(saved);
      }
    }
    if (result.nextWorkItems?.length) {
      const flattened = flattenSubItems(result.nextWorkItems);
      await this.store.enqueue(mission.id, flattened);
    }

    await this.maybeEnforcePostAgentContracts(
      mission.id,
      item,
      result.summary,
      result.nextWorkItems || [],
      workCompletionKind === "already_satisfied"
    );

    const terminalWorkStatus = result.markStatus || "done";
    const completionWorkPatch: Partial<WorkItem> = {
      status: terminalWorkStatus,
      output: result.summary,
      activeMutatingToolCall: undefined,
      ...(workCompletionKind ? { completionKind: workCompletionKind } : {})
    };
    if (isRequiredImplementerWorkItem(item) && terminalWorkStatus === "blocked") {
      completionWorkPatch.hardStopClass = item.hardStopClass ?? "unknown_hard_stop";
    }
    await this.updateWorkItemWithHardStopInvariant(mission.id, item, completionWorkPatch);
    const updated = this.store.get(mission.id)!;
    const patch: Partial<Mission> = { currentStep: updated.currentStep + 1, blocker: undefined, blockReasonCode: undefined };
    if (item.role === "validator") {
      patch.validationState = result.decision === "complete" ? "passed" : result.decision === "blocked" ? "failed" : "pending";
    }
    await this.store.noteProgress(mission.id);
    await this.store.updateMission(mission.id, patch);

    if (vscode.workspace.getConfiguration().get<boolean>("myAi.missions.autoCheckpointEveryStep", true)) {
      await this.store.addCheckpoint(mission.id, {
        step: updated.currentStep + 1,
        summary: checkpointSummaryForTerminalWorkItem(item, terminalWorkStatus),
        queueSnapshot: updated.queue.map((w) => ({ id: w.id, title: w.title, role: w.role, status: w.status }))
      });
    }

    if (item.role === "implementer") {
      const refreshed = this.store.get(mission.id)!;
      if (refreshed.validationState !== "passed") {
        const hasTodoReview = refreshed.queue.some((w) => w.role === "reviewer" && w.status === "todo");
        if (!hasTodoReview) {
          await this.store.enqueue(mission.id, [
            {
              id: uid("work"),
              title: "Review latest implementation",
              role: "reviewer",
              status: "todo",
              prompt: "Review the latest implementation, identify risks, and propose follow-up work if needed."
            }
          ]);
        }
      }
    }

    if (result.markStatus === "blocked") {
      this.pendingCompletionReason.delete(mission.id);
      const wiNow = this.store.get(mission.id)!.queue.find((w) => w.id === item.id)!;
      if (!isKnownImplementerHardStopClassValue(wiNow.hardStopClass)) {
        await this.updateWorkItemWithHardStopInvariant(mission.id, wiNow, { hardStopClass: "unknown_hard_stop" });
      }
      await this.store.updateMission(mission.id, {
        status: "blocked",
        blocker: item.title,
        validationState: "failed",
        blockReasonCode: "generic_blocked"
      });
      return "blocked";
    }

    return "continue";
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
        await this.store.updateMission(id, {
          status: desiredStatus,
          blocker,
          blockReasonCode: missionBlockReasonFromDownstreamGate(gate.failureClass, desiredStatus, gate.reason)
        });
        return "terminal";
      }
    }

    const enforced = await this.ensureClosurePolicy(mission);
    if (enforced) return "continue";

    await this.autoDemoteObsolescentQueueItems(id);
    await this.autoDemoteSupersededTerminalItems(id);
    let refreshed = this.store.get(id)!;
    const stillRunning = refreshed.queue.some((w) => w.status === "running");
    if (stillRunning) {
      const normalized = recoverInterruptedQueueItems(refreshed.queue);
      if (normalized.recoveredCount > 0) {
        await this.store.updateMission(id, { queue: normalized.queue });
        await this.store.saveEvent(id, {
          level: "info",
          source: "orchestrator",
          message: `Normalized ${normalized.recoveredCount} stale running work item(s) to todo (no eligible next while queue showed running).`
        });
        await this.store.noteProgress(id);
        await this.autoDemoteObsolescentQueueItems(id);
      }
      if (normalized.replayRiskCount > 0) {
        await this.store.saveEvent(id, {
          level: "warn",
          source: "orchestrator",
          message: `Blocked ${normalized.replayRiskCount} stale running work item(s) from automatic replay because a mutating tool may already have executed.`
        });
      }
      return "continue";
    }

    refreshed = this.store.get(id)!;
    const hasBlocked = refreshed.queue.some((w) => w.status === "blocked" || w.status === "failed");
    let terminalStatus = resolveCompletionStatus(hasBlocked, refreshed.policy.closureRequired, refreshed.validationState);
    if (terminalStatus === "completed" && hasRequiredUnresolvedWork(refreshed)) {
      terminalStatus = "blocked";
      this.pendingCompletionReason.delete(id);
      await this.store.updateMission(id, {
        status: terminalStatus,
        blocker: "Mission cannot complete while required work items are still todo or running.",
        blockReasonCode: "required_work_open",
        result: refreshed.memory
          .slice(-8)
          .map((m) => `- ${m.text}`)
          .join("\n")
      });
      return "terminal";
    }
    const terminalCompletionReason =
      terminalStatus === "completed" ? this.resolveCompletionReasonForCompleted(id, refreshed.queue) : undefined;
    if (
      terminalStatus === "blocked" &&
      this.hasBlockingImplementerOutcome(refreshed) &&
      refreshed.validationState === "passed"
    ) {
      await this.store.saveEvent(id, {
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
    await this.store.updateMission(id, {
      status: terminalStatus,
      blocker: finalBlocker,
      blockReasonCode: terminalBlockReason,
      result: refreshed.memory
        .slice(-8)
        .map((m) => `- ${m.text}`)
        .join("\n"),
      ...(terminalStatus === "completed" && terminalCompletionReason ? { completionReason: terminalCompletionReason } : {})
    });
    return "terminal";
  }

  private async ensureClosurePolicy(mission: Mission): Promise<boolean> {
    return enforceClosurePolicy(mission, this.store);
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

/**
 * Flattens work items that contain sub-items into a single queue.
 * Sub-items are placed after their parent in the queue.
 */
function flattenSubItems(items: WorkItem[]): WorkItem[] {
  const result: WorkItem[] = [];
  for (const item of items) {
    if (item.subItems?.length) {
      result.push(...item.subItems);
      const parent: WorkItem = { ...item, subItems: undefined, status: "done", output: `Decomposed into ${item.subItems.length} sub-items.` };
      result.push(parent);
    } else {
      result.push(item);
    }
  }
  return result;
}

function computeEffectiveMaxRounds(mission: Mission): number {
  const cfg = vscode.workspace.getConfiguration();
  const mode = cfg.get<string>("myAi.missions.scalingMode", "fixed");
  if (mode !== "adaptive") return mission.policy.maxAutoRounds;

  const cap = cfg.get<number>("myAi.missions.adaptiveMaxRounds", 200);
  const base = mission.policy.maxAutoRounds;
  const workItemCount = mission.queue.length;
  return Math.min(base + workItemCount * 2, cap);
}

/** Extract salient keywords from a prompt for relevant-file discovery. */
function extractKeywords(prompt: string, max: number): string[] {
  const stopWords = new Set(["the", "and", "for", "that", "this", "with", "from", "are", "was", "will", "have", "has", "been", "all", "each", "not", "but", "can", "should"]);
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
  const unique = [...new Set(words)];
  return unique.slice(0, max);
}
