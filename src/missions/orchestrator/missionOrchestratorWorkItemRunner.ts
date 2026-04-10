import * as vscode from "vscode";
import { ContextCollector } from "../../context/ContextCollector";
import { EnhancedContextCollector } from "../../context/EnhancedContextCollector";
import { gitStashPush, gitStashPop, gitStatus } from "../../tools/GitToolProvider";
import { AgentFactory } from "../../agents/AgentFactory";
import type { ToolResult } from "../../tools/ToolRegistry";
import type {
  AgentRole,
  AgentTurnResult,
  ChatContext,
  Mission,
  ToolCall,
  WorkItem
} from "../../types";
import { isLikelyStreamAbort, uid } from "../../util";
import type { ApprovalManager } from "../../approvals/ApprovalManager";
import type { GlobalMemoryStore } from "../../memory/GlobalMemoryStore";
import { applyToolDrivenValidatorCompletion } from "../toolDrivenValidatorCompletion";
import { shouldSkipRedundantValidatorWork } from "../redundantValidatorSkip";
import { staleImplementerToolFailureRecoveryDecision } from "../staleEditRecovery";
import { resolveMaxToolFollowUpTurns, resolveToolRecoveryLimits } from "./toolRecoveryAutonomyLimits";
import { workCompletionKindFromSuccessfulToolSteps } from "../../tools/applyPatchNoOpPolicy";
import { shouldHonorAlreadySatisfiedNoToolRun } from "../alreadySatisfiedWorkItem";
import { shouldEnqueueReviewerAutoRemediation } from "../reviewerRemediationPolicy";
import { computePlannerCoverageItems } from "../missionClosurePolicy";
import { parseBlueprintModelOutput } from "../blueprintParser";
import { parsePreBlueprintClarificationOutput } from "../preBlueprintClarificationParser";
import { validateBlueprintReadinessForApproval } from "../blueprintReadinessGate";
import { findStaleResearchEvidenceMemories, formatResearchEvidenceFinding } from "../researchEvidence";
import { findDuplicateQueryResearchContradictions } from "../researchContradiction";
import { applyBlueprintStepStatusFromWorkItem } from "../blueprintStepSync";
import { isRequiredImplementerWorkItem } from "../implementerHardStopWorkItemWrite";
import { isKnownImplementerHardStopClassValue } from "../implementerHardStopClassInvariant";
import { RecoveryBudget } from "./recoveryBudget";
import { classifyToolOutcome } from "./toolOutcomeClassifier";
import { buildFailureInvestigationWave } from "../failureInvestigationEnqueue";
import { READONLY_MISSION_TOOL_IDS } from "../readonlyMissionToolIds";
import {
  checkpointSummaryForTerminalWorkItem,
  extractKeywords,
  flattenSubItems,
  isPotentiallyMutatingToolCall,
  mutatingToolTarget,
  readinessMessageText
} from "./orchestratorLeafHelpers";
import { normalizeRunCommandPreview } from "../runCommandPreviewNormalize";
import { extractValidationVerdictFromSummary } from "../validatorVerdictExtract";
import type { MissionAgentRunForTest, MissionToolExecutor } from "../missionOrchestratorContracts";
import type { MissionStore } from "../MissionStore";

export interface WorkItemRunnerHost {
  store: MissionStore;
  tools: MissionToolExecutor;
  globalMemory: GlobalMemoryStore;
  collector: ContextCollector;
  agents: AgentFactory;
  agentRunForTest?: MissionAgentRunForTest;
  approvals: ApprovalManager;
  pendingCompletionReason: Map<string, NonNullable<Mission["completionReason"]>>;
  missionWorkAbort: Map<string, AbortController>;
  missionAbortReason: Map<string, "operator" | "system" | "timeout" | "unknown">;
  lastStaleEvidenceWarnSigByMission: Map<string, string>;
  onAgentStreamChunk?: (missionId: string, workItemId: string, role: string, text: string) => void;
  onAgentStreamDone?: (missionId: string, workItemId: string) => void;
  updateWorkItemWithHardStopInvariant(
    missionId: string,
    itemBeforePatch: WorkItem,
    patch: Partial<WorkItem>
  ): Promise<void>;
  enqueueSynthesizedBlueprintWork(missionId: string): Promise<void>;
  addBlueprintMemoryMirror(missionId: string): Promise<void>;
  maybeEnqueuePlanFidelityReview(missionId: string, implementerItem: WorkItem): Promise<void>;
}

export class MissionOrchestratorWorkItemRunner {
  private readonly recoveryBudget = new RecoveryBudget();

  constructor(private readonly host: WorkItemRunnerHost) {}

  private async executeToolOrSyntheticFailure(
    missionId: string,
    call: ToolCall,
    workItemId?: string
  ): Promise<ToolResult> {
    try {
      return await this.host.tools.execute(missionId, call);
    } catch (toolErr) {
      const msg = toolErr instanceof Error ? toolErr.message : String(toolErr);
      await this.host.store.saveEvent(missionId, {
        level: "error",
        source: "orchestrator",
        message: `Tool ${call.tool} threw (unexpected): ${msg}`,
        data: { tool: call.tool, workItemId }
      });
      return { ok: false, summary: `${call.tool} crashed: ${msg}` };
    }
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
    /** When set with `earlyReturn: "blocked"`, work item is already `failed`/`tool_failure`; mission not yet blocked until the runner resolves recovery vs terminal block. */
    pendingToolFailureMissionBlock?: { blocker: string };
    derivedCompletionKind?: WorkItem["completionKind"];
    toolResultSummaries?: string[];
    hadMutatingSideEffect?: boolean;
    /** Successful tool steps in this batch (ok results), used to detect unresolved recoverable failures after follow-ups. */
    successfulToolStepsCount?: number;
    /** Non–dry-run tool invocations attempted in this batch. */
    attemptedToolInvocations?: number;
    /** True if any tool failed but was classified recoverable (agent-retry / readonly / probe); stale_patch recovery does not set this. */
    hadRecoverableFailureAwaitingFollowUp?: boolean;
  }> {
    if (!result.toolCalls?.length) return {};

    const MUTATING_TOOLS = new Set(["writeFile", "applyPatch", "runTerminal", "runCommand", "git.commit", "git.checkout_file", "git.stash_push", "git.stash_pop", "docker.exec", "db.query"]);
    const READONLY_TOOLS = READONLY_MISSION_TOOL_IDS;
    const cfg = vscode.workspace.getConfiguration();
    const recoveryLimits = resolveToolRecoveryLimits(cfg);
    const MAX_RECOVERABLE_READONLY_FAILURES_PER_WORK_ITEM = recoveryLimits.maxRecoverableReadonlyFailuresPerWorkItem;
    const MAX_TRANSIENT_MUTATING_FAILURES_PER_WORK_ITEM = recoveryLimits.maxTransientMutatingFailuresPerWorkItem;
    const MAX_RUN_COMMAND_PROBE_FAILURES_PER_WORK_ITEM = recoveryLimits.maxRunCommandProbeFailuresPerWorkItem;
    const maxRunCommandAgentRetry = recoveryLimits.maxRunCommandAgentRetry;
    const maxWriteFileAgentRetry = recoveryLimits.maxWriteFileAgentRetry;
    const maxApplyPatchAgentRetry = recoveryLimits.maxApplyPatchAgentRetry;
    const successfulToolSteps: Array<{ tool: string; applyPatchNoop?: boolean }> = [];
    const toolResultSummaries: string[] = [];
    let hadMutatingSideEffect = false;
    let attemptedToolInvocations = 0;
    let hadRecoverableFailureAwaitingFollowUp = false;
    for (const call of result.toolCalls) {
      const callWithMeta: ToolCall = {
        ...call,
        args: {
          ...(call.args || {}),
          __workItemId: item.id,
          __workItemRole: item.role,
          ...(item.blueprintStepId ? { __blueprintStepId: item.blueprintStepId } : {})
        }
      };
      if (mission.dryRun && MUTATING_TOOLS.has(call.tool)) {
        toolResultSummaries.push(`[DRY-RUN] Skipped mutating tool: ${call.tool} ${JSON.stringify(call.args).slice(0, 200)}`);
        await this.host.store.saveEvent(mission.id, { level: "info", source: "orchestrator", message: `[DRY-RUN] Would execute: ${call.tool}` });
        continue;
      }
      attemptedToolInvocations += 1;
      await this.markMutatingToolExecutionStarted(mission.id, item, callWithMeta);
      const toolResult = await this.executeToolOrSyntheticFailure(mission.id, callWithMeta, item.id);

      // Non-fatal readFile missing: allow the agent to handle by creating the file or choosing a different path
      // in follow-up tool turns. Blocking the whole mission on ENOENT is counterproductive and leads to “stuck”
      // states for expected output artifacts (e.g. AUDIT_REPORT.md).
      const code = (toolResult.data as { code?: unknown } | undefined)?.code;
      const summary = String(toolResult.summary || "");
      const isReadFileMissing =
        callWithMeta.tool === "readFile" &&
        !toolResult.ok &&
        !toolResult.requiresApproval &&
        !toolResult.blockedByPolicy &&
        (code === "FileNotFound" ||
          code === "EntryNotFound" ||
          code === "ENOENT" ||
          /ENOENT|EntryNotFound|no such file|not found/i.test(summary));
      const isReadonlyTool = READONLY_TOOLS.has(callWithMeta.tool);
      const isMutatingTool = MUTATING_TOOLS.has(callWithMeta.tool);
      const budgetKey = `${mission.id}:${item.id}:recoverable_readonly`;
      const already = this.recoveryBudget.peek(budgetKey);
      const readonlyBudgetRemaining = already < MAX_RECOVERABLE_READONLY_FAILURES_PER_WORK_ITEM;
      const transientKey = `${mission.id}:${item.id}:transient_mutating`;
      const transientAlready = this.recoveryBudget.peek(transientKey);
      const transientMutatingBudgetRemaining = transientAlready < MAX_TRANSIENT_MUTATING_FAILURES_PER_WORK_ITEM;
      const probeKey = `${mission.id}:${item.id}:run_command_probe`;
      const probeAlready = this.recoveryBudget.peek(probeKey);
      const runCommandProbeBudgetRemaining = probeAlready < MAX_RUN_COMMAND_PROBE_FAILURES_PER_WORK_ITEM;
      const agentRetryKey = `${mission.id}:${item.id}:run_command_agent_retry`;
      const agentRetryAlready = this.recoveryBudget.peek(agentRetryKey);
      const runCommandAgentRetryBudgetRemaining =
        maxRunCommandAgentRetry > 0 && agentRetryAlready < maxRunCommandAgentRetry;
      const writeRetryKey = `${mission.id}:${item.id}:write_file_agent_retry`;
      const writeRetryAlready = this.recoveryBudget.peek(writeRetryKey);
      const writeFileAgentRetryBudgetRemaining =
        maxWriteFileAgentRetry > 0 && writeRetryAlready < maxWriteFileAgentRetry;
      const patchRetryKey = `${mission.id}:${item.id}:apply_patch_agent_retry`;
      const patchRetryAlready = this.recoveryBudget.peek(patchRetryKey);
      const applyPatchAgentRetryBudgetRemaining =
        maxApplyPatchAgentRetry > 0 && patchRetryAlready < maxApplyPatchAgentRetry;

      if (
        !toolResult.ok &&
        !toolResult.requiresApproval &&
        !toolResult.blockedByPolicy
      ) {
        const latestForStale = this.host.store.get(mission.id)!;
        if (
          staleImplementerToolFailureRecoveryDecision(
            item.role,
            latestForStale,
            callWithMeta,
            toolResult.summary
          ) === "recover_to_satisfied"
        ) {
          this.host.pendingCompletionReason.set(mission.id, "stale_patch_but_goal_already_met");
          const blocker = `${callWithMeta.tool}: ${toolResult.summary}`;
          await this.host.store.saveEvent(mission.id, {
            level: "info",
            source: "orchestrator",
            message: `Stale edit skipped (${blocker}); validation already passed — no code change required (stale_patch_but_goal_already_met).`
          });
          const saved = await this.host.store.addMemory(mission.id, {
            kind: "tool_result",
            text: `${callWithMeta.tool}: ${toolResult.summary} [stale_patch_but_goal_already_met: validation already passed, patch skipped]`,
            tags: [callWithMeta.tool, "stale_patch_recovery"],
            sourceMissionId: mission.id
          });
          await this.host.globalMemory.add(saved);
          await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, { activeMutatingToolCall: undefined });
          continue;
        }
      }

      const decision = classifyToolOutcome({
        call: callWithMeta,
        result: toolResult,
        isReadonlyTool,
        isMutatingTool,
        readonlyBudgetRemaining,
        isReadFileMissing,
        transientMutatingBudgetRemaining,
        runCommandProbeBudgetRemaining,
        runCommandAgentRetryBudgetRemaining,
        writeFileAgentRetryBudgetRemaining,
        applyPatchAgentRetryBudgetRemaining
      });

      if (decision.kind === "continue" && !toolResult.ok) {
        hadRecoverableFailureAwaitingFollowUp = true;
        // Consume budget only when we actually continue on a recoverable failure.
        if (decision.category === "recoverable_readonly") {
          this.recoveryBudget.consume(budgetKey, MAX_RECOVERABLE_READONLY_FAILURES_PER_WORK_ITEM);
        }
        if (decision.category === "transient_mutating") {
          this.recoveryBudget.consume(transientKey, MAX_TRANSIENT_MUTATING_FAILURES_PER_WORK_ITEM);
        }
        if (decision.category === "run_command_probe") {
          this.recoveryBudget.consume(probeKey, MAX_RUN_COMMAND_PROBE_FAILURES_PER_WORK_ITEM);
        }
        if (decision.category === "run_command_agent_retry") {
          this.recoveryBudget.consume(agentRetryKey, maxRunCommandAgentRetry);
        }
        if (decision.category === "write_file_agent_retry") {
          this.recoveryBudget.consume(writeRetryKey, maxWriteFileAgentRetry);
        }
        if (decision.category === "apply_patch_agent_retry") {
          this.recoveryBudget.consume(patchRetryKey, maxApplyPatchAgentRetry);
        }
        const recoveryAttemptNumber = (() => {
          switch (decision.category) {
            case "recoverable_readonly":
              return this.recoveryBudget.peek(budgetKey);
            case "transient_mutating":
              return this.recoveryBudget.peek(transientKey);
            case "run_command_probe":
              return this.recoveryBudget.peek(probeKey);
            case "run_command_agent_retry":
              return this.recoveryBudget.peek(agentRetryKey);
            case "write_file_agent_retry":
              return this.recoveryBudget.peek(writeRetryKey);
            case "apply_patch_agent_retry":
              return this.recoveryBudget.peek(patchRetryKey);
            default:
              return undefined;
          }
        })();
        await this.host.store.saveEvent(mission.id, {
          level: "info",
          source: "orchestrator",
          telemetryKind: "recovery_attempt",
          message: `Recovery attempt (${decision.category}): ${callWithMeta.tool}`,
          data: {
            workItemId: item.id,
            role: item.role,
            tool: callWithMeta.tool,
            category: decision.category,
            attempt: recoveryAttemptNumber
          }
        });
        toolResultSummaries.push(`[${callWithMeta.tool}] ${toolResult.summary}`);
        for (const l of decision.hintLines || []) toolResultSummaries.push(l);
        if (decision.category === "run_command_agent_retry") {
          const d = toolResult.data as { stderr?: string; stdout?: string } | undefined;
          const err = (d?.stderr || "").trim();
          const out = (d?.stdout || "").trim();
          if (err) toolResultSummaries.push(`[runCommand stderr]\n${err.slice(0, 6000)}`);
          else if (out) toolResultSummaries.push(`[runCommand stdout]\n${out.slice(0, 4000)}`);
        }
        if (decision.category === "write_file_agent_retry") {
          const p = String(callWithMeta.args.path || "");
          if (p) toolResultSummaries.push(`[writeFile path] ${p}`);
        }
        if (decision.category === "apply_patch_agent_retry") {
          const p = String(callWithMeta.args.path || "");
          const se = String(callWithMeta.args.search || "");
          if (p) toolResultSummaries.push(`[applyPatch path] ${p}`);
          if (se) toolResultSummaries.push(`[applyPatch search (truncated)]\n${se.slice(0, 3000)}`);
        }
        await this.recordToolResultMemoryAndEvent(mission.id, callWithMeta, toolResult, decision.tags);
        await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, { activeMutatingToolCall: undefined });
        continue;
      }

      if (decision.kind === "blocked" && decision.category === "policy_denied") {
        this.host.pendingCompletionReason.delete(mission.id);
        const blocker = `${callWithMeta.tool}: ${toolResult.summary}`;
        await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: "blocked",
          activeMutatingToolCall: undefined,
          hardStopClass: "policy_blocked",
          output: `${result.summary}\n\nPolicy blocked tool execution: ${blocker}`
        });
        await this.host.store.updateMission(mission.id, {
          status: "blocked",
          blocker: `Policy blocked mission progress (${blocker})`,
          validationState: "failed",
          blockReasonCode: "policy_blocked"
        });
        await this.host.store.saveEvent(mission.id, {
          level: "warn",
          source: "orchestrator",
          message: `Mission paused: tool call blocked by policy (${blocker}).`
        });
        return { earlyReturn: "blocked" };
      }

      if (!toolResult.ok && !toolResult.requiresApproval) {
        this.host.pendingCompletionReason.delete(mission.id);
        const blocker = `${callWithMeta.tool}: ${toolResult.summary}`;
        await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: "failed",
          hardStopClass: "tool_failure",
          activeMutatingToolCall: undefined,
          output: `${result.summary}\n\nTool execution failed: ${blocker}`
        });
        return {
          earlyReturn: "blocked",
          pendingToolFailureMissionBlock: { blocker: `Mission halted after tool failure (${blocker})` }
        };
      }

      if (toolResult.requiresApproval) {
        this.host.pendingCompletionReason.delete(mission.id);
        const latestMissionForApproval = this.host.store.get(mission.id)!;
        if (latestMissionForApproval.status === "failed") {
          await this.host.store.updateMission(mission.id, {
            status: "queued",
            blocker: undefined,
            blockReasonCode: undefined,
            failureReasonCode: undefined
          });
          await this.host.store.saveEvent(mission.id, {
            level: "warn",
            source: "orchestrator",
            message:
              "Mission was failed; cleared failure state to record pending tool approval (salvage path)."
          });
        }
        const req = this.host.approvals.create(mission.id, callWithMeta, toolResult.requiresApproval, item.id);
        await this.host.store.addApproval(mission.id, req);
        await this.host.store.updateMission(mission.id, {
          status: "awaiting_input",
          blocker: req.title,
          validationState: "failed",
          blockReasonCode: "approval_pending"
        });
        await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: "blocked",
          activeMutatingToolCall: undefined,
          hardStopClass: "approval_pending",
          output: `${result.summary}\n\nPending approval: ${req.title}`
        });
        await this.host.store.saveEvent(mission.id, {
          level: "warn",
          source: "approval",
          message: `Approval required: ${req.title}`,
          data: req
        });
        return { earlyReturn: "awaiting_input" };
      }

      successfulToolSteps.push({ tool: callWithMeta.tool, applyPatchNoop: toolResult.applyPatchNoop });
      toolResultSummaries.push(`[${callWithMeta.tool}] ${toolResult.summary}`);
      const isApplyPatchNoop = toolResult.applyPatchNoop === true;
      if (toolResult.ok && MUTATING_TOOLS.has(callWithMeta.tool) && !isApplyPatchNoop) {
        hadMutatingSideEffect = true;
      }
      const tags = isApplyPatchNoop ? [callWithMeta.tool, "apply_patch_noop"] : [callWithMeta.tool];
      const prefix = isApplyPatchNoop ? "[apply_patch_noop] " : "";
      await this.recordToolResultMemoryAndEvent(mission.id, callWithMeta, toolResult, tags, prefix);
      await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, { activeMutatingToolCall: undefined });
    }

    const derivedCompletionKind = workCompletionKindFromSuccessfulToolSteps(successfulToolSteps) || undefined;
    return {
      derivedCompletionKind,
      toolResultSummaries,
      hadMutatingSideEffect,
      successfulToolStepsCount: successfulToolSteps.length,
      attemptedToolInvocations,
      hadRecoverableFailureAwaitingFollowUp
    };
  }

  private async tryEnqueueFailureInvestigationWave(
    missionId: string,
    failedItemId: string,
    missionBlock: { blocker: string }
  ): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration();
    if (!cfg.get<boolean>("myAi.missions.failureInvestigation.enabled", false)) return false;

    const maxWaves = Math.max(0, cfg.get<number>("myAi.missions.failureInvestigation.maxWavesPerMission", 2));
    const includePlanner = cfg.get<boolean>("myAi.missions.failureInvestigation.includePlannerStep", false);

    const mission = this.host.store.get(missionId);
    if (!mission?.queue.length || mission.dryRun) return false;

    const used = mission.runtime?.failureInvestigationWavesUsed ?? 0;
    if (maxWaves === 0 || used >= maxWaves) return false;

    const failedItem = mission.queue.find((w) => w.id === failedItemId);
    if (!failedItem || failedItem.status !== "failed") return false;
    if (failedItem.hardStopClass !== "tool_failure") return false;
    if (failedItem.requiredForCompletion === false) return false;

    const wave = buildFailureInvestigationWave(failedItem, {
      includePlanner,
      blockerSummary: missionBlock.blocker
    });

    await this.host.store.enqueueAfterWorkItem(missionId, failedItemId, wave);
    await this.host.store.updateWorkItem(missionId, failedItemId, { suppressAutoRetry: true });
    await this.host.store.updateRuntime(missionId, { failureInvestigationWavesUsed: used + 1 });
    await this.host.store.updateMission(missionId, {
      status: "queued",
      blocker: undefined,
      blockReasonCode: undefined
    });
    return true;
  }

  /**
   * Resolves `executeWorkItemToolCalls` early exits: tool-failure blocks may enqueue a recovery wave
   * instead of pausing the mission.
   */
  private async maybeResolveToolFailureBlockedEarlyReturn(
    mission: Mission,
    item: WorkItem,
    toolExecResult: {
      earlyReturn?: "awaiting_input" | "blocked";
      pendingToolFailureMissionBlock?: { blocker: string };
    }
  ): Promise<"continue" | "awaiting_input" | "blocked" | undefined> {
    if (!toolExecResult.earlyReturn) return undefined;
    if (toolExecResult.earlyReturn === "awaiting_input") return "awaiting_input";
    if (toolExecResult.earlyReturn === "blocked") {
      if (toolExecResult.pendingToolFailureMissionBlock) {
        const enqueued = await this.tryEnqueueFailureInvestigationWave(
          mission.id,
          item.id,
          toolExecResult.pendingToolFailureMissionBlock
        );
        if (enqueued) {
          await this.host.store.saveEvent(mission.id, {
            level: "info",
            source: "orchestrator",
            message: "Failure investigation wave enqueued after tool failure (researcher → optional planner → retry)."
          });
          return "continue";
        }
        await this.host.store.updateMission(mission.id, {
          status: "blocked",
          blocker: toolExecResult.pendingToolFailureMissionBlock.blocker,
          validationState: "failed",
          blockReasonCode: "tool_failure"
        });
        await this.host.store.saveEvent(mission.id, {
          level: "warn",
          source: "orchestrator",
          message: `Mission paused: tool call failed (${toolExecResult.pendingToolFailureMissionBlock.blocker.slice(0, 280)})`
        });
        return "blocked";
      }
      return "blocked";
    }
    return undefined;
  }

  public async markMutatingToolExecutionStarted(missionId: string, item: WorkItem, call: ToolCall): Promise<void> {
    if (!isPotentiallyMutatingToolCall(call)) return;
    const cmd =
      call.tool === "runCommand" ? normalizeRunCommandPreview(call.args?.command) : undefined;
    await this.host.updateWorkItemWithHardStopInvariant(missionId, item, {
      activeMutatingToolCall: {
        tool: call.tool,
        approved: Boolean(call.args?.__approved),
        target: mutatingToolTarget(call),
        ...(cmd ? { commandPreview: cmd } : {}),
        startedAt: Date.now()
      }
    });
  }

  /**
   * Execute a single tool call and record memory + event.
   * Shared between `executeWorkItemToolCalls` (agent-driven) and `MissionOrchestratorApprovalResolver.resolveApproval` (operator-driven).
   */
  public async executeAndRecordToolCall(
    missionId: string,
    call: ToolCall,
    extraTags: string[] = []
  ): Promise<ToolResult> {
    const result = await this.executeToolOrSyntheticFailure(missionId, call);
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
    const saved = await this.host.store.addMemory(missionId, {
      kind: "tool_result",
      text: `${textPrefix}${call.tool}: ${result.summary}`,
      tags: [call.tool, ...extraTags],
      sourceMissionId: missionId
    });
    await this.host.globalMemory.add(saved);

    // Phase 5 (Research discipline): persist durable research evidence memories for web tools.
    if (result.ok && (call.tool === "webSearch" || call.tool === "fetchWebPage")) {
      const ts = Date.now();
      if (call.tool === "webSearch") {
        const d = (result.data || {}) as { query?: string; provider?: string; excerpt?: string; attribution?: string; topUrls?: string[] };
        const finding = formatResearchEvidenceFinding({
          tool: "webSearch",
          ts,
          query: d.query || String(call.args?.query || ""),
          provider: d.provider,
          excerpt: d.excerpt ? `${d.excerpt}${d.attribution ? `\n\nAttribution: ${d.attribution}` : ""}` : undefined,
          topUrls: Array.isArray(d.topUrls) ? d.topUrls : undefined
        });
        const mem = await this.host.store.addMemory(missionId, {
          kind: "finding",
          text: finding.text,
          tags: ["research_evidence", "web", call.tool, `freshness:${finding.freshness}`],
          sourceMissionId: missionId
        });
        await this.host.globalMemory.add(mem);
        await this.maybeEmitResearchContradictionWarnings(missionId);
      } else {
        const d = (result.data || {}) as { url?: string; status?: number; contentType?: string; body?: string };
        const url = d.url || String(call.args?.url || "");
        const finding = formatResearchEvidenceFinding({
          tool: "fetchWebPage",
          ts,
          url,
          status: typeof d.status === "number" ? d.status : undefined,
          contentType: typeof d.contentType === "string" ? d.contentType : undefined,
          excerpt: typeof d.body === "string" ? d.body : undefined
        });
        const mem = await this.host.store.addMemory(missionId, {
          kind: "finding",
          text: finding.text,
          tags: ["research_evidence", "web", call.tool, `freshness:${finding.freshness}`],
          sourceMissionId: missionId
        });
        await this.host.globalMemory.add(mem);
      }
    }

    const isEvidenceTool =
      extraTags.includes("verification") ||
      call.tool === "runLinter" ||
      call.tool === "runTests" ||
      call.tool === "runCommand" ||
      call.tool === "runTerminal";
    if (isEvidenceTool || result.data !== undefined) {
      const verification = Boolean(call.args?.__verification) || extraTags.includes("verification");
      await this.host.store.saveEvent(missionId, {
        level: result.ok ? "info" : "warn",
        source: `tool:${call.tool}`,
        message: result.summary,
        telemetryKind: verification ? "verification_recorded" : "tool_called",
        data: {
          ok: result.ok,
          tool: call.tool,
          meta: {
            workItemId: call.args?.__workItemId,
            workItemRole: call.args?.__workItemRole,
            blueprintStepId: call.args?.__blueprintStepId,
            approved: Boolean(call.args?.__approved),
            verification
          },
          result: result.data
        }
      });
    }
  }

  private async maybeEmitResearchContradictionWarnings(missionId: string): Promise<void> {
    const mission = this.host.store.get(missionId);
    if (!mission) return;
    const hits = findDuplicateQueryResearchContradictions(mission.memory);
    const warnedKeys = new Set(
      mission.events
        .filter((e) => e.telemetryKind === "research_contradiction_warn")
        .slice(-20)
        .map((e) => String((e.data as { queryKey?: string } | undefined)?.queryKey || ""))
        .filter(Boolean)
    );
    for (const h of hits) {
      if (warnedKeys.has(h.queryKey)) continue;
      await this.host.store.saveEvent(missionId, {
        level: "warn",
        source: "research",
        message: h.detail,
        telemetryKind: "research_contradiction_warn",
        data: { queryKey: h.queryKey }
      });
      warnedKeys.add(h.queryKey);
    }
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
    const mission = this.host.store.get(missionId);
    if (!mission) return;

    if (
      item.workItemPurpose === "blueprint_generate" ||
      item.workItemPurpose === "blueprint_revise" ||
      item.workItemPurpose === "pre_blueprint_clarify"
    ) {
      return;
    }

    if (item.role === "planner" && vscode.workspace.getConfiguration().get<boolean>("myAi.missions.requirePlannerCoverage", true)) {
      const coverage = this.ensurePlannerCoverageItems(mission);
      if (coverage.length) {
        await this.host.store.enqueue(missionId, coverage);
        await this.host.store.saveEvent(missionId, { level: "info", source: "planner-contract", message: `Injected ${coverage.length} missing role coverage work items.` });
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
      await this.host.store.enqueue(missionId, remediation);
      await this.host.store.saveEvent(missionId, { level: "warn", source: "reviewer-contract", message: "Reviewer reported issues without an implementer follow-up; remediation work was injected automatically." });
    }
  }

  public async runWorkItem(mission: Mission, item: WorkItem): Promise<"continue" | "awaiting_input" | "blocked"> {
    let blueprintAwaitingApproval = false;
    let preBlueprintAwaitingAnswers = false;
    const fresh = this.host.store.get(mission.id)!;
    if (shouldSkipRedundantValidatorWork(fresh, item)) {
      await this.host.store.updateWorkItem(mission.id, item.id, {
        status: "skipped",
        output: "Skipped: redundant validator after validation already passed."
      });
      await this.host.store.saveEvent(mission.id, {
        level: "info",
        source: "orchestrator",
        message: `Skipped redundant validator work item: ${item.title}`
      });
      await this.host.store.noteProgress(mission.id);
      return "continue";
    }

    await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, { status: "running" });
    await this.host.store.saveEvent(mission.id, {
      level: "info",
      source: `agent:${item.role}`,
      message: `Starting ${item.title}`,
      telemetryKind: "work_started",
      data: { workItemId: item.id, role: item.role, title: item.title }
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
    const context = this.host.collector instanceof EnhancedContextCollector
      ? await this.host.collector.collectForMission({
        isFirstWorkItem: completedCount === 0,
        keywords: extractKeywords(item.prompt, 5),
      })
      : await this.host.collector.collect();
    this.host.missionWorkAbort.get(mission.id)?.abort();
    const ac = new AbortController();
    this.host.missionWorkAbort.set(mission.id, ac);
    let result: AgentTurnResult;
    const onChunk = this.host.onAgentStreamChunk
      ? (chunk: string) => this.host.onAgentStreamChunk!(mission.id, item.id, item.role, chunk)
      : undefined;
    try {
      if (this.host.agentRunForTest) {
        result = await this.host.agentRunForTest(mission, item, context, { signal: ac.signal, onChunk });
      } else {
        const agent = this.host.agents.create(item.role);
        result = await agent.run(mission, item, context, { signal: ac.signal, onChunk });
      }
    } catch (err) {
      if (isLikelyStreamAbort(err, ac.signal)) {
        const bySignal = ac.signal.aborted;
        let reason = this.host.missionAbortReason.get(mission.id) || "unknown";
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

        await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: workItemStatus,
          hardStopClass,
          activeMutatingToolCall: undefined,
          output: outputMessage
        });

        if (shouldBlockMission) {
          this.host.pendingCompletionReason.delete(mission.id);
          // Operator abort: block the mission and require explicit resume
          await this.host.store.updateMission(mission.id, {
            status: "blocked",
            blocker: "Model stream cancelled (operator abort). Resume when ready.",
            blockReasonCode: "operator_stream_abort"
          });
          await this.host.store.saveEvent(mission.id, {
            level: "warn",
            source: "orchestrator",
            message: "Work item LLM stream aborted by operator."
          });
          return "blocked";
        } else {
          // System/timeout abort: work item fails but mission continues for recovery
          await this.host.store.saveEvent(mission.id, {
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
      if (this.host.missionWorkAbort.get(mission.id) === ac) {
        this.host.missionWorkAbort.delete(mission.id);
      }
      this.host.missionAbortReason.delete(mission.id);
      this.host.onAgentStreamDone?.(mission.id, item.id);

      if (didStash) {
        const fresh = this.host.store.get(mission.id);
        const itemFinal = fresh?.queue.find((w) => w.id === item.id);
        if (itemFinal?.status === "failed" || itemFinal?.status === "blocked") {
          try {
            await gitStashPop();
            await this.host.store.saveEvent(mission.id, { level: "info", source: "orchestrator", message: `Restored git stash after ${itemFinal.status} work item: ${item.title}` });
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
      await this.host.store.saveEvent(mission.id, {
        level: "info",
        source: "orchestrator",
        message: `Work item completed without tools (already_satisfied): ${alreadySatisfiedNoTool.reason}`
      });
    }

    let toolExecResult = await this.executeWorkItemToolCalls(mission, item, result);
    const earlyResolved = await this.maybeResolveToolFailureBlockedEarlyReturn(mission, item, toolExecResult);
    if (earlyResolved !== undefined) return earlyResolved;

    const maxToolFollowUps = resolveMaxToolFollowUpTurns(vscode.workspace.getConfiguration(), Boolean(this.host.agentRunForTest));
    const toolLoopRoles: AgentRole[] = ["implementer", "researcher", "reviewer"];
    let followUpTurn = 0;
    while (
      followUpTurn < maxToolFollowUps &&
      toolLoopRoles.includes(item.role) &&
      toolExecResult.toolResultSummaries?.length &&
      !this.host.missionWorkAbort.get(mission.id)?.signal.aborted
    ) {
      followUpTurn++;
      const followUpPrompt = [
        `Previous TOOL results (turn ${followUpTurn}):`,
        ...toolExecResult.toolResultSummaries,
        "",
        "Review the tool results above. If more tool calls are needed, emit TOOL: lines. If the task is now complete, output your final summary. Do not re-emit tools that already succeeded."
      ].join("\n");

      const ac = this.host.missionWorkAbort.get(mission.id);
      const followUpOnChunk = this.host.onAgentStreamChunk
        ? (chunk: string) => this.host.onAgentStreamChunk!(mission.id, item.id, item.role, chunk)
        : undefined;

      const followUpItem: WorkItem = { ...item, prompt: `${item.prompt}\n\n${followUpPrompt}` };
      let followUpResult: AgentTurnResult;
      try {
        if (this.host.agentRunForTest) {
          followUpResult = await this.host.agentRunForTest(mission, followUpItem, context, { signal: ac?.signal, onChunk: followUpOnChunk });
        } else {
          const agent = this.host.agents.create(item.role);
          followUpResult = await agent.run(mission, followUpItem, context, { signal: ac?.signal, onChunk: followUpOnChunk });
        }
      } catch {
        break;
      }

      await this.host.store.saveEvent(mission.id, {
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
      const loopEarly = await this.maybeResolveToolFailureBlockedEarlyReturn(mission, item, toolExecResult);
      if (loopEarly !== undefined) return loopEarly;
    }

    if (
      toolLoopRoles.includes(item.role) &&
      (toolExecResult.attemptedToolInvocations ?? 0) > 0 &&
      (toolExecResult.successfulToolStepsCount ?? 0) === 0 &&
      toolExecResult.hadRecoverableFailureAwaitingFollowUp === true
    ) {
      this.host.pendingCompletionReason.delete(mission.id);
      await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, {
        status: "failed",
        hardStopClass: "tool_failure",
        activeMutatingToolCall: undefined,
        output: `${result.summary}\n\nTool execution did not produce any successful tool results after follow-up turns. Inspect tool summaries in the mission timeline.`
      });
      const noSuccessBlock = {
        blocker: "Mission halted: tools were invoked but none completed successfully for this work item."
      };
      const enqueued = await this.tryEnqueueFailureInvestigationWave(mission.id, item.id, noSuccessBlock);
      if (enqueued) {
        await this.host.store.saveEvent(mission.id, {
          level: "info",
          source: "orchestrator",
          message: "Failure investigation wave enqueued after tool follow-up loop produced no successful tool results."
        });
        return "continue";
      }
      await this.host.store.updateMission(mission.id, {
        status: "blocked",
        blocker: noSuccessBlock.blocker,
        validationState: "failed",
        blockReasonCode: "tool_failure"
      });
      await this.host.store.saveEvent(mission.id, {
        level: "warn",
        source: "orchestrator",
        message: "Mission paused: tool batch had no successful results after the tool follow-up loop."
      });
      return "blocked";
    }

    let workCompletionKind = alreadySatisfiedNoTool ? "already_satisfied" as WorkItem["completionKind"] : undefined;
    if (!workCompletionKind && toolExecResult.derivedCompletionKind) {
      workCompletionKind = toolExecResult.derivedCompletionKind;
    }

    if (item.role === "validator" && result.toolCalls?.length) {
      const beforeDecision = result.decision;
      result = applyToolDrivenValidatorCompletion(item.role, result);
      if (beforeDecision !== result.decision && result.decision === "complete") {
        await this.host.store.saveEvent(mission.id, {
          level: "info",
          source: "orchestrator",
          message:
            "tool-driven-validator: inferred COMPLETE after successful tool calls with no BLOCKER/WORK lines (model omitted COMPLETE:)."
        });
      }
    }

    if (result.events?.length) {
      for (const event of result.events) await this.host.store.saveEvent(mission.id, event);
    }
    if (result.newMemory?.length) {
      for (const mem of result.newMemory) {
        const saved = await this.host.store.addMemory(mission.id, { ...mem, sourceMissionId: mission.id });
        await this.host.globalMemory.add(saved);
      }
    }

    if (item.role === "planner" && item.workItemPurpose === "pre_blueprint_clarify") {
      const parsed = parsePreBlueprintClarificationOutput(result.summary);
      if (parsed.errors.length) {
        await this.host.store.saveEvent(mission.id, {
          level: "error",
          source: "pre_blueprint",
          message: `Pre-blueprint parse failed: ${parsed.errors.join("; ")}`
        });
        await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: "failed",
          output: parsed.errors.join("\n")
        });
        await this.host.store.updateMission(mission.id, {
          status: "blocked",
          blocker: "Pre-blueprint clarification could not be parsed. Adjust the mission goal or switch model.",
          blockReasonCode: "generic_blocked"
        });
        await this.host.store.noteProgress(mission.id);
        return "blocked";
      }
      await this.host.store.updateMission(mission.id, {
        preBlueprintClarification: { questions: parsed.questions, status: "awaiting_answers" }
      });
      preBlueprintAwaitingAnswers = true;
      result = { ...result, nextWorkItems: [] };
    }

    const isBlueprintPlanner =
      item.role === "planner" &&
      (item.workItemPurpose === "blueprint_generate" || item.workItemPurpose === "blueprint_revise");

    if (isBlueprintPlanner) {
      const maxSteps = vscode.workspace.getConfiguration().get<number>("myAi.missions.maxBlueprintSteps", 40);
      const parsed = parseBlueprintModelOutput(result.summary, { maxSteps });
      if (!parsed.blueprint || parsed.errors.length) {
        await this.host.store.saveEvent(mission.id, {
          level: "error",
          source: "blueprint",
          message: `Blueprint parse failed: ${parsed.errors.join("; ")}`
        });
        await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, {
          status: "failed",
          output: parsed.errors.join("\n")
        });
        await this.host.store.updateMission(mission.id, {
          status: "blocked",
          blocker: "Mission blueprint could not be parsed. Adjust the mission goal or switch model.",
          blockReasonCode: "generic_blocked"
        });
        await this.host.store.noteProgress(mission.id);
        return "blocked";
      }

      const bp = parsed.blueprint;
      const requireApproval = vscode.workspace.getConfiguration().get<boolean>("myAi.missions.requireBlueprintApproval", true);
      result = { ...result, nextWorkItems: [] };

      if (requireApproval) {
        const readiness = validateBlueprintReadinessForApproval(bp);
        if (!readiness.ok) {
          const maxRev = vscode.workspace.getConfiguration().get<number>("myAi.missions.maxBlueprintRevisions", 3);
          if ((mission.blueprintRevisionCount || 0) >= maxRev) {
            const msg = `Blueprint readiness errors (revision limit reached):\n${readinessMessageText(readiness)}`;
            await this.host.store.updateMission(mission.id, {
              blueprint: { ...bp, status: "awaiting_approval" },
              status: "awaiting_input",
              blocker: "Blueprint has readiness errors and cannot be auto-revised further. Use Request Blueprint Revision or adjust the mission goal.",
              blockReasonCode: "manual_review_required"
            });
            await this.host.store.saveEvent(mission.id, { level: "warn", source: "blueprint-readiness", message: msg });
            blueprintAwaitingApproval = true;
          } else {
            const msg = `Blueprint readiness errors; scheduling revision.\n${readinessMessageText(readiness)}`;
            await this.host.store.saveEvent(mission.id, { level: "warn", source: "blueprint-readiness", message: msg });
            await this.host.store.updateMission(mission.id, {
              blueprint: { ...bp, status: "draft" },
              blueprintRevisionCount: (mission.blueprintRevisionCount || 0) + 1,
              status: "queued",
              blocker: undefined,
              blockReasonCode: undefined
            });
            const prior = JSON.stringify({
              requirementsSummary: bp.requirementsSummary,
              architectureSummary: bp.architectureSummary,
              goalEndState: bp.goalEndState,
              approachOptions: bp.approachOptions,
              chosenApproach: bp.chosenApproach,
              steps: bp.steps
            });
            await this.host.store.enqueue(mission.id, [
              {
                id: uid("work"),
                title: "Mission blueprint (readiness revision)",
                role: "planner",
                status: "todo",
                workItemPurpose: "blueprint_revise",
                prompt:
                  `Revise the full mission blueprint as structured JSON.\n\nReadiness report:\n${readinessMessageText(readiness)}\n\nPrior plan (reference): ${prior.slice(0, 12_000)}`
              }
            ]);
          }
        } else {
          const msg = readiness.report.warnings.length
            ? `Blueprint readiness warnings:\n${readinessMessageText(readiness)}`
            : "";
          if (msg) await this.host.store.saveEvent(mission.id, { level: "warn", source: "blueprint-readiness", message: msg });
          bp.status = "awaiting_approval";
          await this.host.store.updateMission(mission.id, { blueprint: bp });
          blueprintAwaitingApproval = true;
        }
      } else {
        bp.status = "approved";
        bp.approvedAt = Date.now();
        await this.host.store.updateMission(mission.id, { blueprint: bp });
        await this.host.enqueueSynthesizedBlueprintWork(mission.id);
        await this.host.addBlueprintMemoryMirror(mission.id);
        await this.host.store.saveEvent(mission.id, {
          level: "info",
          source: "blueprint",
          message: "Blueprint auto-approved; synthesized work queue from blueprint."
        });
      }
    }

    if (result.nextWorkItems?.length) {
      const flattened = flattenSubItems(result.nextWorkItems);
      await this.host.store.enqueue(mission.id, flattened);
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
    await this.host.updateWorkItemWithHardStopInvariant(mission.id, item, completionWorkPatch);
    await this.host.store.saveEvent(mission.id, {
      level: terminalWorkStatus === "failed" ? "error" : terminalWorkStatus === "blocked" ? "warn" : "info",
      source: "orchestrator",
      message: `Finished work item "${item.title}" (${terminalWorkStatus})`,
      telemetryKind:
        terminalWorkStatus === "failed" ? "work_failed" : terminalWorkStatus === "blocked" ? "mission_blocked" : "work_completed",
      data: { workItemId: item.id, role: item.role, status: terminalWorkStatus }
    });
    const updated = this.host.store.get(mission.id)!;
    const patch: Partial<Mission> = { currentStep: updated.currentStep + 1, blocker: undefined, blockReasonCode: undefined };
    if (item.role === "validator") {
      patch.validationState = result.decision === "complete" ? "passed" : result.decision === "blocked" ? "failed" : "pending";
      const ve = extractValidationVerdictFromSummary(result.summary || "");
      if (ve.validationVerdict) patch.validationVerdict = ve.validationVerdict;
      if (ve.validationLimits) patch.validationLimits = ve.validationLimits;
    }
    await this.host.store.noteProgress(mission.id);
    await this.host.store.updateMission(mission.id, patch);

    // Phase 3 (Verifier Mesh obligations): after implementer mutation under balanced/strict, run deterministic checks.
    if (item.role === "implementer" && toolExecResult.hadMutatingSideEffect) {
      const refreshed = this.host.store.get(mission.id)!;
      const preset = refreshed.policy.policyPreset || "balanced";
      if (preset === "balanced" || preset === "strict") {
        const warnStale = vscode.workspace.getConfiguration().get<boolean>("myAi.webResearch.warnStaleEvidenceOnMutation", true);
        if (warnStale) {
          const stale = findStaleResearchEvidenceMemories(refreshed.memory);
          if (!stale.length) {
            this.host.lastStaleEvidenceWarnSigByMission.delete(mission.id);
          } else {
            const sig = stale
              .map((s) => s.id)
              .sort()
              .join("|");
            if (this.host.lastStaleEvidenceWarnSigByMission.get(mission.id) !== sig) {
              this.host.lastStaleEvidenceWarnSigByMission.set(mission.id, sig);
              const hours = (ms: number) => Math.round(ms / 3_600_000);
              const detail = stale
                .slice(0, 6)
                .map((s) => `${s.id} (${s.freshness}, ~${hours(s.ageMs)}h old, ttl ~${hours(s.ttlMs)}h)`)
                .join("; ");
              await this.host.store.saveEvent(mission.id, {
                level: "warn",
                source: "research-evidence",
                message: `Stale web research evidence may be outdated (${stale.length}): ${detail}${stale.length > 6 ? " …" : ""}`
              });
            }
          }
        }
        await this.host.store.updateRuntime(mission.id, { lastImplementerMutationAt: Date.now() });
        await this.host.store.updateRuntime(mission.id, {
          promotionState: "experimental",
          promotionStateAt: Date.now()
        });
        const runLinterObligation = vscode.workspace.getConfiguration().get<boolean>("myAi.missions.verification.autoRunLinterAfterMutations", true);
        const runTestsObligation = vscode.workspace.getConfiguration().get<boolean>("myAi.missions.verification.autoRunTestsAfterMutations", true);
        let ok = true;
        if (runLinterObligation) {
          const r = await this.executeAndRecordToolCall(mission.id, {
            tool: "runLinter",
            args: { __workItemId: item.id, __workItemRole: item.role, __verification: true }
          }, ["verification"]);
          ok = ok && r.ok;
        }
        if (runTestsObligation) {
          const r = await this.executeAndRecordToolCall(mission.id, {
            tool: "runTests",
            args: { __workItemId: item.id, __workItemRole: item.role, __verification: true }
          }, ["verification"]);
          ok = ok && r.ok;
        }
        if (ok && (runLinterObligation || runTestsObligation)) {
          await this.host.store.updateRuntime(mission.id, { lastVerificationAt: Date.now() });
          await this.host.store.updateRuntime(mission.id, {
            promotionState: "verified",
            promotionStateAt: Date.now()
          });
        }
      }
    }

    if (blueprintAwaitingApproval) {
      await this.host.store.updateMission(mission.id, {
        status: "awaiting_input",
        blocker: "Review and approve the mission blueprint (command: Autonomous Factory: Approve Mission Blueprint).",
        blockReasonCode: "awaiting_blueprint_approval"
      });
    }

    if (preBlueprintAwaitingAnswers) {
      await this.host.store.updateMission(mission.id, {
        status: "awaiting_input",
        blocker: "Answer pre-blueprint questions in the Missions inspector, then submit (or command: Autonomous Factory: Submit Pre-Blueprint Answers).",
        blockReasonCode: "awaiting_pre_blueprint_answers"
      });
    }

    const wiAfter = this.host.store.get(mission.id)!.queue.find((w) => w.id === item.id);
    if (wiAfter?.blueprintStepId) {
      const bpSynced = applyBlueprintStepStatusFromWorkItem(this.host.store.get(mission.id)!, wiAfter, wiAfter.status);
      if (bpSynced) await this.host.store.updateMission(mission.id, { blueprint: bpSynced });
    }

    if (vscode.workspace.getConfiguration().get<boolean>("myAi.missions.autoCheckpointEveryStep", true)) {
      await this.host.store.addCheckpoint(mission.id, {
        step: updated.currentStep + 1,
        summary: checkpointSummaryForTerminalWorkItem(item, terminalWorkStatus),
        queueSnapshot: updated.queue.map((w) => ({ id: w.id, title: w.title, role: w.role, status: w.status }))
      });
    }

    if (item.role === "validator" && result.decision === "complete") {
      const archOn = vscode.workspace.getConfiguration().get<boolean>("myAi.missions.architectPassAfterValidator", false);
      const mVal = this.host.store.get(mission.id)!;
      if (archOn && mVal.blueprint?.status === "approved") {
        const hasTodoArch = mVal.queue.some((w) => w.role === "architect" && w.status === "todo");
        if (!hasTodoArch) {
          await this.host.store.enqueue(mission.id, [
            {
              id: uid("work"),
              title: "Architect gap review",
              role: "architect",
              status: "todo",
              prompt: "Review the mission against the approved blueprint and mission memory. Emit WORK: lines only if material gaps remain."
            }
          ]);
          await this.host.store.saveEvent(mission.id, { level: "info", source: "blueprint", message: "Enqueued architect pass after validator complete." });
        }
      }
    }

    if (item.role === "implementer") {
      const refreshed = this.host.store.get(mission.id)!;
      if (terminalWorkStatus === "done") {
        await this.host.maybeEnqueuePlanFidelityReview(mission.id, item);
      }
      if (refreshed.validationState !== "passed") {
        const hasTodoReview = refreshed.queue.some((w) => w.role === "reviewer" && w.status === "todo");
        if (!hasTodoReview) {
          await this.host.store.enqueue(mission.id, [
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

    if (
      item.role === "validator" &&
      terminalWorkStatus === "done" &&
      !blueprintAwaitingApproval &&
      vscode.workspace.getConfiguration().get<boolean>("myAi.missions.pauseAfterEachValidator", false)
    ) {
      await this.host.store.updateMission(mission.id, {
        status: "awaiting_input",
        blocker: "Validator step finished; use Autonomous Factory: Resume Mission after review.",
        blockReasonCode: "post_validator_checkpoint"
      });
      await this.host.store.saveEvent(mission.id, {
        level: "info",
        source: "orchestrator",
        message: "Paused after validator (myAi.missions.pauseAfterEachValidator)."
      });
      await this.host.store.noteProgress(mission.id);
      return "awaiting_input";
    }

    if (result.markStatus === "blocked") {
      this.host.pendingCompletionReason.delete(mission.id);
      const wiNow = this.host.store.get(mission.id)!.queue.find((w) => w.id === item.id)!;
      if (!isKnownImplementerHardStopClassValue(wiNow.hardStopClass)) {
        await this.host.updateWorkItemWithHardStopInvariant(mission.id, wiNow, { hardStopClass: "unknown_hard_stop" });
      }
      await this.host.store.updateMission(mission.id, {
        status: "blocked",
        blocker: item.title,
        validationState: "failed",
        blockReasonCode: "generic_blocked"
      });
      return "blocked";
    }

    return "continue";
  }
}
