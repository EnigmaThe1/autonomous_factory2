import * as vscode from "vscode";
import type { Mission } from "../types";
import { missionBlueprintToMarkdown, slugifyMissionTitleForFile } from "./blueprintExportMarkdown";

/**
 * Prompt for a path under the workspace and write the mission blueprint as markdown.
 */
export type ExportMissionBlueprintResult =
  | { ok: true; message: string; exportedUri: vscode.Uri }
  | { ok: false; message: string };

export async function exportMissionBlueprintToWorkspaceFile(mission: Mission): Promise<ExportMissionBlueprintResult> {
  if (!mission.blueprint) {
    return { ok: false, message: "This mission has no blueprint." };
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return { ok: false, message: "Open a workspace folder to export the blueprint." };
  }
  const base = folders[0]!.uri;
  const slug = slugifyMissionTitleForFile(mission.title);
  const shortId = mission.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "mission";
  const defaultUri = vscode.Uri.joinPath(base, `${slug}-${shortId}-blueprint.md`);
  const picked = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { Markdown: ["md"] },
    saveLabel: "Export blueprint"
  });
  if (!picked) {
    return { ok: false, message: "Export cancelled." };
  }
  const md = missionBlueprintToMarkdown(mission.title, mission.blueprint);
  await vscode.workspace.fs.writeFile(picked, new TextEncoder().encode(md));
  return { ok: true, message: `Blueprint exported to ${picked.fsPath}`, exportedUri: picked };
}
