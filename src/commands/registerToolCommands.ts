import * as vscode from "vscode";
import { ToolRegistry } from "../tools/ToolRegistry";
import { McpRegistry } from "../tools/McpRegistry";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";

export function registerToolCommands(
  tools: ToolRegistry,
  mcp: McpRegistry,
  globalMemory: GlobalMemoryStore
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

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

  return disposables;
}
