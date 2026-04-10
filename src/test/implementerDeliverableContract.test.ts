import test from "node:test";
import assert from "node:assert/strict";
import { resolveExpectedDeliverableRelPathsForImplementer } from "../missions/implementerDeliverableContract";
import type { Mission, WorkItem } from "../types";

function mission(prompt: string, runtime?: Mission["runtime"]): Mission {
  return {
    id: "m-deliv",
    title: "deliverable",
    prompt,
    createdAt: 1,
    updatedAt: 1,
    status: "queued",
    activeProviderId: "ollama",
    queue: [],
    memory: [],
    approvals: [],
    checkpoints: [],
    events: [],
    currentStep: 0,
    roundsCompleted: 0,
    validationState: "pending",
    policy: {
      closureRequired: true,
      requireReviewerBeforeComplete: true,
      requireValidatorBeforeComplete: true,
      requireImplementerBeforeComplete: true,
      autoContinue: true,
      maxAutoRounds: 10,
      minCompletedWorkItems: 1,
      stallReplanThreshold: 3
    },
    runtime
  } as Mission;
}

function implementerItem(summaryPrompt = "Implement the next bounded phase work."): WorkItem {
  return {
    id: "w-deliv",
    title: "Implement",
    role: "implementer",
    status: "todo",
    prompt: summaryPrompt
  };
}

test("resolveExpectedDeliverableRelPathsForImplementer resolves phase-scoped placeholders from bound mission root", () => {
  const m = mission(
    [
      "Phase 0 - Root binding",
      "- <MISSION_ROOT>/00_run_binding.md",
      "- <MISSION_ROOT>/00_scope_guard.md",
      "Phase 1 - Initial outputs",
      "- <MISSION_ROOT>/plans/01_execution_plan.md",
      "- <MISSION_ROOT>/phase_outputs/phase1/01_root_resolution_report.md",
      "- <MISSION_ROOT>/phase_outputs/phase1/02_repo_surface_scan.md",
      "Phase 2 - Later outputs",
      "- <MISSION_ROOT>/phase_outputs/phase2/03_mid_mission_status.md"
    ].join("\n"),
    { stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 0, resolvedArtifactRootRelative: "docs/run_42" }
  );
  const paths = resolveExpectedDeliverableRelPathsForImplementer({
    mission: m,
    item: implementerItem(),
    summary: "Complete Phase 0 and Phase 1 now."
  });
  assert.ok(paths.includes("docs/run_42/00_run_binding.md"));
  assert.ok(paths.includes("docs/run_42/phase_outputs/phase1/02_repo_surface_scan.md"));
  assert.ok(!paths.includes("docs/run_42/phase_outputs/phase2/03_mid_mission_status.md"));
});

test("resolveExpectedDeliverableRelPathsForImplementer can infer artifact root from concrete step evidence", () => {
  const m = mission(
    [
      "Phase 0 - Root binding",
      "- <MISSION_ROOT>/00_run_binding.md",
      "Phase 1 - Initial outputs",
      "- <MISSION_ROOT>/plans/01_execution_plan.md",
      "- <MISSION_ROOT>/phase_outputs/phase1/01_root_resolution_report.md"
    ].join("\n")
  );
  const summary = [
    "Complete Phase 0 and Phase 1 preparations.",
    "mkdir -p docs/autonomy_factory_stress_test__run_14/plans",
    "mkdir -p docs/autonomy_factory_stress_test__run_14/phase_outputs/phase1",
    "mkdir -p docs/autonomy_factory_stress_test__run_14/logs"
  ].join("\n");
  const paths = resolveExpectedDeliverableRelPathsForImplementer({
    mission: m,
    item: implementerItem(),
    summary
  });
  assert.ok(paths.includes("docs/autonomy_factory_stress_test__run_14/00_run_binding.md"));
  assert.ok(paths.includes("docs/autonomy_factory_stress_test__run_14/plans/01_execution_plan.md"));
});
