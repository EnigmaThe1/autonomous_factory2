import * as vscode from "vscode";
import { AiSidebarProvider } from "../ui/AiSidebarProvider";
import { MissionOrchestrator } from "../missions/MissionOrchestrator";
import { MissionStore } from "../missions/MissionStore";
import { MissionTemplateStore } from "../missions/MissionTemplateStore";
import { ToolRegistry } from "../tools/ToolRegistry";
import { McpRegistry } from "../tools/McpRegistry";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import { registerMissionCommands } from "./registerMissionCommands";
import { registerApprovalCommands } from "./registerApprovalCommands";
import { registerToolCommands } from "./registerToolCommands";
import { registerTraceCommands } from "./registerTraceCommands";
import { registerTemplateCommands } from "./registerTemplateCommands";
import { SecretStore } from "../storage/SecretStore";

export {
  editAgentRoutingForMission,
  editMissionPolicyForMission,
  editMissionDagForMission
} from "./registerMissionCommands";

export { openApprovalBundleSummaryForMission } from "./registerApprovalCommands";

export function registerCommands(
  sidebar: AiSidebarProvider,
  orchestrator: MissionOrchestrator,
  store: MissionStore,
  tools: ToolRegistry,
  mcp: McpRegistry,
  globalMemory: GlobalMemoryStore,
  traceLogger: ExtensionTraceLogger,
  secrets: SecretStore,
  extensionUri: vscode.Uri,
  templates?: MissionTemplateStore
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [
    vscode.commands.registerCommand("myAi.openChat", () => sidebar.reveal()),
    ...registerMissionCommands(sidebar, orchestrator, store),
    ...registerApprovalCommands(sidebar, orchestrator, store, tools),
    ...registerToolCommands(tools, mcp, globalMemory, secrets, extensionUri),
    ...registerTraceCommands(traceLogger),
    ...(templates ? registerTemplateCommands(sidebar, orchestrator, store, templates) : [])
  ];

  return vscode.Disposable.from(...disposables);
}
