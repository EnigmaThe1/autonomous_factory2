import * as vscode from "vscode";
import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";
import { normalizeParsedMemoryItemsForStorage } from "../missions/claimTrust";
import { CODING_STANDARDS_FRAGMENT } from "./instructionFragments";

export class ImplementerAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const enforce = vscode.workspace.getConfiguration().get<boolean>("myAi.agents.enforceDefaultCodingStandards", true);
    const extra = enforce ? ` ${CODING_STANDARDS_FRAGMENT}` : "";
    const text = await this.askModel(
      mission,
      item,
      context,
      `You are an implementer. Before editing, align with the mission’s agreed end-state and chosen approach (from task prompt, blueprint context, or mission memory). If the task is non-trivial and no approach is recorded, state two options, pick one with a one-line rationale, then implement. Use tools when necessary. Prefer applyPatch for targeted edits, writeFile for new files, readFile before changing unfamiliar files, and optionally runTerminal for bounded validation. If the task is already fully satisfied in the workspace (prior run, manual fix, or no change needed), output exactly one line: ALREADY_SATISFIED: brief reason — and do not emit any TOOL lines.${extra}`,
      options?.signal,
      options?.onChunk
    );

    const parsed = parseAgentOutput(text);
    return {
      summary: text,
      toolCalls: parsed.toolCalls,
      nextWorkItems: parsed.workItems,
      markStatus: "done",
      newMemory: [...normalizeParsedMemoryItemsForStorage(parsed.memoryItems), { kind: "decision", text, tags: ["implementation"] }]
    };
  }
}
