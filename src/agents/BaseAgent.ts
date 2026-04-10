import * as vscode from "vscode";
import { EmbeddingMemoryIndex } from "../memory/EmbeddingMemoryIndex";
import { ContextCollector } from "../context/ContextCollector";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { trimText } from "../util";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import { loadWorkspaceSkillsForAgents } from "../skills/workspaceSkillsLoader";
import { getAgentToolInstructionLines } from "./toolPromptCatalog";
import { CLAIM_STATUS_INSTRUCTIONS } from "../missions/claimTrust";
import { EXTENSION_MISSION_DISCIPLINE_RULES, EXTENSION_TOOL_HARD_RULES_MISSION } from "./extensionToolHardRules";
import { GOAL_FIRST_DISCIPLINE_SYSTEM } from "./goalFirstDiscipline";
import { AI_NATIVE_OVERLAY_SYSTEM } from "./aiNativeOverlay";

export abstract class BaseAgent {
  constructor(
    protected readonly providers: ProviderRegistry,
    protected readonly globalMemory: GlobalMemoryStore,
    protected readonly collector?: ContextCollector,
    protected readonly memoryIndex: EmbeddingMemoryIndex = new EmbeddingMemoryIndex()
  ) {}

  abstract run(mission: Mission, item: WorkItem, context: ChatContext, options?: AgentRunOptions): Promise<AgentTurnResult>;

  protected async askModel(
    mission: Mission,
    item: WorkItem,
    context: ChatContext,
    instructions: string,
    signal?: AbortSignal,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const cfg = vscode.workspace.getConfiguration();
    const globalPid = cfg.get<string>("myAi.defaultProvider", "ollama");
    const rolePid = mission.routing?.providerPerRole?.[item.role]?.trim();
    const providerId = item.providerId || (rolePid || undefined) || mission.activeProviderId || globalPid;
    const provider = this.providers.get(providerId);
    const queryText = `${mission.prompt}\n${item.prompt}`;

    const recallLimit = vscode.workspace.getConfiguration().get<number>("myAi.memory.semanticRecallLimit", 8);
    const recalled = this.memoryIndex.query(mission.memory, queryText, recallLimit);

    const globalRecallLimit = vscode.workspace.getConfiguration().get<number>("myAi.memory.globalRecallLimit", 6);
    const globalRecalled = this.memoryIndex
      .query(this.globalMemory.list(), queryText, globalRecallLimit)
      .filter((m) => m.sourceMissionId !== mission.id);

    const maxPromptChars = cfg.get<number>("myAi.agents.maxPromptChars", 60000);
    const trimmedSections: string[] = [];

    const coreSections = [
      `MISSION: ${mission.title}`,
      `MISSION PROMPT: ${mission.prompt}`,
      `ROLE: ${item.role}`,
      `TASK: ${item.title}`,
      `TASK PROMPT: ${item.prompt}`,
      item.retryCount
        ? `RETRY ATTEMPT: ${item.retryCount}. A previous attempt failed. Analyze the error below and try a DIFFERENT approach.`
        : "",
      item.previousError
        ? `PREVIOUS ERROR:\n${item.previousError}`
        : "",
      mission.policy.closureRequired
        ? "CLOSURE REQUIRED: do not assume first-tranche completion. Continue until validation passes or a real blocker exists."
        : "",
      vscode.workspace.getConfiguration().get<boolean>("myAi.missions.claimDiscipline", true) ? CLAIM_STATUS_INSTRUCTIONS : "",
    ];

    // Budget-aware optional sections — ordered by trim priority (last trimmed first)
    const optionalSections: Array<{ label: string; content: string; priority: number }> = [];

    if (recalled.length) {
      optionalSections.push({ label: "MISSION MEMORY", content: `MISSION MEMORY:\n${recalled.map((m) => `- [${m.kind}] ${trimText(m.text, 500)}`).join("\n")}`, priority: 3 });
    }
    if (globalRecalled.length) {
      optionalSections.push({ label: "GLOBAL MEMORY", content: `GLOBAL MEMORY:\n${globalRecalled.map((m) => `- [${m.kind}] ${trimText(m.text, 350)}`).join("\n")}`, priority: 2 });
    }
    if (context.projectOverview) {
      optionalSections.push({ label: "PROJECT OVERVIEW", content: `PROJECT OVERVIEW:\n${trimText(context.projectOverview, 3000)}`, priority: 1 });
    }
    if (context.gitStatus) {
      optionalSections.push({ label: "GIT STATUS", content: `GIT STATUS:\n${context.gitStatus}`, priority: 4 });
    }
    if (context.allDiagnosticsSummary) {
      optionalSections.push({ label: "WORKSPACE DIAGNOSTICS", content: `WORKSPACE DIAGNOSTICS:\n${trimText(context.allDiagnosticsSummary, 2000)}`, priority: 5 });
    }
    if (context.relevantFileSnippets?.length) {
      optionalSections.push({ label: "RELEVANT FILES", content: `RELEVANT FILES:\n${context.relevantFileSnippets.map((s) => `--- ${s.file} ---\n${s.snippet}`).join("\n\n")}`, priority: 1 });
    }

    optionalSections.sort((a, b) => b.priority - a.priority);

    let totalChars = coreSections.filter(Boolean).join("\n\n").length;
    const includedOptional: string[] = [];

    for (const section of optionalSections) {
      if (totalChars + section.content.length > maxPromptChars * 0.8) {
        trimmedSections.push(section.label);
        continue;
      }
      includedOptional.push(section.content);
      totalChars += section.content.length;
    }

    const prompt = [
      ...coreSections,
      ...includedOptional,
      trimmedSections.length ? `[Budget: trimmed ${trimmedSections.join(", ")} to fit context window]` : "",
      ...getAgentToolInstructionLines()
    ]
      .filter(Boolean)
      .join("\n\n");

    const skillsBlock = await loadWorkspaceSkillsForAgents();
    const goalFirstOn = cfg.get<boolean>("myAi.agents.goalFirstDiscipline", true);
    const systemPrompt = [
      instructions,
      EXTENSION_TOOL_HARD_RULES_MISSION,
      EXTENSION_MISSION_DISCIPLINE_RULES,
      AI_NATIVE_OVERLAY_SYSTEM,
      goalFirstOn ? GOAL_FIRST_DISCIPLINE_SYSTEM : "",
      skillsBlock.trim().length > 0
        ? `--- WORKSPACE SKILLS (markdown from repository; apply when relevant) ---\n${skillsBlock}`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    let out = "";
    for await (const chunk of provider.stream({
      prompt,
      model: item.model || (mission.routing?.modelPerRole?.[item.role]?.trim() || undefined) || mission.activeModel,
      context,
      system: systemPrompt,
      signal
    })) {
      out += chunk;
      onChunk?.(chunk);
    }
    return out.trim();
  }
}
