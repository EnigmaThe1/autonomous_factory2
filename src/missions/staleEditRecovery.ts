import type { AgentRole, Mission, ToolCall } from "../types";

/**
 * applyPatch failed because search text was not present. ToolRegistry may still return ok when
 * `applyPatchNoOpPolicy` recognizes replace text already verbatim in the file; this path covers
 * the remaining failures (e.g. replace absent or below minimum length).
 */
export function isStaleApplyPatchSearchNotFound(call: Pick<ToolCall, "tool">, toolSummary: string): boolean {
  return call.tool === "applyPatch" && /search text not found/i.test(toolSummary);
}

export type StaleImplementerToolRecoveryDecision = "recover_to_satisfied" | "no_recovery";

/**
 * Bounded recovery: only implementer + applyPatch search miss + mission already validated passed.
 * Does not treat generic tool failures or pending/failed validation as recoverable.
 */
export function staleImplementerToolFailureRecoveryDecision(
  itemRole: AgentRole,
  mission: Pick<Mission, "validationState">,
  call: Pick<ToolCall, "tool">,
  toolSummary: string
): StaleImplementerToolRecoveryDecision {
  if (itemRole !== "implementer") return "no_recovery";
  if (!isStaleApplyPatchSearchNotFound(call, toolSummary)) return "no_recovery";
  if (mission.validationState !== "passed") return "no_recovery";
  return "recover_to_satisfied";
}
