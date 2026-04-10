import * as vscode from "vscode";

export class WorkspacePaths {
  private root(): vscode.Uri | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri; }

  workspaceRoot(): string | undefined {
    return this.root()?.fsPath;
  }

  storageRoot(): vscode.Uri | undefined {
    const root = this.root();
    if (!root) return undefined;
    const folder = vscode.workspace.getConfiguration().get<string>('myAi.missions.diskStoreFolder', '.my-ai-extension');
    return vscode.Uri.joinPath(root, folder);
  }

  missionsDir(): vscode.Uri | undefined {
    const base = this.storageRoot();
    return base ? vscode.Uri.joinPath(base, 'missions') : undefined;
  }

  approvalsDir(): vscode.Uri | undefined {
    const base = this.storageRoot();
    return base ? vscode.Uri.joinPath(base, 'approval-previews') : undefined;
  }

  memoryDir(): vscode.Uri | undefined {
    const base = this.storageRoot();
    return base ? vscode.Uri.joinPath(base, 'memory') : undefined;
  }

  mcpDir(): vscode.Uri | undefined {
    const base = this.storageRoot();
    return base ? vscode.Uri.joinPath(base, 'mcp') : undefined;
  }

  globalMemoryFile(): vscode.Uri | undefined {
    const dir = this.memoryDir();
    return dir ? vscode.Uri.joinPath(dir, 'global-memory.json') : undefined;
  }

  /** Cross-mission programs / roadmaps (workspace extension data). */
  programsFile(): vscode.Uri | undefined {
    const base = this.storageRoot();
    return base ? vscode.Uri.joinPath(base, "programs.json") : undefined;
  }

  mcpSessionsFile(): vscode.Uri | undefined {
    const dir = this.mcpDir();
    return dir ? vscode.Uri.joinPath(dir, 'sessions.json') : undefined;
  }

  templatesFile(): vscode.Uri | undefined {
    const base = this.storageRoot();
    return base ? vscode.Uri.joinPath(base, 'templates.json') : undefined;
  }

  externalAdaptersFile(): vscode.Uri | undefined {
    const root = this.root();
    if (!root) return undefined;
    const rel = vscode.workspace.getConfiguration().get<string>('myAi.tools.externalAdaptersFile', '.my-ai-extension/tools/adapters.json');
    return vscode.Uri.joinPath(root, rel);
  }
}
