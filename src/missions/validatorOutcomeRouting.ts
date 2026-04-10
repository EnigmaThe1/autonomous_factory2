import type { AgentTurnResult, WorkItem } from "../types";
import type { ValidatorStructuredOutcome, ValidatorSuspectedClass } from "./reviewValidatorOutcomeContracts";
import { uid } from "../util";

function hasImplementerFollowUp(items: WorkItem[]): boolean {
  return items.some((w) => w.role === "implementer");
}

/** Insert researcher before implementer remediation so environment/tooling hypotheses are gathered first. */
export function prependResearcherBeforeValidatorRemediationChain(
  validatorItem: WorkItem,
  summary: string,
  chain: WorkItem[]
): WorkItem[] {
  if (!chain.length || chain[0].role !== "implementer") return chain;
  const rid = uid("work");
  const researcher: WorkItem = {
    id: rid,
    title: "Investigate validator failure context",
    role: "researcher",
    status: "todo",
    dependsOn: [validatorItem.id],
    prompt: [
      "Validator reported FAIL. Determine whether failures point to environment/tooling vs product code.",
      "",
      "Context:",
      summary.slice(0, 4000)
    ].join("\n\n")
  };
  const impl = { ...chain[0], dependsOn: [rid] };
  return [researcher, impl, ...chain.slice(1)];
}

export function buildValidatorFailRemediationItems(
  validatorItem: WorkItem,
  summary: string,
  existingNext: WorkItem[]
): WorkItem[] {
  if (hasImplementerFollowUp(existingNext)) return existingNext;
  const clip = summary.slice(0, 1200);
  const impl: WorkItem = {
    id: uid("work"),
    title: `Address validator findings (${validatorItem.title})`,
    role: "implementer",
    status: "todo",
    dependsOn: [validatorItem.id],
    prompt: [
      "The validator reported FAIL (structured or narrative). Make bounded fixes with evidence.",
      "",
      "Validator output excerpt:",
      clip
    ].join("\n\n")
  };
  const rev: WorkItem = {
    id: uid("work"),
    title: `Re-review after validator failure (${validatorItem.title})`,
    role: "reviewer",
    status: "todo",
    dependsOn: [impl.id],
    prompt:
      "Review the remediation for the validator-reported gaps. Emit REVIEW_OUTCOME: approved or revision_required with REVIEW_FINDINGS if needed."
  };
  const val: WorkItem = {
    id: uid("work"),
    title: `Re-validate after remediation (${validatorItem.title})`,
    role: "validator",
    status: "todo",
    dependsOn: [rev.id],
    prompt:
      "Re-run validation. Emit VALIDATION_OUTCOME: pass|fail|inconclusive and COMPLETE: only when truly done."
  };
  return [...existingNext, impl, rev, val];
}

export function buildValidatorInconclusiveFollowUps(
  validatorItem: WorkItem,
  suspectedClass?: ValidatorSuspectedClass
): WorkItem[] {
  const resId = uid("work");
  const envHint =
    suspectedClass === "environment"
      ? "Suspected class is ENVIRONMENT: focus on toolchain, paths, services, and reproducibility before asking for code changes."
      : suspectedClass === "code"
        ? "Suspected class is CODE: focus on defect hypotheses and minimal repro evidence."
        : "Root cause is unclear: gather evidence and separate code vs environment hypotheses.";
  const researcher: WorkItem = {
    id: resId,
    title: "Research: inconclusive validation",
    role: "researcher",
    status: "todo",
    dependsOn: [validatorItem.id],
    prompt: [
      "The previous validator step ended INCONCLUSIVE (could not certify pass or fail).",
      envHint,
      "",
      "Diagnose what evidence is missing, what to measure next, and emit MEMORY: findings for planner/implementer.",
      "Do not claim mission completion."
    ].join("\n\n")
  };
  const planner: WorkItem = {
    id: uid("work"),
    title: "Plan: resolve inconclusive validation",
    role: "planner",
    status: "todo",
    dependsOn: [resId],
    prompt: [
      "Read researcher MEMORY from the inconclusive-validation investigation.",
      "Emit minimal WORK: lines (implementer/researcher) to close the evidence gap, then ensure review+validate can rerun."
    ].join("\n\n")
  };
  return [researcher, planner];
}

/**
 * Apply structured VALIDATION_OUTCOME lines on top of parsed validator output.
 * Structured lines win over incidental COMPLETE when they conflict.
 */
export function applyValidatorStructuredOutcomeToTurn(
  validatorItem: WorkItem,
  structured: ValidatorStructuredOutcome | undefined,
  result: AgentTurnResult
): AgentTurnResult {
  if (!structured) return result;
  const next = [...(result.nextWorkItems || [])];

  if (structured.outcome === "pass") {
    return {
      ...result,
      decision: "complete",
      nextWorkItems: [],
      markStatus: "done"
    };
  }

  if (structured.outcome === "fail") {
    const merged = buildValidatorFailRemediationItems(validatorItem, result.summary || "", next);
    return {
      ...result,
      decision: "needs_followup",
      nextWorkItems: merged,
      markStatus: "done"
    };
  }

  if (structured.outcome === "inconclusive") {
    const extra = buildValidatorInconclusiveFollowUps(validatorItem, structured.suspectedClass);
    return {
      ...result,
      decision: "needs_followup",
      nextWorkItems: [...next, ...extra],
      markStatus: "done"
    };
  }

  return result;
}
