import type { AgentRole, WorkItem } from "../types";
import type { BlueprintStep, MissionBlueprint } from "./missionBlueprintTypes";
import { uid } from "../util";

function roleFromHint(hint: BlueprintStep["roleHint"]): AgentRole {
  return hint;
}

/** Prefix first work item so the queue inherits blueprint-level goal-first context. */
export function goalFirstBlueprintPromptPrefix(bp: MissionBlueprint): string {
  const blocks: string[] = [];
  if (bp.goalEndState?.trim()) blocks.push(`Agreed end state: ${bp.goalEndState.trim()}`);
  if (bp.approachOptions?.length) {
    blocks.push(`Approaches considered:\n${bp.approachOptions.map((o, i) => `${i + 1}. ${o}`).join("\n")}`);
  }
  if (bp.chosenApproach?.trim()) blocks.push(`Chosen approach (follow this): ${bp.chosenApproach.trim()}`);
  if (!blocks.length) return "";
  return `[Blueprint goal-first context]\n${blocks.join("\n\n")}\n\n---\n\n`;
}

/**
 * Topological order of blueprint steps (dependencies first). Cycle → throws.
 */
export function topologicalBlueprintSteps(steps: BlueprintStep[]): BlueprintStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const out: BlueprintStep[] = [];

  function visit(id: string): void {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error(`Blueprint dependency cycle at step ${id}`);
    visiting.add(id);
    const s = byId.get(id);
    if (!s) throw new Error(`Unknown blueprint step id: ${id}`);
    for (const d of s.dependsOn || []) visit(d);
    visiting.delete(id);
    done.add(id);
    out.push(s);
  }

  for (const s of steps) visit(s.id);
  return out;
}

/**
 * Build `WorkItem[]` from an approved blueprint. Each item carries `blueprintStepId` for progress sync.
 */
export function synthesizeWorkItemsFromBlueprint(blueprint: MissionBlueprint): WorkItem[] {
  const ordered = topologicalBlueprintSteps(blueprint.steps);
  const stepIdToWorkId = new Map<string, string>();
  const prefix = goalFirstBlueprintPromptPrefix(blueprint);

  const items: WorkItem[] = [];
  for (const step of ordered) {
    const wid = uid("work");
    stepIdToWorkId.set(step.id, wid);
    const dependsOn = (step.dependsOn || []).map((d) => stepIdToWorkId.get(d)).filter((x): x is string => Boolean(x));
    const ac = step.acceptanceCriteria.length ? `\n\nAcceptance criteria:\n- ${step.acceptanceCriteria.join("\n- ")}` : "";
    let prompt = `${step.summary}${ac}`.trim() || step.title;
    if (!items.length && prefix) prompt = `${prefix}${prompt}`;
    items.push({
      id: wid,
      title: step.title,
      role: roleFromHint(step.roleHint),
      status: "todo",
      prompt,
      dependsOn: dependsOn.length ? dependsOn : undefined,
      blueprintStepId: step.id,
      requiredForCompletion: step.optional ? false : undefined,
      ...(step.scopeSummary?.trim() ? { scopeSummary: step.scopeSummary.trim().slice(0, 2000) } : {}),
      ...(step.validationHint?.trim() ? { validationHint: step.validationHint.trim().slice(0, 2000) } : {}),
      ...(step.touchesProtectedPath ? { touchesProtectedPath: true } : {})
    });
  }
  return items;
}
