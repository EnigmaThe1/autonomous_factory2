import * as vscode from "vscode";
import { EmbeddingMemoryIndex } from "../memory/EmbeddingMemoryIndex";
import { ContextCollector } from "../context/ContextCollector";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { trimText } from "../util";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";

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

    const prompt = [
      `MISSION: ${mission.title}`,
      `MISSION PROMPT: ${mission.prompt}`,
      `ROLE: ${item.role}`,
      `TASK: ${item.title}`,
      `TASK PROMPT: ${item.prompt}`,
      mission.policy.closureRequired
        ? "CLOSURE REQUIRED: do not assume first-tranche completion. Continue until validation passes or a real blocker exists."
        : "",
      recalled.length
        ? `MISSION MEMORY:\n${recalled.map((m) => `- [${m.kind}] ${trimText(m.text, 500)}`).join("\n")}`
        : "",
      globalRecalled.length
        ? `GLOBAL MEMORY:\n${globalRecalled.map((m) => `- [${m.kind}] ${trimText(m.text, 350)}`).join("\n")}`
        : "",
      "You may emit machine-readable lines only when needed:",
      'TOOL:{"tool":"readFile","args":{"path":"..."}}',
      'TOOL:{"tool":"listTools","args":{}}',
      'TOOL:{"tool":"ext.adapter_name","args":{"...":"..."}}',
      'TOOL:{"tool":"mcp.server_name.tool_name","args":{"...":"..."}}',
      "WORK:ROLE:TITLE - PROMPT",
      "MEMORY:kind:tag1,tag2 - text",
      "Use COMPLETE: only when the mission is genuinely complete. Use BLOCKER: only for a real blocker."
    ]
      .filter(Boolean)
      .join("\n\n");

    let out = "";
    for await (const chunk of provider.stream({
      prompt,
      model: item.model || (mission.routing?.modelPerRole?.[item.role]?.trim() || undefined) || mission.activeModel,
      context,
      system: instructions,
      signal
    })) {
      out += chunk;
      onChunk?.(chunk);
    }
    return out.trim();
  }
}
