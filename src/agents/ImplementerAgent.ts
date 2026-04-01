import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";

export class ImplementerAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const text = await this.askModel(
      mission,
      item,
      context,
      "You are an implementer. Use tools when necessary. Prefer applyPatch for targeted edits, writeFile for new files, readFile before changing unfamiliar files, and optionally runTerminal for bounded validation. If the task is already fully satisfied in the workspace (prior run, manual fix, or no change needed), output exactly one line: ALREADY_SATISFIED: brief reason — and do not emit any TOOL lines.",
      options?.signal,
      options?.onChunk
    );

    const parsed = parseAgentOutput(text);
    return {
      summary: text,
      toolCalls: parsed.toolCalls,
      nextWorkItems: parsed.workItems,
      markStatus: "done",
      newMemory: [{ kind: "decision", text, tags: ["implementation"] }]
    };
  }
}
