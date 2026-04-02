import type { AgentRole, WorkItem } from "../types";
import type { BlueprintStep, MissionBlueprint } from "./missionBlueprintTypes";
import { uid } from "../util";

function roleFromHint(hint: BlueprintStep["roleHint"]): AgentRole {
  return hint;
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

  const items: WorkItem[] = [];
  for (const step of ordered) {
    const wid = uid("work");
    stepIdToWorkId.set(step.id, wid);
    const dependsOn = (step.dependsOn || []).map((d) => stepIdToWorkId.get(d)).filter((x): x is string => Boolean(x));
    const ac = step.acceptanceCriteria.length ? `\n\nAcceptance criteria:\n- ${step.acceptanceCriteria.join("\n- ")}` : "";
    const prompt = `${step.summary}${ac}`.trim();
    items.push({
      id: wid,
      title: step.title,
      role: roleFromHint(step.roleHint),
      status: "todo",
      prompt: prompt || step.title,
      dependsOn: dependsOn.length ? dependsOn : undefined,
      blueprintStepId: step.id,
      requiredForCompletion: step.optional ? false : undefined
    });
  }
  return items;
}
