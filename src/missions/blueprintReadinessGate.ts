import type { MissionBlueprint, BlueprintStep } from "./missionBlueprintTypes";
import { topologicalBlueprintSteps } from "./blueprintSynthesis";

export interface BlueprintReadinessReport {
  errors: string[];
  warnings: string[];
}

export type BlueprintReadinessVerdict =
  | { ok: true; report: BlueprintReadinessReport }
  | { ok: false; report: BlueprintReadinessReport };

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
  const report: BlueprintReadinessReport = { errors: [], warnings: [] };

  if (bp.version !== 1) report.errors.push(`Unsupported blueprint version: ${String((bp as any).version)}`);
  if (!hasText(bp.requirementsSummary)) report.errors.push("Missing requirementsSummary.");
  if (!hasText(bp.architectureSummary)) report.errors.push("Missing architectureSummary.");
  if (hasText(bp.architectureSummary) && bp.architectureSummary.length < 40) {
    report.warnings.push("architectureSummary looks very short; consider adding key constraints (stack, env, boundaries).");
  }

  if (!Array.isArray(bp.steps) || bp.steps.length === 0) {
    report.errors.push("Blueprint has no steps.");
    return { ok: false, report };
  }

  const uniq = uniqueIds(bp.steps);
  if (!uniq.ok) report.errors.push(`Duplicate step ids: ${uniq.dupes.join(", ")}`);

  if (!bp.steps.some((s) => s.roleHint === "implementer")) {
    report.warnings.push("No implementer steps found (all steps are non-mutating roles). This may be intentional, but often indicates an incomplete plan.");
  }
  if (bp.steps.length > 24) {
    report.warnings.push(`Blueprint has many steps (${bp.steps.length}); consider consolidating to reduce orchestration overhead.`);
  }

  for (const s of bp.steps) {
    if (!hasText(s.id)) report.errors.push("Step missing id.");
    if (!hasText(s.title)) report.errors.push(`Step ${s.id || "(unknown)"} missing title.`);
    if (!hasText(s.summary)) report.errors.push(`Step ${s.id || "(unknown)"} missing summary.`);
    if (hasText(s.summary) && s.summary.trim().length < 20) {
      report.warnings.push(`Step ${s.id}: summary looks very short; may be underspecified.`);
    }
    if (!Array.isArray(s.acceptanceCriteria) || s.acceptanceCriteria.length === 0) {
      report.errors.push(`Step ${s.id || "(unknown)"} missing acceptanceCriteria.`);
    } else {
      for (const ac of s.acceptanceCriteria) {
        const t = typeof ac === "string" ? ac.trim() : "";
        if (!t) continue;
        if (t.length < 12) report.warnings.push(`Step ${s.id}: acceptance criteria looks too short: "${t}".`);
        if (/(^|\b)(tbd|todo|fixme)(\b|$)/i.test(t)) report.warnings.push(`Step ${s.id}: acceptance criteria contains placeholder text: "${t}".`);
      }
    }
    if (Array.isArray(s.dependsOn) && s.dependsOn.includes(s.id)) {
      report.errors.push(`Step ${s.id || "(unknown)"} depends on itself.`);
    }
  }

  // Dependency reference / cycle check (reuses canonical topo logic).
  try {
    topologicalBlueprintSteps(bp.steps);
  } catch (e) {
    const msg = (e as Error | undefined)?.message || String(e);
    report.errors.push(`Invalid step dependency graph: ${msg}`);
  }

  return report.errors.length ? { ok: false, report } : { ok: true, report };
}

