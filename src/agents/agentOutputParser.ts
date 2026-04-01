import { ToolCall, WorkItem } from "../types";
import { parseRole, uid } from "../util";

export interface ParsedAgentOutput {
  toolCalls: ToolCall[];
  workItems: WorkItem[];
  memoryItems: Array<{ kind: string; tags: string[]; text: string }>;
  blocked: boolean;
  complete: boolean;
}

/**
 * Unified parser for structured lines in agent model output.
 * Handles TOOL:, WORK:, MEMORY:, BLOCKER:, and COMPLETE: prefixes
 * used across all agent roles.
 */
export function parseAgentOutput(text: string): ParsedAgentOutput {
  const toolCalls: ToolCall[] = [];
  const workItems: WorkItem[] = [];
  const memoryItems: ParsedAgentOutput["memoryItems"] = [];
  let blocked = false;
  let complete = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("TOOL:")) {
      try { toolCalls.push(JSON.parse(line.slice(5))); } catch { /* malformed JSON */ }
    }
    if (line.startsWith("BLOCKER:")) blocked = true;
    if (line.startsWith("COMPLETE:")) complete = true;

    const workMatch = line.match(/^WORK:([A-Z_]+)\s*:\s*(.+?)\s*-\s*(.+)$/i);
    if (workMatch) {
      workItems.push({
        id: uid("work"),
        title: workMatch[2],
        role: parseRole(workMatch[1]),
        status: "todo",
        prompt: workMatch[3]
      });
    }

    const memMatch = line.match(/^MEMORY:([a-z_]+):?([^-]*)-\s*(.+)$/i);
    if (memMatch) {
      memoryItems.push({
        kind: memMatch[1],
        tags: memMatch[2].split(",").map((x) => x.trim()).filter(Boolean),
        text: memMatch[3]
      });
    }
  }

  return { toolCalls, workItems, memoryItems, blocked, complete };
}
