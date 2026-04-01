import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";
import { uid } from "../util";

export class PlannerAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const text = await this.askModel(
      mission,
      item,
      context,
      "You are the planner. Break the mission into bounded work items. Prefer researcher -> implementer -> reviewer -> validator. Emit WORK:ROLE:TITLE - PROMPT lines. For larger missions, create multiple implementer/reviewer pairs rather than one huge task.",
      options?.signal,
      options?.onChunk
    );

    const parsed = parseAgentOutput(text);
    const nextWorkItems: WorkItem[] = parsed.workItems.length > 0
      ? parsed.workItems
      : [
          { id: uid("work"), title: "Workspace research", role: "researcher", status: "todo", prompt: "Inspect the workspace and summarize architecture, key files, and likely gaps." },
          { id: uid("work"), title: "Initial implementation", role: "implementer", status: "todo", prompt: "Implement one bounded high-value improvement based on current findings." },
          { id: uid("work"), title: "Initial review", role: "reviewer", status: "todo", prompt: "Review the implementation and identify defects or missing validation." },
          { id: uid("work"), title: "Validation pass", role: "validator", status: "todo", prompt: "Validate mission state and create follow-up work if needed." }
        ];

    return {
      summary: text || "Planner ran.",
      nextWorkItems,
      markStatus: "done",
      newMemory: [{ kind: "summary", text: text || "Planner produced default work items.", tags: ["plan"] }]
    };
  }
}
