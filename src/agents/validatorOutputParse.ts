import { ToolCall, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";

/** Parses validator model text: TOOL/BLOCKER/COMPLETE/WORK lines. Exported for unit tests. */
export function parseValidatorModelOutput(text: string): {
  toolCalls: ToolCall[];
  nextWorkItems: WorkItem[];
  blocked: boolean;
  complete: boolean;
} {
  const parsed = parseAgentOutput(text);
  return {
    toolCalls: parsed.toolCalls,
    nextWorkItems: parsed.workItems,
    blocked: parsed.blocked,
    complete: parsed.complete
  };
}
