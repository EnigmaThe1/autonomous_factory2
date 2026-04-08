import * as vscode from "vscode";
import type { Mission } from "../types";

/**
 * Raw configured cap (0 = unlimited). When > 0 and the mission uses a local LLM provider,
 * {@link effectiveWebResearchMaxCallsPerMission} can treat the cap as unlimited.
 */
export function parseLocalLlmProviderIds(cfg: vscode.WorkspaceConfiguration): Set<string> {
  const raw = String(cfg.get<string>("myAi.webResearch.localLlmProviderIds", "ollama") || "ollama");
  const parts = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parts.length ? parts : ["ollama"]);
}

export function missionUsesLocalLlmForWebBudget(mission: Mission | undefined, cfg: vscode.WorkspaceConfiguration): boolean {
  if (!mission) return false;
  if (!cfg.get<boolean>("myAi.webResearch.unlimitedBudgetForLocalLlm", true)) return false;
  const pid = (mission.activeProviderId || "").toLowerCase().trim();
  if (!pid) return false;
  return parseLocalLlmProviderIds(cfg).has(pid);
}

/**
 * Effective max successful webSearch/fetchWebPage calls per mission (0 = unlimited).
 */
export function effectiveWebResearchMaxCallsPerMission(
  mission: Mission | undefined,
  cfg: vscode.WorkspaceConfiguration
): number {
  const configured = Math.max(0, cfg.get<number>("myAi.webResearch.maxCallsPerMission", 0));
  if (configured === 0) return 0;
  if (missionUsesLocalLlmForWebBudget(mission, cfg)) return 0;
  return configured;
}
