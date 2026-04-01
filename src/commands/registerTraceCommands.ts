import * as vscode from "vscode";
import { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import type { TraceLevel } from "../diagnostics/traceTypes";

export function registerTraceCommands(traceLogger: ExtensionTraceLogger): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand("myAi.showTraceLog", () => {
      traceLogger.show();
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.exportTraceLog", async () => {
      const fp = await traceLogger.exportBufferToFile();
      void vscode.window.showInformationMessage(`My AI: trace exported to ${fp}`);
      const doc = await vscode.workspace.openTextDocument(fp);
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.clearTraceLog", () => {
      traceLogger.clear();
      void vscode.window.showInformationMessage("My AI: trace buffer and output channel cleared.");
    })
  );

  disposables.push(
    vscode.commands.registerCommand("myAi.setTraceLevel", async () => {
      const current = traceLogger.getConfiguredLevel();
      const picked = await vscode.window.showQuickPick(
        [
          { label: "error", description: "Errors only", detail: current === "error" ? "current" : undefined },
          { label: "info", description: "Default operator view", detail: current === "info" ? "current" : undefined },
          { label: "debug", description: "Include debug events", detail: current === "debug" ? "current" : undefined },
          { label: "trace", description: "Maximum verbosity", detail: current === "trace" ? "current" : undefined }
        ],
        { placeHolder: "Select maximum trace verbosity" }
      );
      if (!picked) return;
      const level = picked.label as TraceLevel;
      await traceLogger.setConfiguredLevel(level);
      void vscode.window.showInformationMessage(`My AI: trace level set to ${level}.`);
    })
  );

  return disposables;
}
