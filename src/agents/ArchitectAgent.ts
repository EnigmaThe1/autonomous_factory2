import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";
import { normalizeParsedMemoryItemsForStorage } from "../missions/claimTrust";
import { ARCHITECTURE_DISCIPLINE_FRAGMENT, CODING_STANDARDS_FRAGMENT } from "./instructionFragments";

/** System-level gap review: emits WORK: follow-ups only; no file edits. */
export class ArchitectAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const bp = mission.blueprint;
    const bpHint = bp
      ? `Approved blueprint has ${bp.steps.length} steps. Requirements summary: ${bp.requirementsSummary.slice(0, 1200)}`
      : "No blueprint on mission.";
    const instructions = [
      "You are the system architect. Review mission progress against goals and blueprint (if any).",
      "Do not propose file edits or TOOL lines. Only emit WORK:ROLE:TITLE - PROMPT lines for missing work, or a single line NO_GAP: brief reason if nothing material is missing.",
      CODING_STANDARDS_FRAGMENT,
      ARCHITECTURE_DISCIPLINE_FRAGMENT,
      bpHint
    ].join("\n\n");

    const text = await this.askModel(mission, item, context, instructions, options?.signal, options?.onChunk);
    const parsed = parseAgentOutput(text);
    const nextWorkItems = parsed.workItems;
    const noGap = /^\s*NO_GAP\s*:/im.test(text) && nextWorkItems.length === 0;

    return {
      summary: text || "Architect pass.",
      nextWorkItems: noGap ? [] : nextWorkItems,
      markStatus: "done",
      newMemory: [
        ...normalizeParsedMemoryItemsForStorage(parsed.memoryItems),
        { kind: "summary", text: text || "Architect review.", tags: ["architect"] }
      ]
    };
  }
}
