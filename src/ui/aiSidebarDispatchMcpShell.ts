import * as vscode from "vscode";
import { createStarterMcpFromSample } from "../tools/mcpStarterConfig";
import type { AiSidebarUiDispatchHost } from "./aiSidebarUiDispatchHost";
import type { UiToExtMessage } from "./protocol";

const DEFAULT_SETTINGS_QUERY = "myAi";
/** Only allow settings keys under our extension namespace (Settings UI search string). */
const SETTINGS_SEARCH_SAFE = /^myAi(\.[a-zA-Z][a-zA-Z0-9_]*){0,16}$/;

export async function dispatchUi_listMcpTools(host: AiSidebarUiDispatchHost): Promise<boolean> {
  host.invalidateMcpToolsSessionsCache();
  const result = await host.tools.execute("__system__", { tool: "listMcpTools", args: {} });
  const lines = Array.isArray(result.data)
    ? (result.data as { server: string; name: string; description?: string }[]).map(
        (x) => `- ${x.server}.${x.name}${x.description ? ` — ${x.description}` : ""}`
      ).join("\n")
    : result.summary;
  const doc = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: `# MCP Tools\n\n${lines || "No MCP tools found."}`
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  host.scheduleAuxiliarySectionAfterMcpMutation();
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_listMcpSessions(host: AiSidebarUiDispatchHost): Promise<boolean> {
  host.invalidateMcpToolsSessionsCache();
  const sessions = await host.mcp.listSessionStates();
  const content = [
    "# MCP Sessions",
    "",
    ...sessions.map(
      (s) =>
        `- ${s.name}: ${s.status}${s.toolCount ? ` • tools ${s.toolCount}` : ""}${s.lastError ? ` • error ${s.lastError}` : ""}`
    )
  ].join("\n");
  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(doc, { preview: false });
  host.scheduleAuxiliarySectionAfterMcpMutation();
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_createStarterMcpConfig(host: AiSidebarUiDispatchHost): Promise<boolean> {
  host.invalidateMcpToolsSessionsCache();
  host.setMcpOnboardingCache(undefined);
  const { workspaceRelativePath } = await createStarterMcpFromSample(host.extensionUri, host.paths);
  host.postMessage({
    type: "info",
    message: `Starter MCP config created at ${workspaceRelativePath} and myAi.mcp.configPath updated (workspace). Edit the file to match your environment; MCP servers still run outside the extension.`
  });
  host.scheduleAuxiliarySectionAfterMcpMutation();
  host.scheduleBackgroundDashboardReconciliation();
  return true;
}

export async function dispatchUi_openTerminal(host: AiSidebarUiDispatchHost): Promise<boolean> {
  await vscode.commands.executeCommand("workbench.action.terminal.toggleTerminal");
  host.postMessage({ type: "info", message: "Native VS Code terminal toggled." });
  return true;
}

export async function dispatchUi_openSettings(
  msg?: Extract<UiToExtMessage, { type: "openSettings" }>
): Promise<boolean> {
  const raw = msg && typeof msg.query === "string" ? msg.query.trim() : "";
  const q = raw && SETTINGS_SEARCH_SAFE.test(raw) ? raw : DEFAULT_SETTINGS_QUERY;
  await vscode.commands.executeCommand("workbench.action.openSettings", q);
  return true;
}

export async function dispatchUi_openMcpConfig(_host: AiSidebarUiDispatchHost): Promise<boolean> {
  await vscode.commands.executeCommand("myAi.openMcpConfig");
  return false;
}
