import * as vscode from "vscode";
import type { AgentRole, WorkItem } from "../types";
import { gitCommitTrackedChanges } from "../tools/GitToolProvider";

export type MissionGitCheckpointMode = "off" | "implementer_only" | "all_completed_roles";

export function resolveMissionGitCheckpointMode(): MissionGitCheckpointMode {
  const v = vscode.workspace.getConfiguration().get<string>("myAi.missions.gitCheckpointMode", "off");
  if (v === "implementer_only" || v === "all_completed_roles") return v;
  return "off";
}

/**
 * After a work item completes `done`, optionally commit **tracked** changes only (`git add -u`).
 * Respects `myAi.missions.gitCheckpointMode`. Never throws to caller.
 */
export async function maybeMissionGitCheckpointAfterWorkItem(input: {
  role: AgentRole;
  terminalStatus: WorkItem["status"];
  missionId: string;
  missionTitle: string;
  workItemId: string;
  workItemTitle: string;
}): Promise<{ ran: boolean; summary?: string; ok?: boolean }> {
  const mode = resolveMissionGitCheckpointMode();
  if (mode === "off") return { ran: false };
  if (input.terminalStatus !== "done") return { ran: false };
  if (mode === "implementer_only" && input.role !== "implementer") return { ran: false };

  const shortMission = input.missionId.length > 10 ? input.missionId.slice(-10) : input.missionId;
  const msg = `[my-ai mission] ${input.missionTitle.slice(0, 80)} — ${input.workItemTitle.slice(0, 100)} (${shortMission} / ${input.workItemId.slice(-8)})`;
  try {
    const r = await gitCommitTrackedChanges(msg.slice(0, 500));
    return { ran: true, summary: r.summary, ok: r.ok };
  } catch (e) {
    return { ran: true, ok: false, summary: e instanceof Error ? e.message : String(e) };
  }
}
