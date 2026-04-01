import * as vscode from "vscode";
import { ChatContext } from "../types";

export class ContextCollector {
  async collect(): Promise<ChatContext> {
    const editor = vscode.window.activeTextEditor;
    const cfg = vscode.workspace.getConfiguration();
    const sendSelection = cfg.get<boolean>("myAi.sendSelection", true);
    const sendActiveFile = cfg.get<boolean>("myAi.sendActiveFile", true);
    const sendDiagnostics = cfg.get<boolean>("myAi.sendDiagnostics", true);
    const uri = editor?.document.uri;
    const diagnostics = uri && sendDiagnostics
      ? vscode.languages.getDiagnostics(uri).map((d) => ({
          message: d.message,
          severity: String(d.severity),
          line: d.range.start.line
        }))
      : [];

    return {
      workspaceName: vscode.workspace.name,
      fileName: editor?.document.fileName,
      selection: editor && sendSelection && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined,
      activeFileText: editor && sendActiveFile ? editor.document.getText() : undefined,
      diagnostics,
      workspaceFolders: vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) || []
    };
  }
}
