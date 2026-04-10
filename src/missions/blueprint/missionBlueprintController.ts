/**
 * Blueprint controller: generation/repair/readiness/approval/synthesis policy for soft vs hard modes.
 * Planner remains the agent that emits blueprint JSON; this module owns host-side orchestration policy.
 */

import type { MissionEvent, WorkItem } from "../../types";
import type { MissionBlueprint } from "../missionBlueprintTypes";
import { validateBlueprintReadinessForApproval, type BlueprintReadinessVerdict } from "../blueprintReadinessGate";
import { readinessMessageText } from "../orchestrator/orchestratorLeafHelpers";
import { effectiveRequireBlueprintApproval, type MissionBlueprintMode } from "../missionBlueprintMode";
import type { MissionStore } from "../MissionStore";
import { uid } from "../../util";

export type BlueprintParseFailureOutcome = "replan" | "soft_fallback" | "block";

export function planBlueprintParseFailureOutcome(input: {
  mode: MissionBlueprintMode;
  recoveryReplanAllowed: boolean;
}): BlueprintParseFailureOutcome {
  if (input.recoveryReplanAllowed) return "replan";
  if (input.mode === "soft") return "soft_fallback";
  return "block";
}

export type ReadinessFailureOutcome = "schedule_revision" | "soft_fallback" | "awaiting_manual_review";

export function planReadinessFailureOutcome(input: {
  mode: MissionBlueprintMode;
  revisionUnderCap: boolean;
}): ReadinessFailureOutcome {
  if (input.revisionUnderCap) return "schedule_revision";
  if (input.mode === "soft") return "soft_fallback";
  return "awaiting_manual_review";
}

/** When pre-blueprint Q&A cannot be parsed in soft mode, skip clarification and run blueprint JSON generation. */
export function buildPreBlueprintSoftFallbackBlueprintGenerateItem(id: string): WorkItem {
  return {
    id,
    title: "Mission blueprint (full plan)",
    role: "planner",
    status: "todo",
    workItemPurpose: "blueprint_generate",
    prompt:
      "Generate the full mission blueprint as structured JSON (see system instructions). Pre-blueprint clarification output failed validation repeatedly; proceed without Q&A."
  };
}

export type PreBlueprintParseFailurePlan = "replan" | "soft_blueprint_direct" | "block";

export function planPreBlueprintParseFailureOutcome(input: {
  mode: MissionBlueprintMode;
  replanAllowed: boolean;
}): PreBlueprintParseFailurePlan {
  if (input.replanAllowed) return "replan";
  if (input.mode === "soft") return "soft_blueprint_direct";
  return "block";
}

export function buildDynamicDecompositionPlannerItem(id: string, missionPrompt: string): WorkItem {
  return {
    id,
    title: "Initial planning (dynamic decomposition)",
    role: "planner",
    status: "todo",
    prompt: [
      "Structured blueprint JSON could not be repaired within budget.",
      "Ignore blueprint JSON for this mission: break the goal into bounded WORK items with explicit roles and dependencies (normal planner protocol).",
      "",
      "## Mission goal",
      missionPrompt.trim().slice(0, 12_000)
    ].join("\n")
  };
}

export function buildBlueprintParseRecoveryWorkItem(
  id: string,
  parsedErrors: string[],
  resultSummary: string
): WorkItem {
  return {
    id,
    title: "Mission blueprint (parse recovery revision)",
    role: "planner",
    status: "todo",
    workItemPurpose: "blueprint_revise",
    prompt: [
      "Revise the full mission blueprint as structured JSON.",
      "The previous blueprint output failed parser validation with:",
      parsedErrors.join("; ").slice(0, 8000),
      "",
      "Prior model output (reference, may be invalid JSON):",
      resultSummary.slice(0, 12_000)
    ].join("\n\n")
  };
}

export function buildBlueprintReadinessRevisionWorkItem(id: string, bp: MissionBlueprint, readiness: BlueprintReadinessVerdict): WorkItem {
  const prior = JSON.stringify({
    requirementsSummary: bp.requirementsSummary,
    architectureSummary: bp.architectureSummary,
    goalEndState: bp.goalEndState,
    approachOptions: bp.approachOptions,
    chosenApproach: bp.chosenApproach,
    steps: bp.steps
  });
  return {
    id,
    title: "Mission blueprint (readiness revision)",
    role: "planner",
    status: "todo",
    workItemPurpose: "blueprint_revise",
    prompt: `Revise the full mission blueprint as structured JSON.\n\nReadiness report:\n${readinessMessageText(readiness)}\n\nPrior plan (reference): ${prior.slice(0, 12_000)}`
  };
}

export async function finalizeParsedBlueprint(args: {
  store: MissionStore;
  missionId: string;
  mode: MissionBlueprintMode;
  bp: MissionBlueprint;
  blueprintRevisionCount: number;
  maxBlueprintRevisions: number;
  requireBlueprintApprovalFromConfig: boolean;
  enqueueSynthesizedBlueprintWork: (missionId: string) => Promise<void>;
  addBlueprintMemoryMirror: (missionId: string) => Promise<void>;
}): Promise<{ blueprintAwaitingApproval: boolean }> {
  const requireApproval = effectiveRequireBlueprintApproval(args.mode, args.requireBlueprintApprovalFromConfig);
  const readiness = validateBlueprintReadinessForApproval(args.bp);

  if (!readiness.ok) {
    const revisionUnderCap = args.blueprintRevisionCount < args.maxBlueprintRevisions;
    const r = planReadinessFailureOutcome({ mode: args.mode, revisionUnderCap });
    if (r === "schedule_revision") {
      const msg = `Blueprint readiness errors; scheduling revision.\n${readinessMessageText(readiness)}`;
      await args.store.saveEvent(args.missionId, { level: "warn", source: "blueprint-readiness", message: msg });
      await args.store.updateMission(args.missionId, {
        blueprint: { ...args.bp, status: "draft" },
        blueprintRevisionCount: args.blueprintRevisionCount + 1,
        status: "queued",
        blocker: undefined,
        blockReasonCode: undefined
      });
      await args.store.enqueue(args.missionId, [buildBlueprintReadinessRevisionWorkItem(uid("work"), args.bp, readiness)]);
      return { blueprintAwaitingApproval: false };
    }
    if (r === "soft_fallback") {
      const msg = `Blueprint readiness failed after revision budget; falling back to dynamic decomposition (soft mode).\n${readinessMessageText(readiness)}`;
      await args.store.saveEvent(args.missionId, { level: "warn", source: "blueprint-readiness", message: msg });
      const m = args.store.get(args.missionId)!;
      await args.store.updateMission(args.missionId, {
        blueprint: undefined,
        status: "queued",
        blocker: undefined,
        blockReasonCode: undefined
      });
      await args.store.enqueue(args.missionId, [buildDynamicDecompositionPlannerItem(uid("work"), m.prompt)]);
      return { blueprintAwaitingApproval: false };
    }
    const msg = `Blueprint readiness errors (revision limit reached):\n${readinessMessageText(readiness)}`;
    await args.store.updateMission(args.missionId, {
      blueprint: { ...args.bp, status: "awaiting_approval" },
      status: "awaiting_input",
      blocker: "Blueprint has readiness errors and cannot be auto-revised further. Use Request Blueprint Revision or adjust the mission goal.",
      blockReasonCode: "manual_review_required"
    });
    await args.store.saveEvent(args.missionId, { level: "warn", source: "blueprint-readiness", message: msg });
    return { blueprintAwaitingApproval: true };
  }

  const msgWarn =
    readiness.report.warnings.length > 0 ? `Blueprint readiness warnings:\n${readinessMessageText(readiness)}` : "";
  if (msgWarn) {
    await args.store.saveEvent(args.missionId, { level: "warn", source: "blueprint-readiness", message: msgWarn });
  }

  if (requireApproval) {
    args.bp.status = "awaiting_approval";
    await args.store.updateMission(args.missionId, { blueprint: args.bp });
    return { blueprintAwaitingApproval: true };
  }

  args.bp.status = "approved";
  args.bp.approvedAt = Date.now();
  await args.store.updateMission(args.missionId, { blueprint: args.bp });
  await args.enqueueSynthesizedBlueprintWork(args.missionId);
  await args.addBlueprintMemoryMirror(args.missionId);
  await args.store.saveEvent(args.missionId, {
    level: "info",
    source: "blueprint",
    message: "Blueprint auto-approved; synthesized work queue from blueprint."
  });
  return { blueprintAwaitingApproval: false };
}
