import * as path from "path";
import * as vscode from "vscode";
import { MISSION_SETTINGS_SEARCH_QUERY } from "../ui/extensionSettingsSearchQuery";
import { ToolRegistry } from "../tools/ToolRegistry";
import { McpRegistry } from "../tools/McpRegistry";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import { SecretStore } from "../storage/SecretStore";
import { BRAVE_WEB_SEARCH_SECRET_KEY } from "../providers/providerCredentialKeys";

export function registerToolCommands(
  tools: ToolRegistry,
  mcp: McpRegistry,
  globalMemory: GlobalMemoryStore,
  secrets: SecretStore,
  extensionUri: vscode.Uri
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand("myAi.openAgentCapabilitiesDoc", async () => {
      const uri = vscode.Uri.joinPath(extensionUri, "AGENT_CAPABILITIES_PLAN.md");
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        void vscode.window.showWarningMessage(
          "AGENT_CAPABILITIES_PLAN.md was not found inside the extension install. If you run from source, ensure the file is next to package.json."
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.openMissionAutonomyBlueprint", async () => {
      const uri = vscode.Uri.joinPath(extensionUri, "MISSION_AUTONOMY_AND_PLANNING_BLUEPRINT.md");
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        void vscode.window.showWarningMessage(
          "MISSION_AUTONOMY_AND_PLANNING_BLUEPRINT.md was not found inside the extension install."
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.openMissionSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", MISSION_SETTINGS_SEARCH_QUERY);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.listMcpTools", async () => {
      const result = await tools.execute("__system__", { tool: "listMcpTools", args: {} });
      const content = JSON.stringify(result.data || [], null, 2);
      const doc = await vscode.workspace.openTextDocument({ language: "json", content });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.listMcpSessions", async () => {
      const sessions = await mcp.listSessionStates();
      const content = JSON.stringify(sessions, null, 2);
      const doc = await vscode.workspace.openTextDocument({ language: "json", content });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.restartMcpSession", async () => {
      const sessions = await mcp.listSessionStates();
      const picked = await vscode.window.showQuickPick(
        sessions.map((s) => ({ label: s.name, detail: `${s.status}${s.toolCount ? ` • tools ${s.toolCount}` : ""}` })),
        { placeHolder: "Select an MCP session to restart" }
      );
      if (!picked) return;
      await mcp.restartSession(picked.label);
      void vscode.window.showInformationMessage(`Restarted MCP session: ${picked.label}`);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.openMcpConfig", async () => {
      const resolved = mcp.getResolvedConfigPath();
      if (!path.isAbsolute(resolved) && !vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showWarningMessage("Open a workspace folder first (MCP config path is workspace-relative).");
        return;
      }
      const uri = vscode.Uri.file(resolved);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        void vscode.window.showWarningMessage(
          `MCP config not found: ${resolved}. Set myAi.mcp.configPath or start from examples/mcp.sample.json (see AGENT_CAPABILITIES_PLAN.md).`
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.applyLazyDiscoveryPreset", async () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showWarningMessage("Open a workspace folder first; the preset applies to workspace settings.");
        return;
      }
      const target = vscode.ConfigurationTarget.Workspace;
      const cfg = vscode.workspace.getConfiguration();
      await cfg.update("myAi.agents.lazyToolPrompt", true, target);
      await cfg.update("myAi.tools.listMcpToolsSummaryMaxChars", 48_000, target);
      await cfg.update("myAi.tools.listToolsRedactExternalUrls", true, target);
      void vscode.window.showInformationMessage(
        "Applied workspace lazy discovery preset: myAi.agents.lazyToolPrompt=true, listMcpToolsSummaryMaxChars=48000, listToolsRedactExternalUrls=true. Use listTools / listMcpTools to discover tools. Adjust values in Settings if needed."
      );
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.revertLazyDiscoveryPreset", async () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showWarningMessage("Open a workspace folder first; revert applies to workspace settings.");
        return;
      }
      const target = vscode.ConfigurationTarget.Workspace;
      const cfg = vscode.workspace.getConfiguration();
      await cfg.update("myAi.agents.lazyToolPrompt", false, target);
      await cfg.update("myAi.tools.listMcpToolsSummaryMaxChars", 0, target);
      await cfg.update("myAi.tools.listToolsRedactExternalUrls", false, target);
      void vscode.window.showInformationMessage(
        "Reverted workspace lazy discovery keys to defaults: lazyToolPrompt=false, listMcpToolsSummaryMaxChars=0, listToolsRedactExternalUrls=false."
      );
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.openWorkspaceSkillsFolder", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage("Open a workspace folder first.");
        return;
      }
      const skillsUri = vscode.Uri.joinPath(folder.uri, ".my-ai", "skills");
      try {
        await vscode.workspace.fs.createDirectory(skillsUri);
      } catch {
        // already exists
      }
      const sampleUri = vscode.Uri.joinPath(skillsUri, "README.md");
      try {
        await vscode.workspace.fs.stat(sampleUri);
      } catch {
        const readme =
          "# Workspace skills\n\nMarkdown (`.md`) files in this folder are merged into agent system prompts when **myAi.skills.enabled** is true.\n\nKeep files focused; large content is truncated per **myAi.skills.maxCharsPerFile** / **maxTotalChars**.\n\nSee the extension **AGENT_CAPABILITIES_PLAN.md** for the full roadmap.\n";
        await vscode.workspace.fs.writeFile(sampleUri, Buffer.from(readme, "utf8"));
      }
      const doc = await vscode.workspace.openTextDocument(sampleUri);
      await vscode.window.showTextDocument(doc, { preview: false });
      void vscode.window.showInformationMessage(`Skills folder: ${skillsUri.fsPath}`);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.searchGlobalMemory", async () => {
      const query = await vscode.window.showInputBox({ prompt: "Search global memory" });
      if (!query) return;
      const results = globalMemory.search(query, 12);
      const content = [
        `# Global memory search`,
        '',
        `Query: ${query}`,
        '',
        ...results.map((m) => `- ${new Date(m.ts).toLocaleString()} [${m.kind}] ${m.text}${m.tags?.length ? ` _(tags: ${m.tags.join(", ")})_` : ""}`)
      ].join("\n");
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.setBraveSearchApiKey", async () => {
      const key = await vscode.window.showInputBox({
        title: "Brave Search API",
        prompt: "Paste your Brave Search API subscription token (X-Subscription-Token)",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "BSA…",
        validateInput: (v) => {
          const t = v.trim();
          if (!t) return "Enter a non-empty token, or press Escape to cancel.";
          if (t.length > 512) return "Token is too long.";
          return undefined;
        }
      });
      if (key === undefined) return;
      const trimmed = key.trim();
      if (!trimmed) return;
      await secrets.set(BRAVE_WEB_SEARCH_SECRET_KEY, trimmed);
      void vscode.window.showInformationMessage(
        "Brave Search API key saved. Set myAi.webSearch.provider to brave and enable myAi.webResearch.enabled to use webSearch with Brave."
      );
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.clearBraveSearchApiKey", async () => {
      const existing = await secrets.get(BRAVE_WEB_SEARCH_SECRET_KEY);
      if (!existing?.trim()) {
        void vscode.window.showInformationMessage("No Brave Search API key is stored.");
        return;
      }
      const pick = await vscode.window.showWarningMessage(
        "Remove the stored Brave Search API key from Secret Storage?",
        { modal: true },
        "Remove"
      );
      if (pick !== "Remove") return;
      await secrets.delete(BRAVE_WEB_SEARCH_SECRET_KEY);
      void vscode.window.showInformationMessage("Brave Search API key removed.");
    })
  );

  return disposables;
}
