import type { ToolCall } from "../../types";
import type { ToolResult } from "../../tools/ToolRegistry";

export type ToolOutcomeCategory =
  | "approval_required"
  | "policy_denied"
  | "recoverable_readonly"
  | "recoverable_mutating"
  | "transient_mutating"
  | "run_command_probe"
  | "run_command_agent_retry"
  | "write_file_agent_retry"
  | "apply_patch_agent_retry"
  | "tool_failure";

/**
 * runCommand is classified as mutating for attribution, but many agents use it only for
 * discovery (ls/find/cat). Exit 1 with missing-path diagnostics should not hard-block the mission.
 */
/** True when applyPatch failed because the target path does not exist (sync throw or ENOENT), recoverable like readFile-missing. */
export function isApplyPatchTargetPathMissingError(summary: string): boolean {
  const s = String(summary || "");
  return /enoent/i.test(s) || /no such file or directory/i.test(s) || /entrynotfound/i.test(s);
}

export function isRunCommandBenignDiscoveryFailure(result: ToolResult): boolean {
  if (result.ok) return false;
  const data = result.data as
    | { exitCode?: number | null; stdout?: string; stderr?: string; timedOut?: boolean }
    | undefined;
  if (data?.timedOut) return false;
  const exit = data?.exitCode;
  // Typical for cat/find/head on missing paths; avoid masking broader exit codes.
  if (exit !== 1) return false;
  const blob = `${data?.stderr || ""}\n${data?.stdout || ""}\n${result.summary || ""}`;
  return /no such file|not a directory|cannot stat|cannot access|ENOENT|No such file/i.test(blob);
}

export type ToolOutcomeDecision =
  | { kind: "continue"; category: ToolOutcomeCategory; tags?: string[]; hintLines?: string[] }
  | { kind: "awaiting_input"; category: "approval_required" }
  | { kind: "blocked"; category: "policy_denied" | "tool_failure" };

export function classifyToolOutcome(input: {
  call: ToolCall;
  result: ToolResult;
  isReadonlyTool: boolean;
  isMutatingTool: boolean;
  readonlyBudgetRemaining: boolean;
  isReadFileMissing: boolean;
  transientMutatingBudgetRemaining?: boolean;
  runCommandProbeBudgetRemaining?: boolean;
  /** When true, failed runCommand may continue so the model can retry with a different command (bounded per work item). */
  runCommandAgentRetryBudgetRemaining?: boolean;
  /** When true, failed writeFile may continue for a bounded retry / different path or content. */
  writeFileAgentRetryBudgetRemaining?: boolean;
  /** When true, failed applyPatch may continue for a bounded retry / fixed search context. */
  applyPatchAgentRetryBudgetRemaining?: boolean;
}): ToolOutcomeDecision {
  const { result, isReadonlyTool, isMutatingTool, readonlyBudgetRemaining, isReadFileMissing } = input;

  if (result.requiresApproval) return { kind: "awaiting_input", category: "approval_required" };
  if (!result.ok && result.blockedByPolicy) return { kind: "blocked", category: "policy_denied" };
  if (!result.ok) {
    // Special-case: missing readFile should be recoverable.
    if (isReadFileMissing) {
      return {
        kind: "continue",
        category: "recoverable_readonly",
        tags: ["non_fatal", "file_not_found"],
        hintLines: [
          "[hint] Missing file: decide whether this file is an expected output artifact. If yes, create it with writeFile and meaningful initial content (header + sections + any known progress) — do not create an empty placeholder. If no, locate the correct path via listFiles/fileTree/grepSearch instead of guessing."
        ]
      };
    }
    if (
      input.call.tool === "runCommand" &&
      isRunCommandBenignDiscoveryFailure(result) &&
      input.runCommandProbeBudgetRemaining === true
    ) {
      return {
        kind: "continue",
        category: "run_command_probe",
        tags: ["non_fatal", "run_command_missing_path"],
        hintLines: [
          "[hint] Shell command failed with a missing-path style error. Re-list the real directory (e.g. ls docs/autonomy_factory_stress_test*), do not trust MEMORY that names paths you have not listed this turn, then retry with paths that exist."
        ]
      };
    }
    if (isReadonlyTool && readonlyBudgetRemaining) {
      return {
        kind: "continue",
        category: "recoverable_readonly",
        tags: ["non_fatal", "recoverable_readonly_failure"],
        hintLines: [
          "[hint] Read-only tool failed. Recover by adjusting inputs: fix paths/casing, use listFiles/fileTree/grepSearch for discovery, or simplify queries. Avoid repeating the same failing call."
        ]
      };
    }
    if (isMutatingTool) {
      const s = String(result.summary || "");
      // applyPatch often throws ENOENT before patch logic; treat as bounded retry (mkdir/writeFile/fix path), not hard "crashed".
      if (
        input.call.tool === "applyPatch" &&
        input.applyPatchAgentRetryBudgetRemaining === true &&
        isApplyPatchTargetPathMissingError(s)
      ) {
        return {
          kind: "continue",
          category: "apply_patch_agent_retry",
          tags: ["non_fatal", "apply_patch_target_missing"],
          hintLines: [
            "[hint] applyPatch could not open the target (missing file or parent directory). listFiles or runCommand to verify paths, mkdir -p parents if policy allows, then create with writeFile or correct the path before patching. Do not repeat the same patch against a non-existent file."
          ]
        };
      }
      // Tool executor caught an unexpected throw — do not treat as an agent-retry candidate.
      if (/\bcrashed:/i.test(s)) {
        return { kind: "blocked", category: "tool_failure" };
      }
      const transientLike = /timeout|timed out|ECONN|EAI_AGAIN|ENET|temporar(il)?y|rate limit|429|503|502|504/i.test(s);
      if (transientLike && input.transientMutatingBudgetRemaining) {
        return {
          kind: "continue",
          category: "transient_mutating",
          tags: ["non_fatal", "transient_mutating_failure"],
          hintLines: [
            "[hint] Mutating tool failed with a transient-looking error. Prefer a bounded retry with adjusted parameters (timeout, cwd, smaller scope) or a safer alternative. Do not loop the exact same call without new evidence."
          ]
        };
      }
      if (input.call.tool === "runCommand" && input.runCommandAgentRetryBudgetRemaining === true) {
        const data = result.data as { timedOut?: boolean; exitCode?: number | null } | undefined;
        const hintLines = [
          "[hint] runCommand failed but you may recover: read stdout/stderr below, fix shell syntax (POSIX vs bash), paths, cwd, or split into smaller commands. Prefer writeFile/applyPatch for file content when appropriate. Do not repeat the exact same command without a change. If prior steps may have partially changed the workspace, reconcile before retrying."
        ];
        if (data?.timedOut) {
          hintLines.push(
            "[hint] Command timed out: shorten work, narrow scope, raise timeout if appropriate, or use targeted tools instead of one huge script."
          );
        }
        return {
          kind: "continue",
          category: "run_command_agent_retry",
          tags: ["non_fatal", "run_command_agent_retry"],
          hintLines
        };
      }
      if (input.call.tool === "writeFile" && input.writeFileAgentRetryBudgetRemaining === true) {
        return {
          kind: "continue",
          category: "write_file_agent_retry",
          tags: ["non_fatal", "write_file_agent_retry"],
          hintLines: [
            "[hint] writeFile failed but you may recover: validate workspace-relative path, parent directory exists (runCommand mkdir -p if allowed), encoding/size limits, policy/scope. Re-read the file if overwriting. Prefer applyPatch for small edits to existing files. Do not repeat the exact same write without changes. Recovery-spine paths require explicit approval and __recoverySpineOverride when policy allows."
          ]
        };
      }
      if (input.call.tool === "applyPatch" && input.applyPatchAgentRetryBudgetRemaining === true) {
        return {
          kind: "continue",
          category: "apply_patch_agent_retry",
          tags: ["non_fatal", "apply_patch_agent_retry"],
          hintLines: [
            "[hint] applyPatch failed but you may recover: readFile the target to refresh exact SEARCH text (whitespace, line endings). Ensure the file exists; use writeFile for new files. Narrow SEARCH to a unique snippet. If replace is already present, confirm no-op semantics. Do not repeat the identical patch without rereading the file."
          ]
        };
      }
      return { kind: "blocked", category: "tool_failure" };
    }
    // Default: unknown tool failure blocks (conservative fallback).
    return { kind: "blocked", category: "tool_failure" };
  }

  return { kind: "continue", category: isMutatingTool ? "recoverable_mutating" : "recoverable_readonly" };
}

