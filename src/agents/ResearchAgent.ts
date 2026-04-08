import * as vscode from "vscode";
import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";
import { normalizeParsedMemoryItemsForStorage } from "../missions/claimTrust";

export class ResearchAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const webOn = vscode.workspace.getConfiguration().get<boolean>("myAi.webResearch.enabled", false);
    const webHint = webOn
      ? " When external facts matter (APIs, versions, best practices), use webSearch and fetchWebPage within policy; still favor workspace tools first when the answer is in the repo. Reuse existing mission MEMORY tagged research_evidence for the same question instead of repeating identical web queries."
      : "";
    const text = await this.askModel(
      mission,
      item,
      context,
      `You are a researcher. Ground the mission goal: clarify the desired end-state, constraints, and evidence from the repo. When the task involves design or multiple ways forward, outline at least two viable approaches and tradeoffs before recommending one — do not jump to a single implementation path without comparison. Summarize findings and propose up to three tool calls as TOOL JSON lines. Favor listFiles, searchFiles, readFile, and getDiagnostics.${webHint}`,
      options?.signal,
      options?.onChunk
    );

    const parsed = parseAgentOutput(text);
    const newMemory: AgentTurnResult["newMemory"] = [
      ...normalizeParsedMemoryItemsForStorage(parsed.memoryItems),
      { kind: "finding" as const, text, tags: ["research"] }
    ];

    return { summary: text, toolCalls: parsed.toolCalls, markStatus: "done", newMemory };
  }
}
