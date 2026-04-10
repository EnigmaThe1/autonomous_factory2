/**
 * Mission blueprint planning mode (replaces legacy boolean `myAi.missions.blueprintMode`).
 * - off: legacy dynamic planner queue (no structured blueprint pass).
 * - soft: structured blueprint with bounded repair; may fall back to dynamic decomposition.
 * - hard: structured blueprint; parse/readiness then operator approval (when configured) before synthesis.
 */

export type MissionBlueprintMode = "off" | "soft" | "hard";

/**
 * Normalize workspace setting value. Legacy `true` maps to **soft** (structured plan without
 * mandating the old “always pause for approval” semantics unless mode is **hard**).
 */
export function normalizeBlueprintModeSetting(raw: unknown): MissionBlueprintMode {
  if (raw === "hard") return "hard";
  if (raw === "soft") return "soft";
  if (raw === "off") return "off";
  if (raw === false || raw === "false" || raw === 0 || raw === "0") return "off";
  if (raw === true || raw === "true" || raw === 1 || raw === "1" || raw === "on") return "soft";
  if (typeof raw === "string" && raw.trim().toLowerCase() === "legacy") return "soft";
  return "off";
}

export function blueprintStructuredFlowEnabled(mode: MissionBlueprintMode): boolean {
  return mode === "soft" || mode === "hard";
}

/** In hard mode, honor `myAi.missions.requireBlueprintApproval`; soft never blocks on approval gate. */
export function effectiveRequireBlueprintApproval(mode: MissionBlueprintMode, requireFromConfig: boolean): boolean {
  return mode === "hard" && requireFromConfig;
}
