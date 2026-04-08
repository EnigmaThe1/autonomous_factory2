import * as vscode from "vscode";
import * as path from "path";
import { MissionStore } from "../missions/MissionStore";
import { ToolApproval, ToolCall } from "../types";
import { trimText, uid } from "../util";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { ExternalToolAdapterRegistry } from "./ExternalToolAdapterRegistry";
import { McpRegistry } from "./McpRegistry";
import { TrustPolicyEngine } from "../security/TrustPolicyEngine";
import { redactSensitiveObject } from "../security/SecretRedaction";
import { isApplyPatchNoopBecauseReplaceAlreadyPresent } from "./applyPatchNoOpPolicy";
import { runCommand } from "./CommandRunner";
import { ripgrepSearch, fileTree } from "./RipgrepSearch";
import * as gitTools from "./GitToolProvider";
import { runTests, runLinter } from "./TestRunner";
import { httpRequest } from "./HttpClient";
import * as dockerTools from "./DockerTools";
import type { WorkspaceIndex } from "../memory/WorkspaceIndex";
import type { MissionFileTracker } from "../missions/MissionFileTracker";
import { withRetry } from "./toolRetry";
import { suggestWorkspacePathsForMissingFile } from "./pathResolveSuggestions";
import {
  validateCommand,
  validateContainerName,
  validateDbEngine,
  validateSearchQuery,
  validateSqlQuery,
  validateUrl,
  validateFilePath
} from "./inputValidation";
import { runFetchWebPage, runWebSearch, type WebSearchProviderId } from "./WebResearchTools";
import { buildBrowserCaptureCommand } from "./BrowserCapture";
import { SecretStore } from "../storage/SecretStore";
import { BRAVE_WEB_SEARCH_SECRET_KEY } from "../providers/providerCredentialKeys";
import { BUILTIN_TOOL_NAMES } from "./builtinToolNames";
import { buildListToolsHintEntries } from "./listToolsCatalog";
import { evaluateTrustActionGate } from "../missions/trustActionGate";
import { compactMcpToolDescriptors } from "./mcpToolsListCompact";
import { toExternalAdapterPublicSummaries } from "./externalAdapterListSanitize";
import { classifyScopeDriftForPath } from "../missions/scopeDriftPolicy";
import {
  effectiveWebResearchMaxCallsPerMission,
  effectiveWebSearchMinIntervalMs
} from "../missions/webResearchBudgetPolicy";
import { enqueueWebResearchConsolidationIfAbsent } from "../missions/webResearchConsolidationEnqueue";

function buildDiffHunks(beforeText: string, afterText: string) {
  const before = beforeText.split(/\r?\n/);
  const after = afterText.split(/\r?\n/);
  const hunks: Array<{ header: string; beforeStart: number; beforeEnd: number; afterStart: number; afterEnd: number; beforeLines: string[]; afterLines: string[] }> = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (before[i] === after[j]) { i += 1; j += 1; continue; }
    const bs = i;
    const as = j;
    const beforeLines: string[] = [];
    const afterLines: string[] = [];
    let guard = 0;
    while ((i < before.length || j < after.length) && guard < 40) {
      if (before[i] === after[j] && beforeLines.length && afterLines.length) break;
      if (i < before.length) beforeLines.push(before[i++]);
      if (j < after.length) afterLines.push(after[j++]);
      guard += 1;
    }
    hunks.push({
      header: `@@ -${bs + 1},${Math.max(1, beforeLines.length)} +${as + 1},${Math.max(1, afterLines.length)} @@`,
      beforeStart: bs + 1,
      beforeEnd: i,
      afterStart: as + 1,
      afterEnd: j,
      beforeLines,
      afterLines
    });
  }
  return hunks.slice(0, 12);
}

function renderHunkSummary(hunks: ReturnType<typeof buildDiffHunks>): string {
  if (!hunks.length) return 'No line-level changes detected.';
  return hunks.map((h) => [h.header, ...h.beforeLines.map((l) => `- ${l}`), ...h.afterLines.map((l) => `+ ${l}`)].join('\n')).join('\n\n');
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  requiresApproval?: ToolApproval;
  blockedByPolicy?: boolean;
  /** applyPatch returned ok without writing (deterministic replace-already-present no-op). */
  applyPatchNoop?: boolean;
}

export { BUILTIN_TOOL_NAMES } from "./builtinToolNames";

export class ToolRegistry {
  private cachedPolicyEngine?: TrustPolicyEngine;
  workspaceIndex?: WorkspaceIndex;
  fileTracker?: MissionFileTracker;
  /** Last successful webSearch HTTP dispatch (for minIntervalMs cooldown). */
  private webSearchLastAtMs = 0;
  private readonly webResearchCache = new Map<string, { ts: number; result: ToolResult }>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly missionStore: MissionStore,
    private readonly disk: DiskMissionPersistence,
    private readonly externalAdapters: ExternalToolAdapterRegistry,
    private readonly mcp: McpRegistry,
    private readonly secrets: SecretStore
  ) {}

  private policyEngine(): TrustPolicyEngine {
    if (!this.cachedPolicyEngine) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const cfg = vscode.workspace.getConfiguration();
      this.cachedPolicyEngine = new TrustPolicyEngine(workspaceRoot, {
        allowTerminal: cfg.get<boolean>("myAi.tools.allowTerminal", false),
        requireApprovalForWrite: cfg.get<boolean>("myAi.tools.requireApprovalForWrite", true),
        requireApprovalForInWorkspaceWrites: cfg.get<boolean>("myAi.tools.requireApprovalForInWorkspaceWrites", true),
        requireApprovalForTerminal: cfg.get<boolean>("myAi.tools.requireApprovalForTerminal", true),
        requireApprovalForHttp: cfg.get<boolean>("myAi.tools.requireApprovalForHttp", true),
        requireApprovalForMcp: cfg.get<boolean>("myAi.tools.requireApprovalForMcp", true),
        requireApprovalForExternal: cfg.get<boolean>("myAi.tools.requireApprovalForExternal", true),
        restrictToWorkspace: cfg.get<boolean>("myAi.tools.restrictToWorkspace", true)
      });
    }
    return this.cachedPolicyEngine;
  }

  /** Invalidate cached policy engine so next call re-reads configuration. */
  invalidatePolicyCache(): void {
    this.cachedPolicyEngine = undefined;
  }

  private policyBlocked(reason: string): ToolResult {
    return { ok: false, summary: reason, blockedByPolicy: true };
  }

  private resolveWorkspacePath(inputPath: string): string {
    if (path.isAbsolute(inputPath)) return inputPath;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.join(root, inputPath) : path.resolve(inputPath);
  }

  private getAttributedWorkItem(
    missionId: string,
    call: ToolCall
  ): { mission: import("../types").Mission; item: import("../types").WorkItem } | undefined {
    const m = this.missionStore.get(missionId);
    if (!m) return undefined;
    const idRaw = (call.args as Record<string, unknown> | undefined)?.__workItemId;
    const id = typeof idRaw === "string" ? idRaw : "";
    if (!id) return undefined;
    const item = m.queue.find((w) => w.id === id);
    if (!item) return undefined;
    return { mission: m, item };
  }

  private async requireApprovalForNonImplementerMutation(
    missionId: string,
    call: ToolCall,
    approved: boolean,
    title: string,
    details: string
  ): Promise<ToolResult | undefined> {
    const attributed = this.getAttributedWorkItem(missionId, call);
    if (!attributed) return undefined;
    if (attributed.item.role === "implementer") return undefined;
    if (approved) {
      await this.missionStore.saveEvent(missionId, {
        level: "warn",
        source: "scope",
        message: `Approved non-implementer mutation executed: ${call.tool} (role=${attributed.item.role})`,
        data: { tool: call.tool, role: attributed.item.role, workItemId: attributed.item.id }
      });
      return undefined;
    }
    await this.missionStore.saveEvent(missionId, {
      level: "warn",
      source: "scope",
      message: `Non-implementer mutation requires explicit approval: ${call.tool} (role=${attributed.item.role})`,
      telemetryKind: "approval_requested",
      data: { tool: call.tool, role: attributed.item.role, workItemId: attributed.item.id }
    });
    return {
      ok: false,
      summary: `Approval required before ${call.tool} (non-implementer mutation)`,
      requiresApproval: {
        kind: "terminal",
        title,
        details: trimText(details, 1600)
      }
    };
  }

  private readonly builtinDispatch: Record<string, (missionId: string, call: ToolCall) => Promise<ToolResult>> = {
    readFile: (mid, c) => this.readFile(mid, String(c.args.path || "")),
    writeFile: (mid, c) => this.writeFile(mid, c),
    applyPatch: (mid, c) => this.applyPatch(mid, c),
    searchFiles: (mid, c) => this.searchFiles(mid, String(c.args.glob || "**/*"), String(c.args.query || "")),
    listFiles: (mid, c) => this.listFiles(mid, String(c.args.glob || "**/*")),
    getDiagnostics: (mid) => this.getDiagnostics(mid),
    listTools: (mid) => this.listTools(mid),
    listMcpTools: (mid) => this.listMcpTools(mid),
    grepSearch: (mid, c) => this.grepSearch(mid, String(c.args.pattern || ""), c.args.glob ? String(c.args.glob) : undefined, c.args.maxResults ? Number(c.args.maxResults) : undefined),
    fileTree: (mid, c) => this.fileTreeTool(mid, c.args.maxDepth ? Number(c.args.maxDepth) : undefined),
    runTests: (mid, c) => this.runTestsTool(mid, c.args.command ? String(c.args.command) : undefined),
    runLinter: (mid, c) => this.runLinterTool(mid, c.args.command ? String(c.args.command) : undefined),
    httpRequest: (mid, c) => this.httpRequestTool(mid, String(c.args.method || "GET"), String(c.args.url || ""), c.args.headers as Record<string, string> | undefined, c.args.body ? String(c.args.body) : undefined, Boolean(c.args.__approved)),
    webSearch: (mid, c) => this.webSearchTool(mid, String(c.args.query || ""), Boolean(c.args.__approved), c),
    fetchWebPage: (mid, c) => this.fetchWebPageTool(mid, String(c.args.url || ""), Boolean(c.args.__approved), c),
    browserCapture: (mid, c) => this.browserCaptureTool(mid, String(c.args.url || ""), Boolean(c.args.__approved)),
    findRelevantFiles: (mid, c) => this.findRelevantFilesTool(mid, String(c.args.query || "")),
    runTerminal: (mid, c) => this.runTerminal(mid, String(c.args.command || ""), Boolean(c.args.__approved), c),
    runCommand: (mid, c) => this.runCommandTool(
      mid,
      String(c.args.command || ""),
      c.args.cwd ? String(c.args.cwd) : undefined,
      c.args.timeoutMs ? Number(c.args.timeoutMs) : undefined,
      Boolean(c.args.__approved),
      c
    )
  };

  private hasWorkItemAttribution(call: ToolCall): boolean {
    const id = (call.args as Record<string, unknown> | undefined)?.__workItemId;
    return typeof id === "string" && id.trim().length > 0;
  }

  /** Caps searchFiles / grepSearch match budget (workspace setting + optional agent request). */
  private effectiveSearchFilesMaxResults(agentRequested?: number): number {
    const cap = vscode.workspace.getConfiguration().get<number>("myAi.tools.searchFilesMaxResults", 50);
    const configured = Math.min(200, Math.max(5, Math.floor(Number.isFinite(cap) ? cap : 50)));
    if (agentRequested === undefined || !Number.isFinite(agentRequested)) return configured;
    return Math.min(configured, Math.max(1, Math.floor(agentRequested)));
  }

  private isPotentiallyMutatingToolCall(call: ToolCall): boolean {
    const t = call.tool;
    if (t.startsWith("mcp.")) return true;
    if (t.startsWith("ext.")) return true;
    if (t.startsWith("git.")) return ToolRegistry.GIT_MUTATING.has(t);
    if (t.startsWith("docker.") || t.startsWith("db.")) return ToolRegistry.INFRA_MUTATING.has(t);
    // Builtins
    return new Set(["writeFile", "applyPatch", "runTerminal", "runCommand"]).has(t);
  }

  async execute(missionId: string, call: ToolCall): Promise<ToolResult> {
    this.invalidatePolicyCache();

    const approved = Boolean(call.args?.__approved);
    if (missionId !== "__system__" && this.isPotentiallyMutatingToolCall(call) && !this.hasWorkItemAttribution(call) && !approved) {
      const sanitizedArgs = redactSensitiveObject(call.args || {});
      const summary = `Approval required: unattributed mutating tool call (${call.tool})`;
      await this.missionStore.saveEvent(missionId, {
        level: "warn",
        source: "tool:attribution",
        message: `Unattributed mutating tool call blocked pending approval: ${call.tool}`,
        data: { tool: call.tool }
      });
      return {
        ok: false,
        summary,
        requiresApproval: {
          kind: "external_tool",
          title: "Unattributed mutating tool call (missing workItemId)",
          details: trimText(
            [
              "This tool call is potentially mutating but is missing __workItemId attribution.",
              "AFv2 requires mutating actions to be attributable to a WorkItem for scope governance and safe recovery.",
              "",
              `Tool: ${call.tool}`,
              "",
              "Args (sanitized):",
              JSON.stringify(sanitizedArgs, null, 2)
            ].join("\n"),
            1600
          )
        }
      };
    }

    if (missionId !== "__system__" && this.isPotentiallyMutatingToolCall(call) && !this.hasWorkItemAttribution(call) && approved) {
      await this.missionStore.saveEvent(missionId, {
        level: "warn",
        source: "tool:attribution",
        message: `Approved mutating tool call executed without __workItemId attribution: ${call.tool}`,
        data: { tool: call.tool }
      });
    }

    if (call.tool.startsWith("mcp.")) return this.executeMcp(missionId, call, approved);
    if (call.tool.startsWith("ext.")) return this.executeExternal(missionId, call, approved);
    if (call.tool.startsWith("git.")) return this.executeGit(missionId, call, approved);
    if (call.tool.startsWith("docker.") || call.tool.startsWith("db.")) return this.executeInfra(missionId, call, approved);

    const handler = this.builtinDispatch[call.tool];
    if (handler) return handler(missionId, call);
    return { ok: false, summary: `Unknown tool: ${call.tool}` };
  }

  async showApprovalDiff(approvalId: string, diffPreview: ToolApproval["diffPreview"]): Promise<void> {
    if (!diffPreview?.previewBeforeUri || !diffPreview.previewAfterUri) return;
    await vscode.commands.executeCommand(
      "vscode.diff",
      vscode.Uri.file(diffPreview.previewBeforeUri),
      vscode.Uri.file(diffPreview.previewAfterUri),
      diffPreview.targetPath ? `Approval diff • ${diffPreview.targetPath}` : `Approval diff • ${approvalId}`
    );
  }


  async showApprovalHunks(approvalId: string, diffPreview: ToolApproval["diffPreview"]): Promise<void> {
    const hunks = diffPreview?.hunks || [];
    const content = [
      `# Pending change hunks`,
      '',
      `Approval: ${approvalId}`,
      diffPreview?.targetPath ? `Target: ${diffPreview.targetPath}` : '',
      '',
      renderHunkSummary(hunks)
    ].filter(Boolean).join("\n");
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  async showApprovalHunkAtIndex(approvalId: string, diffPreview: ToolApproval["diffPreview"], index: number): Promise<void> {
    const hunks = diffPreview?.hunks || [];
    if (!hunks.length) {
      return this.showApprovalHunks(approvalId, diffPreview);
    }
    const clamped = Math.max(0, Math.min(index, hunks.length - 1));
    const h = hunks[clamped];
    const content = [
      `# Pending change hunk ${clamped + 1} / ${hunks.length}`,
      '',
      `Approval: ${approvalId}`,
      diffPreview?.targetPath ? `Target: ${diffPreview.targetPath}` : '',
      '',
      h.header,
      '',
      ...h.beforeLines.map((l) => `- ${l}`),
      ...h.afterLines.map((l) => `+ ${l}`)
    ].filter(Boolean).join("\n");
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc, { preview: false });
  }


  private async listMcpTools(missionId: string): Promise<ToolResult> {
    const tools = await this.mcp.listTools();
    const cfg = vscode.workspace.getConfiguration();
    const summaryMax = cfg.get<number>("myAi.tools.listMcpToolsSummaryMaxChars", 0);
    const data = compactMcpToolDescriptors(tools, summaryMax);
    if (missionId !== "__system__") {
      await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:listMcpTools", message: `Listed ${tools.length} MCP tools` });
    }
    const mode = summaryMax > 0 ? "summary" : "full";
    return {
      ok: true,
      summary: `Listed ${tools.length} MCP tools (${mode}${summaryMax > 0 ? `, budget ${summaryMax} chars` : ""}).`,
      data
    };
  }

  private async executeMcp(missionId: string, call: ToolCall, approved: boolean): Promise<ToolResult> {
    {
      const gate = await this.requireApprovalForNonImplementerMutation(
        missionId,
        call,
        approved,
        `Call MCP tool ${call.tool} (non-implementer mutation)`,
        `Only implementer work items may call MCP tools without an explicit approval.\n\nArgs (sanitized):\n${trimText(JSON.stringify(redactSensitiveObject(call.args || {}), null, 2), 1200)}`
      );
      if (gate) return gate;
    }
    const decision = this.policyEngine().decide({ action: "call_mcp" });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    if (decision.requiresApproval && !approved) {
      const sanitizedArgs = redactSensitiveObject(call.args || {});
      return {
        ok: false,
        summary: `Approval required before MCP call ${call.tool}`,
        requiresApproval: {
          kind: "external_tool",
          title: `Call MCP tool ${call.tool}`,
          details: trimText(JSON.stringify(sanitizedArgs, null, 2), 1600)
        }
      };
    }
    const result = await this.mcp.execute(call);
    await this.missionStore.saveEvent(missionId, {
      level: result.ok ? "info" : "warn",
      source: `tool:${call.tool}`,
      message: result.summary,
      data: result.data !== undefined ? redactSensitiveObject(result.data) : undefined
    });
    return result;
  }

  private async executeExternal(missionId: string, call: ToolCall, approved: boolean): Promise<ToolResult> {
    const adapterName = call.tool.replace(/^ext\./, "");
    const adapter = await this.externalAdapters.get(adapterName);
    if (!adapter) return { ok: false, summary: `External adapter not found: ${adapterName}` };

    if (adapter.mutating) {
      const gate = await this.requireApprovalForNonImplementerMutation(
        missionId,
        call,
        approved,
        `Call external adapter ${adapterName} (non-implementer mutation)`,
        `Only implementer work items may call mutating external adapters without an explicit approval.\n\nArgs (sanitized):\n${trimText(JSON.stringify(redactSensitiveObject(call.args || {}), null, 2), 1200)}`
      );
      if (gate) return gate;
    }

    const decision = this.policyEngine().decide({ action: "call_external", mutating: Boolean(adapter.mutating) });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    if (decision.requiresApproval && !approved) {
      const sanitizedAdapter = redactSensitiveObject(adapter);
      const sanitizedArgs = redactSensitiveObject(call.args);
      return {
        ok: false,
        summary: `Approval required before external adapter ${adapterName}`,
        requiresApproval: {
          kind: "external_tool",
          title: `Call external adapter ${adapterName}`,
          details: trimText(JSON.stringify({ adapter: sanitizedAdapter, args: sanitizedArgs }, null, 2), 1600)
        }
      };
    }

    const result = await this.externalAdapters.execute(call, missionId);
    await this.missionStore.saveEvent(missionId, {
      level: result.ok ? "info" : "warn",
      source: `tool:${call.tool}`,
      message: result.summary,
      data: result.data !== undefined ? redactSensitiveObject(result.data) : undefined
    });
    return { ok: result.ok, summary: result.summary, data: result.data };
  }

  private static readonly GIT_MUTATING = new Set(["git.commit", "git.checkout_file", "git.stash_push", "git.stash_pop"]);

  private async executeGit(missionId: string, call: ToolCall, approved: boolean): Promise<ToolResult> {
    const isMutating = ToolRegistry.GIT_MUTATING.has(call.tool);

    if (isMutating) {
      const decision = this.policyEngine().decide({ action: "run_command" });
      if (!decision.allowed) return this.policyBlocked(decision.reason);
      if (decision.requiresApproval && !approved) {
        return {
          ok: false,
          summary: `Approval required before ${call.tool}`,
          requiresApproval: {
            kind: "terminal",
            title: `Git: ${call.tool}`,
            details: trimText(JSON.stringify(call.args, null, 2), 1200)
          }
        };
      }
    }

    let result: gitTools.GitToolResult;
    switch (call.tool) {
      case "git.status":
        result = await gitTools.gitStatus();
        break;
      case "git.diff":
        result = await gitTools.gitDiff({ staged: Boolean(call.args.staged), path: call.args.path ? String(call.args.path) : undefined });
        break;
      case "git.log":
        result = await gitTools.gitLog(call.args.count ? Number(call.args.count) : undefined);
        break;
      case "git.blame":
        result = await gitTools.gitBlame(String(call.args.path || ""), call.args.startLine ? Number(call.args.startLine) : undefined, call.args.endLine ? Number(call.args.endLine) : undefined);
        break;
      case "git.stash_push":
        result = await gitTools.gitStashPush(call.args.message ? String(call.args.message) : undefined);
        break;
      case "git.stash_pop":
        result = await gitTools.gitStashPop();
        break;
      case "git.checkout_file":
        if (!approved) {
          const attributed = this.getAttributedWorkItem(missionId, call);
          if (attributed) {
            const resolvedPath = this.resolveWorkspacePath(String(call.args.path || ""));
            const drift = classifyScopeDriftForPath({
              mission: attributed.mission,
              item: attributed.item,
              tool: call.tool,
              resolvedPath
            });
            if (drift.kind === "hard_block") {
              return this.policyBlocked(drift.reason);
            }
            if (drift.kind === "needs_approval") {
              return {
                ok: false,
                summary: `Approval required before ${call.tool} (scope drift)`,
                requiresApproval: {
                  kind: "terminal",
                  title: `Git: ${call.tool} (scope drift)`,
                  details: trimText(
                    [
                      drift.reason,
                      "",
                      `Path: ${resolvedPath}`,
                      "",
                      `Scope drift details: ${JSON.stringify(drift.details, null, 2)}`
                    ].join("\n"),
                    1600
                  )
                }
              };
            }
          }
        }
        result = await gitTools.gitCheckoutFile(String(call.args.path || ""));
        break;
      case "git.commit":
        {
          const gate = await this.requireApprovalForNonImplementerMutation(
            missionId,
            call,
            approved,
            `Git: ${call.tool} (non-implementer mutation)`,
            `Only implementer work items may trigger git.commit without an explicit approval.\n\nArgs:\n${trimText(JSON.stringify(redactSensitiveObject(call.args), null, 2), 1200)}`
          );
          if (gate) return gate;
        }
        result = await gitTools.gitCommit(String(call.args.message || "auto-commit"), call.args.paths as string[] | undefined);
        break;
      case "git.show":
        result = await gitTools.gitShow(String(call.args.ref || "HEAD"));
        break;
      default:
        return { ok: false, summary: `Unknown git tool: ${call.tool}` };
    }

    await this.missionStore.saveEvent(missionId, {
      level: result.ok ? "info" : "warn",
      source: `tool:${call.tool}`,
      message: result.summary,
      data: result.data !== undefined ? result.data : undefined
    });
    return { ok: result.ok, summary: result.summary, data: result.data };
  }

  private static readonly INFRA_MUTATING = new Set(["docker.exec", "db.query"]);

  private async executeInfra(missionId: string, call: ToolCall, approved: boolean): Promise<ToolResult> {
    const isMutating = ToolRegistry.INFRA_MUTATING.has(call.tool);

    if (isMutating) {
      const decision = this.policyEngine().decide({ action: "run_command" });
      if (!decision.allowed) return this.policyBlocked(decision.reason);
      if (decision.requiresApproval && !approved) {
        return {
          ok: false,
          summary: `Approval required before ${call.tool}`,
          requiresApproval: {
            kind: "terminal",
            title: call.tool,
            details: trimText(JSON.stringify(call.args, null, 2), 1200)
          }
        };
      }
    }

    let result: dockerTools.DockerToolResult;
    switch (call.tool) {
      case "docker.ps":
        result = await dockerTools.dockerPs();
        break;
      case "docker.logs": {
        const cv = validateContainerName(String(call.args.container || ""));
        if (!cv.valid) return { ok: false, summary: `docker.logs rejected: ${cv.reason}` };
        result = await dockerTools.dockerLogs(String(call.args.container), call.args.tail ? Number(call.args.tail) : undefined);
        break;
      }
      case "docker.exec": {
        const gate = await this.requireApprovalForNonImplementerMutation(
          missionId,
          call,
          approved,
          `Docker: ${call.tool} (non-implementer mutation)`,
          `Only implementer work items may trigger docker.exec without an explicit approval.\n\nArgs:\n${trimText(JSON.stringify(redactSensitiveObject(call.args), null, 2), 1200)}`
        );
        if (gate) return gate;
        const cv = validateContainerName(String(call.args.container || ""));
        if (!cv.valid) return { ok: false, summary: `docker.exec rejected: ${cv.reason}` };
        const cmdV = validateCommand(String(call.args.command || ""));
        if (!cmdV.valid) return { ok: false, summary: `docker.exec command rejected: ${cmdV.reason}` };
        result = await dockerTools.dockerExec(String(call.args.container), String(call.args.command));
        break;
      }
      case "docker.compose_status":
        result = await dockerTools.dockerComposeStatus();
        break;
      case "db.query": {
        const gate = await this.requireApprovalForNonImplementerMutation(
          missionId,
          call,
          approved,
          `DB: ${call.tool} (non-implementer mutation)`,
          `Only implementer work items may trigger db.query without an explicit approval.\n\nArgs:\n${trimText(JSON.stringify(redactSensitiveObject(call.args), null, 2), 1200)}`
        );
        if (gate) return gate;
        const ev = validateDbEngine(String(call.args.engine || ""));
        if (!ev.valid) return { ok: false, summary: ev.reason! };
        const qv = validateSqlQuery(String(call.args.query || ""));
        if (!qv.valid) return { ok: false, summary: `db.query rejected: ${qv.reason}` };
        result = await dockerTools.dbQuery(String(call.args.engine), String(call.args.connectionString || ""), String(call.args.query));
        break;
      }
      case "db.schema": {
        const ev = validateDbEngine(String(call.args.engine || ""));
        if (!ev.valid) return { ok: false, summary: ev.reason! };
        result = await dockerTools.dbSchema(String(call.args.engine), String(call.args.connectionString || ""));
        break;
      }
      default:
        return { ok: false, summary: `Unknown infra tool: ${call.tool}` };
    }

    await this.missionStore.saveEvent(missionId, {
      level: result.ok ? "info" : "warn",
      source: `tool:${call.tool}`,
      message: result.summary,
      data: result.data !== undefined ? result.data : undefined
    });
    return { ok: result.ok, summary: result.summary, data: result.data };
  }

  private async listTools(missionId: string): Promise<ToolResult> {
    const cfg = vscode.workspace.getConfiguration();
    const hintsBudget = cfg.get<number>("myAi.tools.listToolsHintsMaxChars", 16_000);
    const externalRaw = await this.externalAdapters.list();
    const redactExternal = cfg.get<boolean>("myAi.tools.listToolsRedactExternalUrls", false);
    const external = redactExternal ? toExternalAdapterPublicSummaries(externalRaw) : externalRaw;
    const builtins = [...BUILTIN_TOOL_NAMES];
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:listTools", message: "Listed built-in and external tools" });
    const mcpServerConfigs = await this.mcp.listServers();
    const mcpServers = mcpServerConfigs.map((s) => String(s.name || "").trim()).filter(Boolean);
    const data: Record<string, unknown> = { builtins, external, mcpServers };
    if (redactExternal) {
      data.externalUrlsRedacted = true;
    }
    if (hintsBudget > 0) {
      const hints = buildListToolsHintEntries(hintsBudget, externalRaw);
      data.hints = hints.entries;
      if (hints.truncated) {
        data.hintsTruncated = true;
      }
    }
    const redactNote = redactExternal ? "; external URLs redacted" : "";
    const mcpNote = mcpServers.length ? `; ${mcpServers.length} MCP server(s) in config` : "";
    return {
      ok: true,
      summary: `Listed ${builtins.length + external.length} tools${hintsBudget > 0 ? " with hints" : ""}${redactNote}${mcpNote}.`,
      data
    };
  }

  private async readFile(missionId: string, fsPath: string): Promise<ToolResult> {
    const fpv = validateFilePath(fsPath);
    if (!fpv.valid) return { ok: false, summary: `readFile rejected: ${fpv.reason}` };
    const resolvedPath = this.resolveWorkspacePath(fsPath);
    const decision = this.policyEngine().decide({ action: "read_file", targetPath: resolvedPath });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(resolvedPath));
      const text = Buffer.from(bytes).toString("utf8");
      await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:readFile", message: resolvedPath });
      return { ok: true, summary: `Read ${resolvedPath}`, data: trimText(text, 30000) };
    } catch (e) {
      const msg = e instanceof vscode.FileSystemError ? e.message : String(e);
      const code = e instanceof vscode.FileSystemError ? e.code : "Unknown";
      const notFound =
        (e instanceof vscode.FileSystemError &&
          (code === "FileNotFound" || code === "EntryNotFound")) ||
        /ENOENT|EntryNotFound|no such file|not found/i.test(msg);
      const hint = notFound
        ? " Use listFiles or grepSearch to locate the file (check subfolders and exact filename casing)."
        : "";
      let suggestedPaths: string[] = [];
      if (notFound) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) {
          try {
            suggestedPaths = await suggestWorkspacePathsForMissingFile(
              root,
              resolvedPath,
              this.workspaceIndex,
              12
            );
          } catch {
            suggestedPaths = [];
          }
        }
      }
      await this.missionStore.saveEvent(missionId, {
        level: "warn",
        source: "tool:readFile",
        message: `Failed: ${resolvedPath}`,
        data: { code, detail: msg, suggestedPaths }
      });
      const suggestNote =
        suggestedPaths.length > 0
          ? ` Suggested paths (try readFile on one): ${suggestedPaths.join(", ")}`
          : "";
      return {
        ok: false,
        summary: `readFile failed: ${msg}${hint}${suggestNote}`,
        data: { path: resolvedPath, code, suggestedPaths }
      };
    }
  }

  private async buildFileApprovalResult(
    kind: ToolApproval["kind"],
    title: string,
    resolvedPath: string,
    beforeText: string,
    afterText: string,
    detailsText: string
  ): Promise<ToolResult> {
    const hunks = buildDiffHunks(beforeText, afterText);
    const preview = await this.disk.writeApprovalPreview(uid("preview"), beforeText, afterText);
    return {
      ok: false,
      summary: `Approval required before ${title.toLowerCase()}`,
      requiresApproval: {
        kind,
        title,
        details: detailsText + "\n\n" + trimText(renderHunkSummary(hunks), 1200),
        diffPreview: {
          targetPath: resolvedPath,
          beforeText: trimText(beforeText, 1200),
          afterText: trimText(afterText, 1200),
          previewBeforeUri: preview?.before.fsPath,
          previewAfterUri: preview?.after.fsPath,
          hunks
        }
      }
    };
  }

  private async writeFile(missionId: string, call: ToolCall): Promise<ToolResult> {
    const fsPath = String(call.args.path || "");
    const content = String(call.args.content || "");
    const approved = Boolean(call.args.__approved);
    const fpv = validateFilePath(fsPath);
    if (!fpv.valid) return { ok: false, summary: `writeFile rejected: ${fpv.reason}` };
    const resolvedPath = this.resolveWorkspacePath(fsPath);

    const attributed = this.getAttributedWorkItem(missionId, call);
    if (attributed) {
      const drift = classifyScopeDriftForPath({
        mission: attributed.mission,
        item: attributed.item,
        tool: call.tool,
        resolvedPath
      });
      if (drift.kind === "hard_block") {
        return this.policyBlocked(drift.reason);
      }
      if (drift.kind === "needs_approval" && !approved) {
        await this.missionStore.saveEvent(missionId, {
          level: "warn",
          source: "scope",
          message: drift.reason,
          telemetryKind: "scope_drift",
          data: drift.details
        });
        const details = [
          drift.reason,
          "",
          `WorkItem: ${attributed.item.role} • ${attributed.item.title} (${attributed.item.id})`,
          attributed.item.blueprintStepId ? `Blueprint step: ${attributed.item.blueprintStepId}` : "",
          `Path: ${resolvedPath}`,
          "",
          `Scope drift details: ${JSON.stringify(drift.details, null, 2)}`
        ]
          .filter(Boolean)
          .join("\n");
        return this.buildFileApprovalResult(
          "write_file",
          `Scope drift: write file ${resolvedPath}`,
          resolvedPath,
          "",
          content,
          trimText(details, 1600)
        );
      }
      if (/weak alignment/i.test(drift.reason)) {
        await this.missionStore.saveEvent(missionId, {
          level: "warn",
          source: "scope",
          message: drift.reason,
          telemetryKind: "scope_drift",
          data: { tool: call.tool, path: resolvedPath, workItemId: attributed.item.id }
        });
      }
    }

    const decision = this.policyEngine().decide({ action: "write_file", targetPath: resolvedPath });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    const uri = vscode.Uri.file(resolvedPath);
    let beforeText = "";
    try {
      beforeText = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    } catch {
      beforeText = "";
    }
    if (decision.requiresApproval && !approved) {
      return this.buildFileApprovalResult(
        "write_file",
        `Write file ${resolvedPath}`,
        resolvedPath,
        beforeText,
        content,
        trimText(content, 1200)
      );
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
    this.fileTracker?.trackFile(missionId, resolvedPath);
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:writeFile", message: resolvedPath });
    return { ok: true, summary: `Wrote ${resolvedPath}` };
  }

  private async applyPatch(missionId: string, call: ToolCall): Promise<ToolResult> {
    const fsPath = String(call.args.path || "");
    const search = String(call.args.search || "");
    const replace = String(call.args.replace || "");
    const approved = Boolean(call.args.__approved);
    const resolvedPath = this.resolveWorkspacePath(fsPath);

    const attributed = this.getAttributedWorkItem(missionId, call);
    if (attributed) {
      const drift = classifyScopeDriftForPath({
        mission: attributed.mission,
        item: attributed.item,
        tool: call.tool,
        resolvedPath
      });
      if (drift.kind === "hard_block") {
        return this.policyBlocked(drift.reason);
      }
    }

    const decision = this.policyEngine().decide({ action: "apply_patch", targetPath: resolvedPath });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    const uri = vscode.Uri.file(resolvedPath);
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const updated = text.replace(search, replace);
    if (updated === text) {
      if (isApplyPatchNoopBecauseReplaceAlreadyPresent(text, search, replace)) {
        return {
          ok: true,
          summary: `No-op: search text not found but replace content already present in ${resolvedPath}`,
          applyPatchNoop: true
        };
      }
      return { ok: false, summary: `Search text not found in ${resolvedPath}` };
    }
    if (!approved && attributed) {
      const drift = classifyScopeDriftForPath({
        mission: attributed.mission,
        item: attributed.item,
        tool: call.tool,
        resolvedPath
      });
      if (drift.kind === "needs_approval") {
        await this.missionStore.saveEvent(missionId, {
          level: "warn",
          source: "scope",
          message: drift.reason,
          telemetryKind: "scope_drift",
          data: drift.details
        });
        const details = [
          drift.reason,
          "",
          `WorkItem: ${attributed.item.role} • ${attributed.item.title} (${attributed.item.id})`,
          attributed.item.blueprintStepId ? `Blueprint step: ${attributed.item.blueprintStepId}` : "",
          `Path: ${resolvedPath}`,
          "",
          `Scope drift details: ${JSON.stringify(drift.details, null, 2)}`,
          "",
          "SEARCH:",
          trimText(search, 600),
          "",
          "REPLACE:",
          trimText(replace, 600)
        ]
          .filter(Boolean)
          .join("\n");
        return this.buildFileApprovalResult(
          "apply_patch",
          `Scope drift: apply patch to ${resolvedPath}`,
          resolvedPath,
          text,
          updated,
          trimText(details, 1600)
        );
      }
      if (/weak alignment/i.test(drift.reason)) {
        await this.missionStore.saveEvent(missionId, {
          level: "warn",
          source: "scope",
          message: drift.reason,
          telemetryKind: "scope_drift",
          data: { tool: call.tool, path: resolvedPath, workItemId: attributed.item.id }
        });
      }
    }

    if (decision.requiresApproval && !approved) {
      const patchDetails = ["Path: " + resolvedPath, "", "SEARCH:", trimText(search, 600), "", "REPLACE:", trimText(replace, 600)].join("\n");
      return this.buildFileApprovalResult("apply_patch", `Apply patch to ${resolvedPath}`, resolvedPath, text, updated, patchDetails);
    }
    const missionSnap = this.missionStore.get(missionId);
    const trustPatch = evaluateTrustActionGate({
      cfg: vscode.workspace.getConfiguration(),
      mission: missionSnap,
      call,
      applyPatchSearch: search,
      applyPatchReplace: replace,
      approved
    });
    if (trustPatch) {
      const patchDetails = ["Path: " + resolvedPath, "", trustPatch.details, "", "SEARCH:", trimText(search, 600), "", "REPLACE:", trimText(replace, 600)].join("\n");
      return this.buildFileApprovalResult("apply_patch", trustPatch.title, resolvedPath, text, updated, trimText(patchDetails, 2000));
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, "utf8"));
    this.fileTracker?.trackFile(missionId, resolvedPath);
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:applyPatch", message: resolvedPath });
    return { ok: true, summary: `Patched ${resolvedPath}` };
  }

  private async searchFiles(missionId: string, glob: string, query: string): Promise<ToolResult> {
    const maxResults = this.effectiveSearchFilesMaxResults();
    const rgResult = await ripgrepSearch({
      pattern: query,
      glob,
      maxResults,
      fixedString: true
    });

    if (rgResult.ok) {
      const grouped = new Map<string, string[]>();
      for (const m of rgResult.matches) {
        const lines = grouped.get(m.file) || [];
        lines.push(m.matchText);
        grouped.set(m.file, lines);
      }
      const fileCap = Math.min(25, maxResults);
      const lineCap = Math.min(8, Math.max(3, Math.floor(maxResults / 4)));
      const matches = [...grouped.entries()].slice(0, fileCap).map(([file, lines]) => ({ file, lines: lines.slice(0, lineCap) }));
      await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:searchFiles", message: `glob=${glob} query=${query} (ripgrep)` });
      return { ok: true, summary: `Found ${matches.length} matching files.`, data: matches };
    }

    const scanCap = Math.min(400, Math.max(50, maxResults * 6));
    const files = await vscode.workspace.findFiles(glob, "**/node_modules/**", scanCap);
    const matches: Array<{ file: string; lines: string[] }> = [];
    const fileCap = Math.min(25, maxResults);
    const lineCap = Math.min(8, Math.max(3, Math.floor(maxResults / 4)));
    for (const file of files) {
      const text = Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8");
      if (!text.includes(query)) continue;
      matches.push({
        file: file.fsPath,
        lines: text.split(/\r?\n/).filter((line) => line.includes(query)).slice(0, lineCap)
      });
      if (matches.length >= fileCap) break;
    }
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:searchFiles", message: `glob=${glob} query=${query} (vscode fallback)` });
    return { ok: true, summary: `Found ${matches.length} matching files.`, data: matches };
  }

  private async listFiles(missionId: string, glob: string): Promise<ToolResult> {
    const files = await vscode.workspace.findFiles(glob, "**/node_modules/**", 300);
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:listFiles", message: `glob=${glob}` });
    return { ok: true, summary: `Listed ${files.length} files.`, data: files.map((f) => f.fsPath) };
  }

  private async getDiagnostics(missionId: string): Promise<ToolResult> {
    const all = vscode.languages.getDiagnostics().map(([uri, diags]) => ({
      file: uri.fsPath,
      diagnostics: diags.map((d) => ({
        message: d.message,
        line: d.range.start.line,
        severity: String(d.severity)
      }))
    }));
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:getDiagnostics", message: "Collected diagnostics" });
    return { ok: true, summary: `Collected diagnostics for ${all.length} files.`, data: all };
  }

  private async grepSearch(missionId: string, pattern: string, glob?: string, maxResults?: number): Promise<ToolResult> {
    const capped = this.effectiveSearchFilesMaxResults(maxResults);
    const result = await ripgrepSearch({ pattern, glob, maxResults: capped, fixedString: false });
    if (!result.ok) {
      return { ok: false, summary: result.error || "grep search failed" };
    }
    const summary = result.truncated
      ? `Found ${result.matches.length}+ matches (truncated) for pattern: ${pattern}`
      : `Found ${result.matches.length} match(es) for pattern: ${pattern}`;
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:grepSearch", message: summary });
    return {
      ok: true,
      summary,
      data: result.matches.map((m) => ({
        file: m.file,
        line: m.line,
        col: m.col,
        match: m.matchText
      }))
    };
  }

  private async fileTreeTool(missionId: string, maxDepth?: number): Promise<ToolResult> {
    const result = await fileTree({ maxDepth });
    if (!result.ok) {
      return { ok: false, summary: result.error || "file tree generation failed" };
    }
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:fileTree", message: `Generated tree (${result.fileCount} files)` });
    return { ok: true, summary: `File tree with ${result.fileCount} files.`, data: result.tree };
  }

  private async findRelevantFilesTool(missionId: string, query: string): Promise<ToolResult> {
    if (!this.workspaceIndex) return { ok: false, summary: "Workspace index not available." };
    await this.workspaceIndex.ensureBuilt();
    const results = this.workspaceIndex.search(query, 10);
    const files = results.map((m) => ({
      file: m.tags?.[0] || "",
      summary: trimText(m.text, 300),
    }));
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:findRelevantFiles", message: `Found ${files.length} relevant files for: ${query}` });
    return { ok: true, summary: `Found ${files.length} relevant file(s).`, data: files };
  }

  private async webSearchTool(missionId: string, query: string, approved?: boolean, call?: ToolCall): Promise<ToolResult> {
    if (call) {
      const attributed = this.getAttributedWorkItem(missionId, call);
      if (attributed && attributed.item.role !== "researcher") {
        const gate = await this.requireApprovalForNonImplementerMutation(
          missionId,
          call,
          Boolean(approved),
          "Web search (non-researcher role)",
          `Only researcher work items may call webSearch without an explicit approval.\n\nQuery:\n${query}`
        );
        if (gate) return gate;
      }
    }
    const cfg = vscode.workspace.getConfiguration();
    if (!cfg.get<boolean>("myAi.webResearch.enabled", false)) {
      return {
        ok: false,
        summary:
          "webSearch is disabled. Set myAi.webResearch.enabled to true. Configure myAi.webSearch.provider (duckduckgo default; brave needs Secret Storage API key)."
      };
    }

    const mission = this.missionStore.get(missionId);
    const economyItem = call ? this.getAttributedWorkItem(missionId, call)?.item : undefined;
    const maxCalls = effectiveWebResearchMaxCallsPerMission(mission, cfg, economyItem);
    const currentCalls = mission?.runtime?.webResearchCalls ?? 0;
    if (maxCalls > 0 && currentCalls >= maxCalls) {
      await enqueueWebResearchConsolidationIfAbsent(this.missionStore, missionId, {
        limit: maxCalls,
        current: currentCalls,
        triggerTool: "webSearch",
        detail: `query=${trimText(query, 400)}`
      });
      const msg = `Web research limit reached (${currentCalls}/${maxCalls} webSearch/fetchWebPage calls). A researcher work item was queued to consolidate evidence from mission memory; reuse cache or raise myAi.webResearch.maxCallsPerMission if needed. Caps follow the provider for this work item (routing per role when set); local providers skip the cap when unlimitedBudgetForLocalLlm is true.`;
      await this.missionStore.saveEvent(missionId, { level: "warn", source: "tool:webSearch", message: msg });
      return { ok: false, summary: msg };
    }

    const cacheEnabled = cfg.get<boolean>("myAi.webResearch.cacheEnabled", true);
    const cacheTtlMs = Math.max(0, cfg.get<number>("myAi.webResearch.cacheTtlMs", 10 * 60_000));
    const cacheKey = `${missionId}:webSearch:${query.trim().toLowerCase()}`;
    if (cacheEnabled) {
      const hit = this.webResearchCache.get(cacheKey);
      if (hit) {
        const age = Date.now() - hit.ts;
        if (age <= cacheTtlMs) {
          await this.missionStore.saveEvent(missionId, {
            level: "info",
            source: "tool:webSearch",
            message: `webSearch cache hit (${Math.round(age / 1000)}s old)`
          });
          return {
            ...hit.result,
            summary: `Cache hit: ${hit.result.summary}`,
            data: { ...(hit.result.data as any), __cache: { hit: true, ageMs: age } }
          };
        }
        await this.missionStore.saveEvent(missionId, {
          level: "warn",
          source: "tool:webSearch",
          message: `webSearch cache stale (${Math.round(age / 1000)}s old); refetching`
        });
      }
    }
    const qv = validateSearchQuery(query);
    if (!qv.valid) {
      return { ok: false, summary: qv.reason || "Invalid search query" };
    }
    const decision = this.policyEngine().decide({ action: "http_request" });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    const skipHttpApproval = cfg.get<boolean>("myAi.webResearch.skipHttpApproval", true);
    if (decision.requiresApproval && !approved && !skipHttpApproval) {
      return {
        ok: false,
        summary: "Approval required before web search.",
        requiresApproval: {
          kind: "external_tool",
          title: "Web search",
          details: trimText(query, 500)
        }
      };
    }
    const providerRaw = String(cfg.get<string>("myAi.webSearch.provider", "duckduckgo") || "duckduckgo").toLowerCase();
    const provider: WebSearchProviderId = providerRaw === "brave" ? "brave" : "duckduckgo";
    let braveKey: string | undefined;
    if (provider === "brave") {
      braveKey = (await this.secrets.get(BRAVE_WEB_SEARCH_SECRET_KEY))?.trim();
      if (!braveKey) {
        return {
          ok: false,
          summary:
            "webSearch provider is brave but no API key found. Store the key in VS Code Secret Storage as myAi.webSearch.braveApiKey (Brave Search API subscription)."
        };
      }
    }
    const minIntervalMs = effectiveWebSearchMinIntervalMs(mission, cfg, economyItem);
    if (minIntervalMs > 0) {
      const now = Date.now();
      const elapsed = now - this.webSearchLastAtMs;
      if (this.webSearchLastAtMs > 0 && elapsed < minIntervalMs) {
        const waitSec = Math.ceil((minIntervalMs - elapsed) / 1000);
        return {
          ok: false,
          summary: `webSearch cooldown: wait ${waitSec}s before another request (myAi.webSearch.minIntervalMs).`
        };
      }
      this.webSearchLastAtMs = now;
    }
    const r = await runWebSearch(query, { provider, braveApiKey: braveKey });
    await this.missionStore.saveEvent(missionId, {
      level: r.ok ? "info" : "warn",
      source: "tool:webSearch",
      message: r.summary
    });
    await this.missionStore.updateRuntime(missionId, { webResearchCalls: currentCalls + 1 });
    if (cacheEnabled && r.ok) {
      this.webResearchCache.set(cacheKey, { ts: Date.now(), result: { ok: r.ok, summary: r.summary, data: r.data } });
    }
    return { ok: r.ok, summary: r.summary, data: r.data };
  }

  private async browserCaptureTool(missionId: string, url: string, approved?: boolean): Promise<ToolResult> {
    const cfg = vscode.workspace.getConfiguration();
    if (!cfg.get<boolean>("myAi.browser.enabled", false)) {
      return {
        ok: false,
        summary:
          "browserCapture is disabled. Set myAi.browser.enabled and myAi.browser.captureCommand (must include {url} and {outPath}). Or use an MCP Playwright server — see AGENT_CAPABILITIES_PLAN.md."
      };
    }
    const template = String(cfg.get<string>("myAi.browser.captureCommand", "") || "");
    const uv = validateUrl(url);
    if (!uv.valid) {
      return { ok: false, summary: `browserCapture rejected: ${uv.reason}` };
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return { ok: false, summary: "No workspace folder; cannot write capture file." };
    }
    const diskFolder = cfg.get<string>("myAi.missions.diskStoreFolder", ".my-ai-extension");
    const capDir = path.join(root, diskFolder, "browser-captures");
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(capDir));
    } catch {
      // exists
    }
    const ext = String(cfg.get<string>("myAi.browser.captureFileExtension", "png") || "png").replace(/[^a-z0-9]/gi, "") || "png";
    const outPath = path.join(capDir, `capture-${Date.now()}.${ext}`);

    const built = buildBrowserCaptureCommand(template, url, outPath);
    if (!built.ok) {
      return { ok: false, summary: built.reason };
    }

    const cmdValidation = validateCommand(built.command);
    if (!cmdValidation.valid) {
      return { ok: false, summary: `browserCapture command rejected: ${cmdValidation.reason}` };
    }

    const decision = this.policyEngine().decide({ action: "run_command" });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    if (decision.requiresApproval && !approved) {
      return {
        ok: false,
        summary: "Approval required before browser capture command.",
        requiresApproval: {
          kind: "terminal",
          title: "Browser / screenshot capture",
          details: trimText(built.command, 2000)
        }
      };
    }

    const timeoutMs = cfg.get<number>("myAi.browser.captureTimeoutMs", 120_000);
    const maxOut = cfg.get<number>("myAi.browser.captureMaxOutputBytes", 65_536);
    const result = await runCommand({
      command: built.command,
      cwd: root,
      timeoutMs,
      maxOutputBytes: maxOut
    });

    const summary = result.timedOut
      ? `browserCapture timed out after ${result.durationMs}ms`
      : result.exitCode === 0
        ? `browserCapture finished (${result.durationMs}ms); output: ${outPath}`
        : `browserCapture failed (exit ${result.exitCode}, ${result.durationMs}ms)`;

    await this.missionStore.saveEvent(missionId, {
      level: result.exitCode === 0 && !result.timedOut ? "info" : "warn",
      source: "tool:browserCapture",
      message: summary,
      data: { exitCode: result.exitCode, outPath, timedOut: result.timedOut }
    });

    return {
      ok: result.exitCode === 0 && !result.timedOut,
      summary,
      data: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        outputPath: outPath
      }
    };
  }

  private async fetchWebPageTool(missionId: string, url: string, approved?: boolean, call?: ToolCall): Promise<ToolResult> {
    if (call) {
      const attributed = this.getAttributedWorkItem(missionId, call);
      if (attributed && attributed.item.role !== "researcher") {
        const gate = await this.requireApprovalForNonImplementerMutation(
          missionId,
          call,
          Boolean(approved),
          "Fetch web page (non-researcher role)",
          `Only researcher work items may call fetchWebPage without an explicit approval.\n\nURL:\n${url}`
        );
        if (gate) return gate;
      }
    }
    const cfg = vscode.workspace.getConfiguration();
    if (!cfg.get<boolean>("myAi.webResearch.enabled", false)) {
      return {
        ok: false,
        summary: "fetchWebPage is disabled. Set myAi.webResearch.enabled to true."
      };
    }

    const mission = this.missionStore.get(missionId);
    const economyItemFetch = call ? this.getAttributedWorkItem(missionId, call)?.item : undefined;
    const maxCalls = effectiveWebResearchMaxCallsPerMission(mission, cfg, economyItemFetch);
    const currentCalls = mission?.runtime?.webResearchCalls ?? 0;
    if (maxCalls > 0 && currentCalls >= maxCalls) {
      await enqueueWebResearchConsolidationIfAbsent(this.missionStore, missionId, {
        limit: maxCalls,
        current: currentCalls,
        triggerTool: "fetchWebPage",
        detail: `url=${trimText(url, 600)}`
      });
      const msg = `Web research limit reached (${currentCalls}/${maxCalls} webSearch/fetchWebPage calls). A researcher work item was queued to consolidate evidence from mission memory; reuse cache or raise myAi.webResearch.maxCallsPerMission if needed. Caps follow the provider for this work item (routing per role when set); local providers skip the cap when unlimitedBudgetForLocalLlm is true.`;
      await this.missionStore.saveEvent(missionId, { level: "warn", source: "tool:fetchWebPage", message: msg });
      return { ok: false, summary: msg };
    }

    const cacheEnabled = cfg.get<boolean>("myAi.webResearch.cacheEnabled", true);
    const cacheTtlMs = Math.max(0, cfg.get<number>("myAi.webResearch.cacheTtlMs", 10 * 60_000));
    const cacheKey = `${missionId}:fetchWebPage:${url.trim().toLowerCase()}`;
    if (cacheEnabled) {
      const hit = this.webResearchCache.get(cacheKey);
      if (hit) {
        const age = Date.now() - hit.ts;
        if (age <= cacheTtlMs) {
          await this.missionStore.saveEvent(missionId, {
            level: "info",
            source: "tool:fetchWebPage",
            message: `fetchWebPage cache hit (${Math.round(age / 1000)}s old)`
          });
          return {
            ...hit.result,
            summary: `Cache hit: ${hit.result.summary}`,
            data: { ...(hit.result.data as any), __cache: { hit: true, ageMs: age } }
          };
        }
        await this.missionStore.saveEvent(missionId, {
          level: "warn",
          source: "tool:fetchWebPage",
          message: `fetchWebPage cache stale (${Math.round(age / 1000)}s old); refetching`
        });
      }
    }
    const uv = validateUrl(url);
    if (!uv.valid) {
      return { ok: false, summary: `fetchWebPage rejected: ${uv.reason}` };
    }
    const decision = this.policyEngine().decide({ action: "http_request" });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    const skipHttpApprovalFetch = cfg.get<boolean>("myAi.webResearch.skipHttpApproval", true);
    if (decision.requiresApproval && !approved && !skipHttpApprovalFetch) {
      return {
        ok: false,
        summary: `Approval required before fetching ${url}`,
        requiresApproval: {
          kind: "external_tool",
          title: "Fetch web page",
          details: trimText(url, 800)
        }
      };
    }
    const r = await runFetchWebPage(url);
    await this.missionStore.saveEvent(missionId, {
      level: r.ok ? "info" : "warn",
      source: "tool:fetchWebPage",
      message: r.summary
    });
    await this.missionStore.updateRuntime(missionId, { webResearchCalls: currentCalls + 1 });
    if (cacheEnabled && r.ok) {
      this.webResearchCache.set(cacheKey, { ts: Date.now(), result: { ok: r.ok, summary: r.summary, data: r.data } });
    }
    return { ok: r.ok, summary: r.summary, data: r.data };
  }

  private async httpRequestTool(missionId: string, method: string, url: string, headers?: Record<string, string>, body?: string, approved?: boolean): Promise<ToolResult> {
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) return { ok: false, summary: `HTTP request rejected: ${urlValidation.reason}` };

    const decision = this.policyEngine().decide({ action: "http_request" });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    if (decision.requiresApproval && !approved) {
      return {
        ok: false,
        summary: `Approval required before HTTP ${method} ${url}`,
        requiresApproval: {
          kind: "external_tool",
          title: `HTTP ${method} ${url}`,
          details: trimText(JSON.stringify({ method, url, headers, body }, null, 2), 1200)
        }
      };
    }

    const httpResult = await withRetry(async () => {
      const r = await httpRequest({ method, url, headers, body });
      return { ok: r.ok, summary: r.summary, data: r } as ToolResult;
    });
    const data = httpResult.data as { status?: number; statusText?: string } | undefined;
    await this.missionStore.saveEvent(missionId, {
      level: httpResult.ok ? "info" : "warn",
      source: "tool:httpRequest",
      message: httpResult.summary,
      data: { status: data?.status, statusText: data?.statusText }
    });
    return httpResult;
  }

  private async runTestsTool(missionId: string, command?: string): Promise<ToolResult> {
    const result = await runTests(command ? { command } : undefined);
    await this.missionStore.saveEvent(missionId, {
      level: result.ok ? "info" : "warn",
      source: "tool:runTests",
      message: result.summary,
      data: { total: result.total, passed: result.passed, failed: result.failed, failures: result.failures?.slice(0, 10) }
    });
    return { ok: result.ok, summary: result.summary, data: result };
  }

  private async runLinterTool(missionId: string, command?: string): Promise<ToolResult> {
    const result = await runLinter(command ? { command } : undefined);
    await this.missionStore.saveEvent(missionId, {
      level: result.ok ? "info" : "warn",
      source: "tool:runLinter",
      message: result.summary,
      data: { errorCount: result.errorCount, warningCount: result.warningCount, issues: result.issues?.slice(0, 15) }
    });
    return { ok: result.ok, summary: result.summary, data: result };
  }

  private async runTerminal(missionId: string, command: string, approved: boolean, call?: ToolCall): Promise<ToolResult> {
    if (call) {
      const gate = await this.requireApprovalForNonImplementerMutation(
        missionId,
        call,
        approved,
        `Run terminal (non-implementer mutation)`,
        `Only implementer work items may trigger runTerminal without an explicit approval.\n\nCommand:\n${command}`
      );
      if (gate) return gate;
    }
    const decision = this.policyEngine().decide({ action: "run_terminal" });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    if (decision.requiresApproval && !approved) {
      return {
        ok: false,
        summary: "Approval required before terminal execution.",
        requiresApproval: {
          kind: "terminal",
          title: "Run terminal command",
          details: command
        }
      };
    }
    if (!approved && !decision.requiresApproval && call) {
      const m = this.missionStore.get(missionId);
      const tg = evaluateTrustActionGate({
        cfg: vscode.workspace.getConfiguration(),
        mission: m,
        call,
        commandText: command,
        approved: false
      });
      if (tg) {
        return { ok: false, summary: tg.summary, requiresApproval: { kind: "terminal", title: tg.title, details: tg.details } };
      }
    }
    const terminal = vscode.window.createTerminal({ name: `Autonomous Factory ${uid("term")}` });
    terminal.show(true);
    terminal.sendText(command, true);
    await this.missionStore.saveEvent(missionId, { level: "info", source: "tool:runTerminal", message: command });
    return { ok: true, summary: `Sent command to terminal: ${command}` };
  }

  private async runCommandTool(
    missionId: string,
    command: string,
    cwd: string | undefined,
    timeoutMs: number | undefined,
    approved: boolean,
    call?: ToolCall
  ): Promise<ToolResult> {
    if (call) {
      const gate = await this.requireApprovalForNonImplementerMutation(
        missionId,
        call,
        approved,
        `Run command (non-implementer mutation)`,
        `Only implementer work items may trigger runCommand without an explicit approval.\n\n${cwd ? `[cwd: ${cwd}]\n` : ""}Command:\n${command}`
      );
      if (gate) return gate;
    }
    const cmdValidation = validateCommand(command);
    if (!cmdValidation.valid) return { ok: false, summary: `Command rejected: ${cmdValidation.reason}` };

    const decision = this.policyEngine().decide({ action: "run_command" });
    if (!decision.allowed) return this.policyBlocked(decision.reason);
    if (decision.requiresApproval && !approved) {
      return {
        ok: false,
        summary: "Approval required before command execution.",
        requiresApproval: {
          kind: "terminal",
          title: "Run command with output capture",
          details: cwd ? `[cwd: ${cwd}] ${command}` : command
        }
      };
    }
    if (!approved && !decision.requiresApproval && call) {
      const m = this.missionStore.get(missionId);
      const tg = evaluateTrustActionGate({
        cfg: vscode.workspace.getConfiguration(),
        mission: m,
        call,
        commandText: command,
        approved: false
      });
      if (tg) {
        return { ok: false, summary: tg.summary, requiresApproval: { kind: "terminal", title: tg.title, details: tg.details } };
      }
    }

    const result = await runCommand({ command, cwd, timeoutMs });

    const summary = result.timedOut
      ? `Command timed out after ${result.durationMs}ms: ${command}`
      : result.exitCode === 0
        ? `Command succeeded (${result.durationMs}ms): ${command}`
        : `Command failed (exit ${result.exitCode}, ${result.durationMs}ms): ${command}`;

    await this.missionStore.saveEvent(missionId, {
      level: result.exitCode === 0 ? "info" : "warn",
      source: "tool:runCommand",
      message: summary,
      data: { exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs }
    });

    return {
      ok: result.exitCode === 0,
      summary,
      data: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        durationMs: result.durationMs
      }
    };
  }
}
