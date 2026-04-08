import type { MissionBlueprint, BlueprintStep } from "./missionBlueprintTypes";
import { topologicalBlueprintSteps } from "./blueprintSynthesis";

export type BlueprintReadinessVerdict =
  | { ok: true }
  | { ok: false; issues: string[] };

function hasText(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function uniqueIds(steps: BlueprintStep[]): { ok: true } | { ok: false; dupes: string[] } {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const s of steps) {
    if (seen.has(s.id)) dupes.add(s.id);
    seen.add(s.id);
  }
  return dupes.size ? { ok: false, dupes: [...dupes].sort() } : { ok: true };
}

/**
 * Deterministic host-side sanity checks before allowing operator approval.
 * This is intentionally shallow: it catches structurally-invalid or obviously-unexecutable plans,
 * not “quality” or correctness.
 */
export function validateBlueprintReadinessForApproval(bp: MissionBlueprint): BlueprintReadinessVerdict {
  const issues: string[] = [];

  if (bp.version !== 1) issues.push(`Unsupported blueprint version: ${String((bp as any).version)}`);
  if (!hasText(bp.requirementsSummary)) issues.push("Missing requirementsSummary.");
  if (!hasText(bp.architectureSummary)) issues.push("Missing architectureSummary.");

  if (!Array.isArray(bp.steps) || bp.steps.length === 0) {
    issues.push("Blueprint has no steps.");
    return { ok: false, issues };
  }

  const uniq = uniqueIds(bp.steps);
  if (!uniq.ok) issues.push(`Duplicate step ids: ${uniq.dupes.join(", ")}`);

  for (const s of bp.steps) {
    if (!hasText(s.id)) issues.push("Step missing id.");
    if (!hasText(s.title)) issues.push(`Step ${s.id || "(unknown)"} missing title.`);
    if (!hasText(s.summary)) issues.push(`Step ${s.id || "(unknown)"} missing summary.`);
    if (!Array.isArray(s.acceptanceCriteria) || s.acceptanceCriteria.length === 0) {
      issues.push(`Step ${s.id || "(unknown)"} missing acceptanceCriteria.`);
    }
    if (Array.isArray(s.dependsOn) && s.dependsOn.includes(s.id)) {
      issues.push(`Step ${s.id || "(unknown)"} depends on itself.`);
    }
  }

  // Dependency reference / cycle check (reuses canonical topo logic).
  try {
    topologicalBlueprintSteps(bp.steps);
  } catch (e) {
    const msg = (e as Error | undefined)?.message || String(e);
    issues.push(`Invalid step dependency graph: ${msg}`);
  }

  return issues.length ? { ok: false, issues } : { ok: true };
}

