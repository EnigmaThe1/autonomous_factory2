import type { BlueprintReadinessVerdict } from "../blueprintReadinessGate";
import type { ToolCall, WorkItem } from "../../types";
import { READONLY_MISSION_TOOL_IDS } from "../readonlyMissionToolIds";

export function readinessMessageText(readiness: BlueprintReadinessVerdict): string {
  const errs = readiness.report.errors.length ? `Errors:\n- ${readiness.report.errors.join("\n- ")}` : "";
  const warns = readiness.report.warnings.length ? `Warnings:\n- ${readiness.report.warnings.join("\n- ")}` : "";
  return [errs, warns].filter(Boolean).join("\n");
}

/** Used when marking `activeMutatingToolCall` on the work item (orchestrator copy; keep aligned with tool naming). */
export function isPotentiallyMutatingToolCall(call: ToolCall): boolean {
  if (READONLY_MISSION_TOOL_IDS.has(call.tool)) return false;
  if (
    call.tool === "write_file" ||
    call.tool === "apply_patch" ||
    call.tool === "delete_file" ||
    call.tool === "rename_file" ||
    call.tool === "run_terminal"
  )
    return true;
  if (call.tool.startsWith("ext.") || call.tool.startsWith("mcp.")) return true;
  return true;
}

export function mutatingToolTarget(call: ToolCall): string | undefined {
  const args = (call.args || {}) as Record<string, unknown>;
  const p = args.path;
  return typeof p === "string" && p.trim() ? p : undefined;
}

export function checkpointSummaryForTerminalWorkItem(item: WorkItem, terminalStatus: WorkItem["status"]): string {
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

/**
 * Flattens work items that contain sub-items into a single queue.
 * Sub-items are placed after their parent in the queue.
 */
export function flattenSubItems(items: WorkItem[]): WorkItem[] {
  const result: WorkItem[] = [];
  for (const item of items) {
    if (item.subItems?.length) {
      result.push(...item.subItems);
      const parent: WorkItem = {
        ...item,
        subItems: undefined,
        status: "done",
        output: `Decomposed into ${item.subItems.length} sub-items.`
      };
      result.push(parent);
    } else {
      result.push(item);
    }
  }
  return result;
}

/** Extract salient keywords from a prompt for relevant-file discovery. */
export function extractKeywords(prompt: string, max: number): string[] {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "that",
    "this",
    "with",
    "from",
    "are",
    "was",
    "will",
    "have",
    "has",
    "been",
    "all",
    "each",
    "not",
    "but",
    "can",
    "should"
  ]);
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
  const unique = [...new Set(words)];
  return unique.slice(0, max);
}
