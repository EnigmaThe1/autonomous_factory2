import type { ToolCall } from "../../types";
import type { ToolResult } from "../../tools/ToolRegistry";
import type { ToolOutcomeDecision } from "../orchestrator/toolOutcomeClassifier";
import type { FailureClass, FailureDomain, StructuredFailure } from "./structuredFailureTypes";

const HOST_OR_OUTSIDE_WORKSPACE = /host-risk|outside workspace|outside the workspace|working directory is outside|path is outside workspace/i;

function sf(
  cls: FailureClass,
  domain: FailureDomain,
  code: string,
  message: string,
  tool?: string
): StructuredFailure {
  return { class: cls, domain, code, message, tool };
}

/** Policy denials from TrustPolicyEngine / autonomy (blockedByPolicy tool results). */
export function classifyPolicyDenial(summary: string, tool?: string): StructuredFailure {
  const s = String(summary || "");
  if (HOST_OR_OUTSIDE_WORKSPACE.test(s)) {
    return sf("hard_deny", "policy", "host_or_outside_workspace_denial", s, tool);
  }
  return sf("hard_deny", "policy", "policy_denied", s, tool);
}

/**
 * Hard tool failures that already exhausted classifier "continue" budgets in `classifyToolOutcome`.
 */
export function classifyToolFailureStructured(
  decision: ToolOutcomeDecision,
  call: ToolCall,
  toolResult: ToolResult
): StructuredFailure {
  const tool = call.tool;
  const summary = String(toolResult.summary || "");
  if (decision.kind === "blocked" && decision.category === "policy_denied") {
    return classifyPolicyDenial(summary, tool);
  }
  if (decision.kind !== "blocked" || decision.category !== "tool_failure") {
    return sf("repairable", "tool", "unexpected_non_blocked_tool_failure", summary, tool);
  }
  if (/\bcrashed:/i.test(summary)) {
    return sf("hard_deny", "tool", "tool_executor_crashed", summary, tool);
  }
  if (/timeout|timed out|ECONN|EAI_AGAIN|ENETUNREACH|rate limit|429|503|502|504|temporar(il)?y unavailable/i.test(summary)) {
    return sf("transient", "tool", "transient_tool_failure", summary, tool);
  }
  return sf("repairable", "tool", "tool_failure", summary, tool);
}

/** Post-mutation lint/test or explicit validator tool evidence (call only when the check failed). */
export function classifyValidationFailure(input: {
  tool: "runTests" | "runLinter" | "validator_decision";
  summary: string;
}): StructuredFailure {
  const s = String(input.summary || "");
  if (/timeout|timed out|ECONN|EAI_AGAIN/i.test(s)) {
    return sf("transient", "validation", "transient_validation_failure", s, input.tool);
  }
  if (/ENOENT|not found|cannot find|No such file|environment|missing module|not installed/i.test(s)) {
    return sf("environmental", "validation", "environmental_validation_failure", s, input.tool);
  }
  return sf("repairable", "validation", "validation_failed", s, input.tool);
}

export function classifyBlueprintFailure(errors: string[]): StructuredFailure {
  const msg = errors.length ? errors.join("; ") : "Unknown blueprint error";
  if (/timeout|timed out|rate limit|503|502|504/i.test(msg)) {
    return sf("transient", "blueprint", "blueprint_transient", msg);
  }
  if (/network|fetch|unavailable|provider/i.test(msg)) {
    return sf("environmental", "blueprint", "blueprint_environmental", msg);
  }
  return sf("repairable", "blueprint", "blueprint_parse_or_shape", msg);
}

export function classifyRuntimeStreamAbort(reason: "operator" | "system" | "timeout" | "unknown"): StructuredFailure {
  if (reason === "operator") {
    return sf("hard_deny", "runtime", "operator_stream_abort", "Model stream cancelled by operator.");
  }
  if (reason === "timeout" || reason === "system") {
    return sf("transient", "runtime", "stream_timeout_or_system", `Model stream cancelled (${reason}).`);
  }
  return sf("environmental", "runtime", "stream_abort_unknown", "Model stream cancelled (unknown reason).");
}
