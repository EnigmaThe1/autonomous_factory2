/**
 * Mission runner autonomy: which autonomy presets auto-chain `runMission` passes after bounded step caps.
 */

/** True when hitting `maxStepsPerRun` should schedule another pass without operator Resume. */
export function autonomyModeAutoChainsRunPasses(mode: string): boolean {
  return (
    mode === "workspace_coder" ||
    mode === "workspace_autonomous" ||
    mode === "structured_autonomous"
  );
}
