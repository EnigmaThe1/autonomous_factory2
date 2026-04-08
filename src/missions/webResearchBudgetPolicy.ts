import * as vscode from "vscode";
import type { Mission } from "../types";

/**
 * Provider ids (e.g. `ollama`) that mean “LLM runs on this machine — no token bill from us.”
 * Used to relax **extension-side** web research throttles (call caps, search cooldown), not your electricity bill.
 *
 * Note: we key off `mission.activeProviderId` (the provider you chose when starting the mission).
 * If you ever split providers by role in routing, only this default is considered here.
 */
export function parseLocalLlmProviderIds(cfg: vscode.WorkspaceConfiguration): Set<string> {
  const raw = String(cfg.get<string>("myAi.webResearch.localLlmProviderIds", "ollama") || "ollama");
  const parts = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parts.length ? parts : ["ollama"]);
}

/** True when the mission’s primary provider is treated as a local LLM and economy relaxations apply. */
export function missionUsesLocalLlmEconomy(mission: Mission | undefined, cfg: vscode.WorkspaceConfiguration): boolean {
  if (!mission) return false;
  if (!cfg.get<boolean>("myAi.webResearch.unlimitedBudgetForLocalLlm", true)) return false;
  const pid = (mission.activeProviderId || "").toLowerCase().trim();
  if (!pid) return false;
  return parseLocalLlmProviderIds(cfg).has(pid);
}

/** @deprecated Use {@link missionUsesLocalLlmEconomy} — same behavior, clearer name. */
export function missionUsesLocalLlmForWebBudget(
  mission: Mission | undefined,
  cfg: vscode.WorkspaceConfiguration
): boolean {
  return missionUsesLocalLlmEconomy(mission, cfg);
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
  if (missionUsesLocalLlmEconomy(mission, cfg)) return 0;
  return configured;
}

/**
 * `myAi.webSearch.minIntervalMs` is for fair use / shared APIs. Local-LLM missions skip it when economy relaxations apply.
 */
export function effectiveWebSearchMinIntervalMs(
  mission: Mission | undefined,
  cfg: vscode.WorkspaceConfiguration
): number {
  const raw = Math.max(0, cfg.get<number>("myAi.webSearch.minIntervalMs", 0));
  if (missionUsesLocalLlmEconomy(mission, cfg)) return 0;
  return raw;
}
