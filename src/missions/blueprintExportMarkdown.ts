import type { PreBlueprintClarificationState } from "../types";
import type { MissionBlueprint } from "./missionBlueprintTypes";

/** Safe filename segment from mission title. */
export function slugifyMissionTitleForFile(title: string, maxLen = 48): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (s || "mission").slice(0, maxLen);
}

/**
 * Human-readable markdown for operators (version control, sharing, audit).
 * When `pre` is set (pre-blueprint Q&A was used), questions and operator answers are included for traceability.
 */
export function missionBlueprintToMarkdown(
  missionTitle: string,
  bp: MissionBlueprint,
  pre?: PreBlueprintClarificationState
): string {
  const lines: string[] = [];
  lines.push(`# Mission blueprint: ${missionTitle}`);
  lines.push("");
  lines.push("## Metadata");
  lines.push(`- **Blueprint status:** ${bp.status}`);
  lines.push(`- **Created:** ${new Date(bp.createdAt).toISOString()}`);
  if (bp.approvedAt) {
    lines.push(`- **Approved:** ${new Date(bp.approvedAt).toISOString()}`);
  }
  lines.push("");
  if (pre && (pre.questions.length > 0 || (pre.answersMarkdown && pre.answersMarkdown.trim()))) {
    lines.push("## Pre-blueprint clarification");
    lines.push(`- **Status:** \`${pre.status}\``);
    lines.push("");
    if (pre.questions.length > 0) {
      lines.push("### Questions");
      pre.questions.forEach((q, i) => {
        lines.push(`${i + 1}. ${q}`);
      });
      lines.push("");
    }
    if (pre.answersMarkdown?.trim()) {
      lines.push("### Operator answers");
      lines.push(pre.answersMarkdown.trim());
      lines.push("");
    }
  }
  lines.push("## Requirements summary");
  lines.push(bp.requirementsSummary.trim() || "_(empty)_");
  lines.push("");
  lines.push("## Architecture summary");
  lines.push(bp.architectureSummary.trim() || "_(empty)_");
  lines.push("");
  if (bp.goalEndState?.trim()) {
    lines.push("## End state (goal-first)");
    lines.push(bp.goalEndState.trim());
    lines.push("");
  }
  if (bp.approachOptions?.length) {
    lines.push("## Approaches considered");
    bp.approachOptions.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
    lines.push("");
  }
  if (bp.chosenApproach?.trim()) {
    lines.push("## Chosen approach");
    lines.push(bp.chosenApproach.trim());
    lines.push("");
  }
  lines.push("## Steps");
  for (const s of bp.steps) {
    const opt = s.optional ? " _(optional)_" : "";
    lines.push(`### ${s.id}: ${s.title}${opt}`);
    lines.push(`- **Role hint:** \`${s.roleHint}\``);
    lines.push(`- **Step status:** \`${s.status}\``);
    if (s.dependsOn?.length) {
      lines.push(`- **Depends on:** ${s.dependsOn.map((d) => `\`${d}\``).join(", ")}`);
    }
    lines.push("");
    lines.push(s.summary.trim() || "_(no summary)_");
    lines.push("");
    if (s.acceptanceCriteria.length) {
      lines.push("**Acceptance criteria**");
      for (const c of s.acceptanceCriteria) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }
  }
  if (bp.amendments?.length) {
    lines.push("## Amendments");
    for (const a of bp.amendments) {
      lines.push(`### ${new Date(a.at).toISOString()}`);
      lines.push(a.reason);
      lines.push(`- Added: ${a.addedStepIds.join(", ") || "—"}`);
      if (a.modifiedStepIds?.length) {
        lines.push(`- Modified: ${a.modifiedStepIds.join(", ")}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
