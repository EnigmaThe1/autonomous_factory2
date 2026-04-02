import * as vscode from "vscode";
import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";
import { CODING_STANDARDS_FRAGMENT } from "./instructionFragments";

export class ReviewerAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const enforce = vscode.workspace.getConfiguration().get<boolean>("myAi.agents.enforceDefaultCodingStandards", true);
    const extra = enforce ? ` ${CODING_STANDARDS_FRAGMENT}` : "";
    const text = await this.askModel(
      mission,
      item,
      context,
      `You are a reviewer. Identify defects, risks, and missing validation. You may emit TOOL lines and WORK follow-ups. If there is nothing material to review because requirements are already met, output exactly one line: ALREADY_SATISFIED: brief reason — and do not emit any TOOL lines.${extra}`,
      options?.signal,
      options?.onChunk
    );
    const parsed = parseAgentOutput(text);
    return {
      summary: text,
      toolCalls: parsed.toolCalls,
      nextWorkItems: parsed.workItems,
      markStatus: "done",
      newMemory: [{ kind: "finding", text, tags: ["review"] }]
    };
  }
}
