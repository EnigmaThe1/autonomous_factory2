import * as vscode from "vscode";
import { BaseAgent } from "./BaseAgent";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { parseAgentOutput } from "./agentOutputParser";
import { parseRole, uid } from "../util";
import { ARCHITECTURE_DISCIPLINE_FRAGMENT, CODING_STANDARDS_FRAGMENT } from "./instructionFragments";

const PRE_BLUEPRINT_JSON_INSTRUCTIONS = [
  "You are clarifying an upcoming mission before a full blueprint is written.",
  "Output ONE JSON object only (optionally wrapped in ```json code fence). No WORK: lines.",
  'Schema: { "questions": string[] }',
  "Ask 1–8 concise questions the operator should answer so the later blueprint does not guess unstated constraints (stack, scope boundaries, environments, deadlines, quality bar, out-of-scope).",
  "Each question must be a single non-empty string, under 400 characters, no numbering inside the string (the UI will number them).",
  CODING_STANDARDS_FRAGMENT,
  ARCHITECTURE_DISCIPLINE_FRAGMENT
].join("\n");

const BLUEPRINT_JSON_INSTRUCTIONS = [
  "You are the mission architect. Output ONE JSON object only (optionally wrapped in ```json code fence). No WORK: lines.",
  "Infer implicit requirements from the mission goal (capabilities, constraints, quality).",
  "JSON schema:",
  '{ "requirementsSummary": string, "architectureSummary": string, "steps": [',
  '  { "id": string, "title": string, "summary": string, "roleHint": "researcher"|"implementer"|"reviewer"|"validator"|"planner"|"architect",',
  '    "dependsOn"?: string[], "acceptanceCriteria": string[], "optional"?: boolean }',
  "] }",
  "Use stable ids (e.g. step_1). Include dependencies so steps form a DAG. At least one step.",
  "roleHint should match the primary work type for that step (most build work → implementer, discovery → researcher).",
  CODING_STANDARDS_FRAGMENT,
  ARCHITECTURE_DISCIPLINE_FRAGMENT
].join("\n");

export class PlannerAgent extends BaseAgent {
  async run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult> {
    const enforce = vscode.workspace.getConfiguration().get<boolean>("myAi.agents.enforceDefaultCodingStandards", true);
    const frag = enforce ? `\n\n${CODING_STANDARDS_FRAGMENT}\n${ARCHITECTURE_DISCIPLINE_FRAGMENT}` : "";

    if (item.workItemPurpose === "pre_blueprint_clarify") {
      const text = await this.askModel(
        mission,
        item,
        context,
        PRE_BLUEPRINT_JSON_INSTRUCTIONS,
        options?.signal,
        options?.onChunk
      );
      return {
        summary: text || "{}",
        nextWorkItems: [],
        markStatus: "done",
        newMemory: [{ kind: "summary", text: text || "Pre-blueprint questions", tags: ["plan", "pre_blueprint"] }]
      };
    }

    if (item.workItemPurpose === "blueprint_generate" || item.workItemPurpose === "blueprint_revise") {
      const text = await this.askModel(
        mission,
        item,
        context,
        BLUEPRINT_JSON_INSTRUCTIONS,
        options?.signal,
        options?.onChunk
      );
      return {
        summary: text || "{}",
        nextWorkItems: [],
        markStatus: "done",
        newMemory: [{ kind: "summary", text: text || "Blueprint draft", tags: ["plan", "blueprint"] }]
      };
    }

    const instructions = [
      "You are the planner. Break the mission into bounded work items.",
      "Prefer researcher -> implementer -> reviewer -> validator.",
      "Emit WORK:ROLE:TITLE - PROMPT lines.",
      "For larger missions, create multiple implementer/reviewer pairs rather than one huge task.",
      "For very complex tasks, use DECOMPOSE:ROLE:Title - Prompt [depends:id1,id2] to create sub-item DAGs.",
      "Each decomposed sub-item gets its own planner/implementer/reviewer/validator cycle.",
      frag
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
            dependsOn: d.dependsOn?.map((dep) => idMap.get(dep) || dep)
          });
        }

        nextWorkItems.push({
          id: parentId,
          title: `Decomposed: ${item.title}`,
          role: "planner",
          status: "todo",
          prompt: `Parent container for ${subItems.length} decomposed sub-items.`,
          subItems
        });
      }
    } else {
      nextWorkItems = [
        {
          id: uid("work"),
          title: "Workspace research",
          role: "researcher",
          status: "todo",
          prompt: "Inspect the workspace and summarize architecture, key files, and likely gaps."
        },
        {
          id: uid("work"),
          title: "Initial implementation",
          role: "implementer",
          status: "todo",
          prompt: "Implement one bounded high-value improvement based on current findings."
        },
        {
          id: uid("work"),
          title: "Initial review",
          role: "reviewer",
          status: "todo",
          prompt: "Review the implementation and identify defects or missing validation."
        },
        {
          id: uid("work"),
          title: "Validation pass",
          role: "validator",
          status: "todo",
          prompt: "Validate mission state and create follow-up work if needed."
        }
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
