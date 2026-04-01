import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { classifyMcpConfigJson } from "./mcpConfigJson";

export type McpOnboardingStatus = "no_workspace" | "file_missing" | "invalid_json" | "no_servers" | "ready" | "bundled_sample_missing";

export interface McpOnboardingState {
  status: McpOnboardingStatus;
  configuredPath: string;
  resolvedAbsolutePath: string | null;
  canCreateStarter: boolean;
  hint: string;
  /** Workspace-relative path where starter file would be written (disk store + mcp.config.json). */
  starterDestinationRelative: string | null;
}

export { classifyMcpConfigJson } from "./mcpConfigJson";

function isSameNormalizedPath(a: string, b: string): boolean {
  return path.normalize(a) === path.normalize(b);
}

async function bundledSampleExists(extensionUri: vscode.Uri): Promise<boolean> {
  const bundled = vscode.Uri.joinPath(extensionUri, "examples", "mcp.sample.json");
  try {
    await vscode.workspace.fs.stat(bundled);
    return true;
  } catch {
    return false;
  }
}

export async function analyzeMcpOnboarding(extensionUri: vscode.Uri, paths: WorkspacePaths, resolvedAbsolutePath: string): Promise<McpOnboardingState> {
  const cfg = vscode.workspace.getConfiguration();
  const configuredPath = cfg.get<string>("myAi.mcp.configPath", "examples/mcp.sample.json");
  const root = paths.workspaceRoot();
  const storage = paths.storageRoot();
  const starterDestinationRelative = storage && vscode.workspace.workspaceFolders?.[0]
    ? vscode.workspace.asRelativePath(vscode.Uri.joinPath(storage, "mcp.config.json"))
    : null;

  const bundledOk = await bundledSampleExists(extensionUri);
  if (!bundledOk) {
    return {
      status: "bundled_sample_missing",
      configuredPath,
      resolvedAbsolutePath: root ? resolvedAbsolutePath : null,
      canCreateStarter: false,
      hint: "Bundled examples/mcp.sample.json is missing from the extension package. Reinstall the extension.",
      starterDestinationRelative
    };
  }

  if (!root) {
    return {
      status: "no_workspace",
      configuredPath,
      resolvedAbsolutePath: null,
      canCreateStarter: false,
      hint: "Open a workspace folder, then use Create starter MCP config to add an editable MCP JSON next to your mission store.",
      starterDestinationRelative: null
    };
  }

  try {
    await fs.access(resolvedAbsolutePath);
  } catch {
    return {
      status: "file_missing",
      configuredPath,
      resolvedAbsolutePath,
      canCreateStarter: true,
      hint: `No file at the configured path. The default points at workspace examples/mcp.sample.json, which is usually absent on a fresh clone. Create a starter file under your mission disk folder and point settings at it.`,
      starterDestinationRelative
    };
  }

  let text: string;
  try {
    text = await fs.readFile(resolvedAbsolutePath, "utf8");
  } catch {
    return {
      status: "file_missing",
      configuredPath,
      resolvedAbsolutePath,
      canCreateStarter: true,
      hint: "The MCP config path is set but the file could not be read.",
      starterDestinationRelative
    };
  }

  const starterAbs = storage ? vscode.Uri.joinPath(storage, "mcp.config.json").fsPath : "";
  const alreadyStarterFile = !!(starterAbs && isSameNormalizedPath(resolvedAbsolutePath, starterAbs));

  const cls = classifyMcpConfigJson(text);
  if (cls === "invalid_json") {
    return {
      status: "invalid_json",
      configuredPath,
      resolvedAbsolutePath,
      canCreateStarter: !alreadyStarterFile,
      hint: alreadyStarterFile
        ? "This file is already your workspace MCP config path. Fix the JSON or replace the file manually; the extension will not overwrite it from the GUI."
        : "MCP config exists but is not valid JSON. Create a starter file in your mission disk folder if that path is unused, or fix this file manually.",
      starterDestinationRelative
    };
  }
  if (cls === "no_servers") {
    return {
      status: "no_servers",
      configuredPath,
      resolvedAbsolutePath,
      canCreateStarter: !alreadyStarterFile,
      hint: alreadyStarterFile
        ? "Add at least one server entry to this MCP config. External MCP binaries and network access are still required to run them."
        : "MCP config has no servers. Add a server entry or create a starter file under your mission disk folder.",
      starterDestinationRelative
    };
  }

  return {
    status: "ready",
    configuredPath,
    resolvedAbsolutePath,
    canCreateStarter: false,
    hint: "MCP config file is present and lists at least one server. External MCP processes and credentials are still your responsibility.",
    starterDestinationRelative
  };
}

/**
 * Copy bundled sample to `<diskStoreFolder>/mcp.config.json`, then set workspace `myAi.mcp.configPath` to that relative path.
 * Does not overwrite an existing destination file.
 */
export async function createStarterMcpFromSample(extensionUri: vscode.Uri, paths: WorkspacePaths): Promise<{ workspaceRelativePath: string }> {
  const storage = paths.storageRoot();
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!storage || !folder) {
    throw new Error("Open a workspace folder before creating a starter MCP config.");
  }

  const destUri = vscode.Uri.joinPath(storage, "mcp.config.json");
  try {
    await vscode.workspace.fs.stat(destUri);
    throw new Error(
      `File already exists: ${vscode.workspace.asRelativePath(destUri)}. Delete or rename it first, or edit it manually.`
    );
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("File already exists:")) throw e;
    // absent → proceed
  }

  const srcUri = vscode.Uri.joinPath(extensionUri, "examples", "mcp.sample.json");
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(srcUri);
  } catch {
    throw new Error("Bundled MCP sample could not be read from the extension package.");
  }

  await vscode.workspace.fs.createDirectory(storage);
  await vscode.workspace.fs.writeFile(destUri, bytes);

  const workspaceRelativePath = vscode.workspace.asRelativePath(destUri);
  const cfg = vscode.workspace.getConfiguration();
  await cfg.update("myAi.mcp.configPath", workspaceRelativePath, vscode.ConfigurationTarget.Workspace);

  return { workspaceRelativePath };
}
