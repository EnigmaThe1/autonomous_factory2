import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { AiSidebarProvider } from "./ui/AiSidebarProvider";
import { ExtensionTraceLogger } from "./diagnostics/ExtensionTraceLogger";
import { ProviderRegistry } from "./providers/ProviderRegistry";
import { EnhancedContextCollector } from "./context/EnhancedContextCollector";
import { MissionStore } from "./missions/MissionStore";
import { MissionOrchestrator } from "./missions/MissionOrchestrator";
import { ToolRegistry } from "./tools/ToolRegistry";
import { SecretStore } from "./storage/SecretStore";
import { registerCommands } from "./commands/registerCommands";
import { registerNativeParticipant } from "./nativeChat/participant";
import { WorkspacePaths } from "./storage/WorkspacePaths";
import { DiskMissionPersistence } from "./storage/DiskMissionPersistence";
import { BackgroundMissionRunner } from "./missions/BackgroundMissionRunner";
import { GlobalMemoryStore } from "./memory/GlobalMemoryStore";
import { ExternalToolAdapterRegistry } from "./tools/ExternalToolAdapterRegistry";
import { McpRegistry } from "./tools/McpRegistry";
import { MissionTemplateStore } from "./missions/MissionTemplateStore";
import { wireAgentStreamThrottle } from "./ui/agentStreamThrottle";
import { WorkspaceIndex } from "./memory/WorkspaceIndex";
import { MissionFileTracker } from "./missions/MissionFileTracker";

export async function activate(context: vscode.ExtensionContext) {
  console.info(`[my-ai] activate ${context.extension.id}@${context.extension.packageJSON.version}`);
  const activationCfg = vscode.workspace.getConfiguration();
  const secrets = new SecretStore(context.secrets);
  const providers = new ProviderRegistry(secrets);
  const collector = new EnhancedContextCollector();
  const paths = new WorkspacePaths();
  const disk = new DiskMissionPersistence(paths);
  await disk.ensureFolders();
  const globalMemory = new GlobalMemoryStore(context.globalState, disk);
  const missionStore = new MissionStore(context.globalState, context.workspaceState, disk);
  await Promise.all([globalMemory.hydrateFromDisk(), missionStore.hydrateFromDisk()]);
  const loadIssues = disk.getAndClearLoadIssues();
  if (loadIssues.length) {
    void vscode.window.showWarningMessage(`Autonomous Factory: detected ${loadIssues.length} persistence load issue(s). See logs for details.`);
    console.warn("[my-ai] persistence load issues", loadIssues);
  }
  const externalAdapters = new ExternalToolAdapterRegistry(paths);
  const mcp = new McpRegistry(paths, disk);
  const templates = new MissionTemplateStore(paths);
  await Promise.all([mcp.hydrate(), templates.hydrate()]);
  const tools = new ToolRegistry(context, missionStore, disk, externalAdapters, mcp, secrets);
  const wsIndex = new WorkspaceIndex();
  tools.workspaceIndex = wsIndex;
  const fileTracker = new MissionFileTracker(missionStore);
  tools.fileTracker = fileTracker;
  if (activationCfg.get<boolean>("myAi.index.buildOnActivation", false)) {
    void wsIndex.build().then((n) => {
      if (n > 0) console.info(`[my-ai] Workspace index: ${n} files`);
    });
  }
  const orchestrator = new MissionOrchestrator(providers, collector, missionStore, tools, globalMemory, undefined, fileTracker);
  orchestrator.onMissionTerminal = (missionId) => {
    fileTracker.flush(missionId);
    fileTracker.clear(missionId);
  };
  const runner = new BackgroundMissionRunner(orchestrator, missionStore);

  const traceLogger = new ExtensionTraceLogger(context, randomUUID());

  const sidebar = new AiSidebarProvider(
    context.extensionUri,
    paths,
    providers,
    collector,
    missionStore,
    orchestrator,
    globalMemory,
    tools,
    mcp,
    secrets,
    traceLogger,
    context.workspaceState,
    context
  );
  await sidebar.hydrateModelCatalogFromDisk();
  globalMemory.onAfterPersist = () => {
    sidebar.scheduleGlobalMemorySectionAfterStoreMutation();
  };
  runner.onSignificantMissionMutation = () => {
    sidebar.scheduleMissionSectionAfterHostTruthEdge();
  };
  wireAgentStreamThrottle(orchestrator, sidebar);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("myAi.sidebar", sidebar, {
      webviewOptions: {
        retainContextWhenHidden: activationCfg.get<boolean>("myAi.ui.retainWebviewContextWhenHidden", true)
      }
    }),
    { dispose: () => wsIndex.dispose() },
    registerCommands(sidebar, orchestrator, missionStore, tools, mcp, globalMemory, traceLogger, secrets, context.extensionUri, templates),
    runner,
    mcp,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("myAi.missions.heartbeatSeconds")) {
        runner.stop();
        runner.start();
      }
    })
  );

  if (activationCfg.get<boolean>("myAi.useNativeChatParticipant", false)) {
    registerNativeParticipant(context, providers, collector);
  }

  if (activationCfg.get<boolean>("myAi.missions.autoResumeOnStartup", true)) {
    void orchestrator.resumeActiveMissions();
  }
  runner.start();

  if (activationCfg.get<boolean>("myAi.ui.autoRevealOnActivation", false)) {
    setTimeout(() => {
      void vscode.commands.executeCommand("myAi.sidebar.focus").then(undefined, () => undefined);
    }, 300);
  }
}


export function deactivate() {}
