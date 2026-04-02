import * as vscode from "vscode";
import { EmbeddingMemoryIndex } from "../memory/EmbeddingMemoryIndex";
import { ContextCollector } from "../context/ContextCollector";
import { AgentRunOptions, AgentTurnResult, ChatContext, Mission, WorkItem } from "../types";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { trimText } from "../util";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import { loadWorkspaceSkillsForAgents } from "../skills/workspaceSkillsLoader";

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
      "You may emit machine-readable lines only when needed:",
      'TOOL:{"tool":"readFile","args":{"path":"..."}}',
      'TOOL:{"tool":"runCommand","args":{"command":"...","cwd":"..."}} — runs a shell command and returns stdout/stderr/exitCode',
      'TOOL:{"tool":"findRelevantFiles","args":{"query":"describe what you are looking for"}} — semantic search across indexed workspace files',
      'TOOL:{"tool":"grepSearch","args":{"pattern":"regex_pattern","glob":"**/*.ts"}} — fast regex search across all files via ripgrep',
      'TOOL:{"tool":"searchFiles","args":{"glob":"**/*.ts","query":"searchTerm"}} — substring search across files',
      'TOOL:{"tool":"listFiles","args":{"glob":"src/**/*"}}',
      'TOOL:{"tool":"fileTree","args":{"maxDepth":3}} — returns workspace directory tree',
      'TOOL:{"tool":"getDiagnostics","args":{}} — returns workspace-wide linter/compiler diagnostics',
      'TOOL:{"tool":"runTests","args":{}} — runs test suite and returns structured pass/fail results',
      'TOOL:{"tool":"runLinter","args":{}} — runs linter and returns error/warning counts with details',
      'TOOL:{"tool":"git.status","args":{}} — shows branch and changed files',
      'TOOL:{"tool":"git.diff","args":{"staged":false,"path":"..."}} — shows file diffs',
      'TOOL:{"tool":"git.log","args":{"count":10}} — recent commit history',
      'TOOL:{"tool":"git.blame","args":{"path":"...","startLine":1,"endLine":20}}',
      'TOOL:{"tool":"git.stash_push","args":{"message":"..."}} — save current changes (requires approval)',
      'TOOL:{"tool":"git.stash_pop","args":{}} — restore stashed changes (requires approval)',
      'TOOL:{"tool":"git.commit","args":{"message":"...","paths":["..."]}} — commit changes (requires approval)',
      'TOOL:{"tool":"httpRequest","args":{"method":"GET","url":"http://...","headers":{},"body":""}} — HTTP request (requires approval)',
      'TOOL:{"tool":"webSearch","args":{"query":"keywords for documentation or facts"}} — instant-answer search (off unless myAi.webResearch.enabled; requires approval if HTTP approval on)',
      'TOOL:{"tool":"fetchWebPage","args":{"url":"https://..."}} — GET public page text (off unless myAi.webResearch.enabled; requires approval if HTTP approval on)',
      'TOOL:{"tool":"browserCapture","args":{"url":"https://..."}} — run your configured screenshot/CLI (myAi.browser.enabled + captureCommand with {url} and {outPath}); uses run_command policy',
      'TOOL:{"tool":"docker.ps","args":{}} — list running containers',
      'TOOL:{"tool":"docker.logs","args":{"container":"name","tail":100}} — container logs',
      'TOOL:{"tool":"docker.exec","args":{"container":"name","command":"..."}} — exec in container (requires approval)',
      'TOOL:{"tool":"docker.compose_status","args":{}} — docker compose service status',
      'TOOL:{"tool":"db.query","args":{"engine":"postgres","connectionString":"...","query":"SELECT ..."}} — run SQL query (requires approval)',
      'TOOL:{"tool":"db.schema","args":{"engine":"postgres","connectionString":"..."}} — dump database schema',
      'TOOL:{"tool":"listTools","args":{}}',
      'TOOL:{"tool":"ext.adapter_name","args":{"...":"..."}}',
      'TOOL:{"tool":"mcp.server_name.tool_name","args":{"...":"..."}}',
      "WORK:ROLE:TITLE - PROMPT",
      "MEMORY:kind:tag1,tag2 - text",
      "Prefer runCommand over runTerminal when you need to see command output (build results, test output, git status, etc.).",
      "SELF-CORRECTION PROTOCOL:",
      "1. After writing or patching code, ALWAYS run getDiagnostics or runLinter to check for errors you introduced.",
      "2. If diagnostics show errors, fix them immediately before marking the task done.",
      "3. After fixing code, run runTests to verify you haven't broken existing functionality.",
      "4. If a tool call fails, read the error carefully and try a different approach — do not repeat the exact same call.",
      "5. When working on large changes, use git.diff to review your changes before concluding.",
      "6. If you encounter an import/module error, use grepSearch to find the correct export path.",
      "Use COMPLETE: only when the mission is genuinely complete. Use BLOCKER: only for a real blocker."
    ]
      .filter(Boolean)
      .join("\n\n");

    const skillsBlock = await loadWorkspaceSkillsForAgents();
    const systemPrompt =
      skillsBlock.trim().length > 0
        ? `${instructions}\n\n--- WORKSPACE SKILLS (markdown from repository; apply when relevant) ---\n${skillsBlock}`
        : instructions;

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
