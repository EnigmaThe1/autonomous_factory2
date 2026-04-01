import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";
import { parseRole, uid } from "../util";

export class PlannerAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const instructions = [
      "You are the planner. Break the mission into bounded work items.",
      "Prefer researcher -> implementer -> reviewer -> validator.",
      "Emit WORK:ROLE:TITLE - PROMPT lines.",
      "For larger missions, create multiple implementer/reviewer pairs rather than one huge task.",
      "For very complex tasks, use DECOMPOSE:ROLE:Title - Prompt [depends:id1,id2] to create sub-item DAGs.",
      "Each decomposed sub-item gets its own planner/implementer/reviewer/validator cycle."
    ].join(" ");

    const text = await this.askModel(mission, item, context, instructions, options?.signal, options?.onChunk);

    const parsed = parseAgentOutput(text);

    let nextWorkItems: WorkItem[];
    if (parsed.workItems.length > 0 || parsed.decompositions.length > 0) {
      nextWorkItems = [...parsed.workItems];

      if (parsed.decompositions.length > 0) {
        const parentId = uid("decomp-parent");
        const subItems: WorkItem[] = [];
        const idMap = new Map<string, string>();

        for (const d of parsed.decompositions) {
          const subId = uid("sub");
          idMap.set(d.title, subId);
          subItems.push({
            id: subId,
            title: d.title,
            role: parseRole(d.role),
            status: "todo",
            prompt: d.prompt,
            parentWorkItemId: parentId,
            dependsOn: d.dependsOn?.map((dep) => idMap.get(dep) || dep),
          });
        }

        nextWorkItems.push({
          id: parentId,
          title: `Decomposed: ${item.title}`,
          role: "planner",
          status: "todo",
          prompt: `Parent container for ${subItems.length} decomposed sub-items.`,
          subItems,
        });
      }
    } else {
      nextWorkItems = [
        { id: uid("work"), title: "Workspace research", role: "researcher", status: "todo", prompt: "Inspect the workspace and summarize architecture, key files, and likely gaps." },
        { id: uid("work"), title: "Initial implementation", role: "implementer", status: "todo", prompt: "Implement one bounded high-value improvement based on current findings." },
        { id: uid("work"), title: "Initial review", role: "reviewer", status: "todo", prompt: "Review the implementation and identify defects or missing validation." },
        { id: uid("work"), title: "Validation pass", role: "validator", status: "todo", prompt: "Validate mission state and create follow-up work if needed." }
      ];
    }

    return {
      summary: text || "Planner ran.",
      nextWorkItems,
      markStatus: "done",
      newMemory: [{ kind: "summary", text: text || "Planner produced default work items.", tags: ["plan"] }]
    };
  }
}
