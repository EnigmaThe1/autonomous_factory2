import type { AgentRole, Mission, ToolCall, WorkItem } from "../types";

const ALREADY_SATISFIED_LINE = /^\s*ALREADY_SATISFIED:\s*(.*)\s*$/i;

/**
 * Parse the first `ALREADY_SATISFIED: reason` line from model output (whole-line match).
 * Used when the model intentionally skips tools because the step is already satisfied.
 */
export function parseAlreadySatisfiedDeclaration(agentSummary: string): { reason: string } | null {
  for (const line of agentSummary.split(/\r?\n/)) {
    const m = line.match(ALREADY_SATISFIED_LINE);
    if (m) return { reason: m[1].trim() || "(no reason given)" };
  }
  return null;
}

const HONOR_ROLES: ReadonlySet<AgentRole> = new Set(["implementer", "reviewer"]);

/**
 * When the model emits `ALREADY_SATISFIED:` and **no** TOOL calls, treat the work item as
 * resolved without tool execution. If any tools are present, the declaration is ignored (tools win).
 * Validator/planner roles are excluded so validation and planning cannot self-dismiss.
 */
export function shouldHonorAlreadySatisfiedNoToolRun(
  role: AgentRole,
  agentSummary: string,
  toolCalls: ToolCall[] | undefined
): { reason: string } | null {
  if (!HONOR_ROLES.has(role)) return null;
  if (toolCalls && toolCalls.length > 0) return null;
  return parseAlreadySatisfiedDeclaration(agentSummary);
}

/** For completion metadata: any required work item finished via no-tool already-satisfied path. */
export function missionQueueHasAlreadySatisfiedWorkItem(
  queue: ReadonlyArray<Pick<WorkItem, "completionKind">>
): boolean {
  return queue.some((w) => w.completionKind === "already_satisfied");
}

/** Queue includes a step that completed via deterministic applyPatch no-op (replace already on disk). */
export function missionQueueHasApplyPatchNoopWorkItem(
  queue: ReadonlyArray<Pick<WorkItem, "completionKind">>
): boolean {
  return queue.some((w) => w.completionKind === "apply_patch_noop");
}

/**
 * Mission terminal `completionReason` when entering `completed`.
 *
 * Precedence (highest first):
 * 1. `pendingReason` from orchestrator (e.g. `stale_patch_but_goal_already_met` after validation passed).
 * 2. `already_satisfied_no_tool_run` if any work item has `completionKind: "already_satisfied"`.
 * 3. `apply_patch_noop_success` if any work item has `completionKind: "apply_patch_noop"` (and none of the above applied).
 * 4. Otherwise `undefined`.
 */
export function resolveCompletionReasonForCompletedMission(
  pendingReason: Mission["completionReason"] | undefined,
  queue: ReadonlyArray<Pick<WorkItem, "completionKind">>
): Mission["completionReason"] | undefined {
  if (pendingReason) return pendingReason;
  if (missionQueueHasAlreadySatisfiedWorkItem(queue)) return "already_satisfied_no_tool_run";
  if (missionQueueHasApplyPatchNoopWorkItem(queue)) return "apply_patch_noop_success";
  return undefined;
}
