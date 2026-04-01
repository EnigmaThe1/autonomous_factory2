import { parseValidatorModelOutput } from "../agents/validatorOutputParse";
import { AgentRole, AgentTurnResult } from "../types";

/**
 * When the validator used tools and they all succeeded, the model often confirms in prose
 * but omits a literal COMPLETE: line — leaving decision at needs_followup and trapping closure.
 * If the structured output has no BLOCKER and no WORK lines, treat the turn as complete.
 */
export function applyToolDrivenValidatorCompletion(role: AgentRole, result: AgentTurnResult): AgentTurnResult {
  if (role !== "validator" || !result.toolCalls?.length) return result;
  const parsed = parseValidatorModelOutput(result.summary);
  if (parsed.blocked || parsed.nextWorkItems.length > 0) return result;
  if (result.decision === "complete" || result.decision === "blocked") return result;
  if (result.decision === "needs_followup") {
    return { ...result, decision: "complete", nextWorkItems: [] };
  }
  return result;
}
