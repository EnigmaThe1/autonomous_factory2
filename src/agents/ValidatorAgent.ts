import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { parseValidatorModelOutput } from "./validatorOutputParse";

export class ValidatorAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const text = await this.askModel(
      mission,
      item,
      context,
      "You are a validator. Decide if the mission is complete, blocked, or needs more work. Consider whether outcomes match the mission’s stated end-state and chosen approach. If the mission appears complete, emit a single line COMPLETE: and do not emit WORK: lines in the same response. If blocked, say BLOCKER:. If more work is required (and not complete), emit WORK:ROLE:TITLE - PROMPT lines without COMPLETE:.",
      options?.signal,
      options?.onChunk
    );

    const parsed = parseValidatorModelOutput(text);
    const { toolCalls, blocked, complete } = parsed;
    let { nextWorkItems } = parsed;
    // COMPLETE: must win over incidental WORK: parses (models often mix narrative with structured lines).
    if (complete && !blocked) {
      nextWorkItems = [];
    }

    return {
      summary: text,
      toolCalls,
      nextWorkItems,
      markStatus: blocked ? "blocked" : "done",
      decision: blocked ? "blocked" : complete ? "complete" : "needs_followup",
      newMemory: [{ kind: "summary", text, tags: ["validation"] }]
    };
  }
}
