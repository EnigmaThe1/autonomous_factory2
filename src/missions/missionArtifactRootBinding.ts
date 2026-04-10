/**
 * Canonical binding of a mission's artifact root (e.g. unique run folder) into mission runtime.
 * Agents may emit: MISSION_ARTIFACT_ROOT: <workspace-relative-path>
 */

import type { MissionStore } from "./MissionStore";

const LINE_RE = /^MISSION_ARTIFACT_ROOT:\s*(\S+)/im;

export function extractMissionArtifactRootLine(summary: string): string | undefined {
  const m = String(summary || "").match(LINE_RE);
  const raw = m?.[1]?.trim();
  return raw || undefined;
}

/** Normalize to forward slashes, no leading slash, reject traversal. */
export function normalizeMissionArtifactRootRel(raw: string): string | undefined {
  let s = String(raw || "").trim().replace(/\\/g, "/");
  if (!s || s.includes("..")) return undefined;
  s = s.replace(/^\/+/, "");
  return s || undefined;
}

export function parsePersistableArtifactRootFromSummary(summary: string): string | undefined {
  const line = extractMissionArtifactRootLine(summary);
  if (!line) return undefined;
  return normalizeMissionArtifactRootRel(line);
}

/** Persists `MISSION_ARTIFACT_ROOT:` from agent output when valid; idempotent. */
export async function persistArtifactRootFromSummaryIfNew(
  store: MissionStore,
  missionId: string,
  summary: string
): Promise<void> {
  const parsed = parsePersistableArtifactRootFromSummary(summary);
  if (!parsed) return;
  const m = store.get(missionId);
  if (!m) return;
  if (m.runtime?.resolvedArtifactRootRelative === parsed) return;
  await store.updateRuntime(missionId, { resolvedArtifactRootRelative: parsed });
  await store.saveEvent(missionId, {
    level: "info",
    source: "orchestrator",
    message: `Canonical mission artifact root bound: ${parsed}`
  });
}
