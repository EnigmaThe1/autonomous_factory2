import type { BlueprintStep, MissionBlueprint } from "./missionBlueprintTypes";

export interface ParseBlueprintResult {
  blueprint?: MissionBlueprint;
  errors: string[];
}

const ROLE_HINTS = new Set(["planner", "researcher", "implementer", "reviewer", "validator", "architect"]);

export function extractJsonObject(text: string): string | undefined {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text.trim();
  const start = candidate.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return undefined;
}

function normalizeRoleHint(raw: unknown): BlueprintStep["roleHint"] {
  const s = typeof raw === "string" ? raw.toLowerCase() : "implementer";
  return ROLE_HINTS.has(s) ? (s as BlueprintStep["roleHint"]) : "implementer";
}

/**
 * Parse model output into `MissionBlueprint`. Host-owned caps (defaults safe for prompts).
 */
export function parseBlueprintModelOutput(
  text: string,
  opts?: { maxSteps?: number; maxFieldChars?: number; now?: number }
): ParseBlueprintResult {
  const errors: string[] = [];
  const maxSteps = Math.min(80, Math.max(1, opts?.maxSteps ?? 40));
  const maxField = Math.min(32_000, Math.max(200, opts?.maxFieldChars ?? 8_000));
  const now = opts?.now ?? Date.now();

  const jsonStr = extractJsonObject(text);
  if (!jsonStr) {
    errors.push("No JSON object found in model output.");
    return { errors };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr) as unknown;
  } catch (e) {
    errors.push(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
    return { errors };
  }

  if (!raw || typeof raw !== "object") {
    errors.push("Blueprint root must be an object.");
    return { errors };
  }

  const o = raw as Record<string, unknown>;
  const req = typeof o.requirementsSummary === "string" ? o.requirementsSummary.trim() : "";
  const arch = typeof o.architectureSummary === "string" ? o.architectureSummary.trim() : "";
  const goalEndStateRaw = typeof o.goalEndState === "string" ? o.goalEndState.trim() : "";
  const chosenApproachRaw = typeof o.chosenApproach === "string" ? o.chosenApproach.trim() : "";
  const approachRaw = o.approachOptions;
  const approachOptionsParsed = Array.isArray(approachRaw)
    ? approachRaw
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 2000))
        .slice(0, 8)
    : [];
  if (!req) errors.push("Missing requirementsSummary.");
  if (!arch) errors.push("Missing architectureSummary.");
  if (req.length > maxField) errors.push("requirementsSummary exceeds max length.");
  if (arch.length > maxField) errors.push("architectureSummary exceeds max length.");
  if (goalEndStateRaw.length > maxField) errors.push("goalEndState exceeds max length.");
  if (chosenApproachRaw.length > maxField) errors.push("chosenApproach exceeds max length.");

  const stepsRaw = o.steps;
  if (!Array.isArray(stepsRaw)) {
    errors.push("steps must be an array.");
    return { errors };
  }
  if (stepsRaw.length > maxSteps) {
    errors.push(`Too many steps (max ${maxSteps}).`);
  }

  const steps: BlueprintStep[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < Math.min(stepsRaw.length, maxSteps); i++) {
    const row = stepsRaw[i];
    if (!row || typeof row !== "object") {
      errors.push(`steps[${i}] must be an object.`);
      continue;
    }
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    if (!id || !title) {
      errors.push(`steps[${i}]: id and title required.`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`Duplicate step id: ${id}`);
      continue;
    }
    seenIds.add(id);
    const acRaw = r.acceptanceCriteria;
    const acceptanceCriteria = Array.isArray(acRaw)
      ? acRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
      : [];
    if (!acceptanceCriteria.length) {
      errors.push(`steps[${i}]: acceptanceCriteria must be a non-empty string array.`);
    }
    const depRaw = r.dependsOn;
    const dependsOn = Array.isArray(depRaw)
      ? depRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
      : undefined;
    const scopeRaw = typeof r.scopeSummary === "string" ? r.scopeSummary.trim() : "";
    const valRaw = typeof r.validationHint === "string" ? r.validationHint.trim() : "";
    steps.push({
      id,
      title: title.slice(0, maxField),
      summary: summary.slice(0, maxField),
      roleHint: normalizeRoleHint(r.roleHint),
      dependsOn: dependsOn?.length ? dependsOn : undefined,
      acceptanceCriteria: acceptanceCriteria.map((c) => c.slice(0, 2000)),
      status: "pending",
      optional: r.optional === true,
      ...(scopeRaw ? { scopeSummary: scopeRaw.slice(0, 2000) } : {}),
      ...(valRaw ? { validationHint: valRaw.slice(0, 2000) } : {})
    });
  }

  for (const s of steps) {
    if (s.dependsOn) {
      for (const d of s.dependsOn) {
        if (!seenIds.has(d)) errors.push(`Step ${s.id} depends on unknown id ${d}`);
      }
    }
  }

  if (!steps.length) errors.push("steps array must contain at least one step.");
  if (errors.length) return { errors };

  const blueprint: MissionBlueprint = {
    version: 1,
    createdAt: now,
    status: "draft",
    requirementsSummary: req.slice(0, maxField),
    architectureSummary: arch.slice(0, maxField),
    steps,
    amendments: []
  };
  if (goalEndStateRaw) blueprint.goalEndState = goalEndStateRaw.slice(0, maxField);
  if (approachOptionsParsed.length) blueprint.approachOptions = approachOptionsParsed;
  if (chosenApproachRaw) blueprint.chosenApproach = chosenApproachRaw.slice(0, maxField);

  return { blueprint, errors: [] };
}
