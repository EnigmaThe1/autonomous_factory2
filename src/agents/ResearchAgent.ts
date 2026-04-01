import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, MemoryItem, Mission, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";

export class ResearchAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const text = await this.askModel(
      mission,
      item,
      context,
      "You are a researcher. Summarize findings and propose up to three tool calls as TOOL JSON lines. Favor listFiles, searchFiles, readFile, and getDiagnostics.",
      options?.signal,
      options?.onChunk
    );

    const parsed = parseAgentOutput(text);
    const newMemory: AgentTurnResult["newMemory"] = [
      ...parsed.memoryItems.map((m) => ({ kind: m.kind as MemoryItem["kind"], tags: m.tags, text: m.text })),
      { kind: "finding" as const, text, tags: ["research"] }
    ];

    return { summary: text, toolCalls: parsed.toolCalls, markStatus: "done", newMemory };
  }
}
