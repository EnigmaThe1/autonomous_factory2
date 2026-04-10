import type { ToolApproval } from "../types";
import { trimText } from "../util";
import type { ToolResult } from "./ToolRegistry";

/**
 * Central factory for `ToolResult` rows that pause execution until operator approval.
 *
 * ## Policy matrix (where approvals come from)
 *
 * - **TrustPolicyEngine** (`policyEngine().decide`) sets `requiresApproval` per action:
 *   `write_file`, `apply_patch`, `run_terminal`, `run_command`, `call_mcp`, `call_external`, `http_request`.
 * - **File writes / patches** with diff preview use `ToolRegistry.buildFileApprovalResult` (not this helper).
 * - **Non-implementer mutations** use `requireApprovalForNonImplementerMutation` (terminal-shaped titles), unless `myAi.tools.requireApprovalForNonImplementerMutations` is false.
 * - **Trust-action gate** (`evaluateTrustActionGate`) supplies dynamic terminal titles/details for risky commands/patches.
 *
 * Kinds must match `ApprovalRequest["kind"]` / `ToolApproval.kind` consumed by the mission approval UI.
 */
export function pendingApprovalToolResult(params: {
  kind: ToolApproval["kind"];
  summary: string;
  title: string;
  details: string;
  /** When set, applies `trimText` to bound UTF-8-ish size; when omitted, `details` are kept as-is. */
  detailsMaxChars?: number;
}): ToolResult {
  const details =
    params.detailsMaxChars !== undefined ? trimText(params.details, params.detailsMaxChars) : params.details;
  return {
    ok: false,
    summary: params.summary,
    requiresApproval: {
      kind: params.kind,
      title: params.title,
      details
    }
  };
}
