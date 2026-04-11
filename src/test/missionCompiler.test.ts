import test from "node:test";
import assert from "node:assert/strict";
import { compileMissionPreflight } from "../missions/missionCompiler";
import { buildRoleSpecificUserPromptCoreLines } from "../missions/agentDispatch/roleContextBuilder";
import { resolveExpectedDeliverableRelPathsForImplementer } from "../missions/implementerDeliverableContract";
import { createOrchestrator, balancedIntegrationPolicy } from "./missionOrchestratorTestHarness";
import type { Mission, WorkItem } from "../types";

function miniMission(prompt: string): Mission {
  return {
    id: "mission-compiler-test",
    title: "Compiler test",
    prompt,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "queued",
    activeProviderId: "ollama",
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: {
      ...balancedIntegrationPolicy,
      autoContinue: true,
      requireValidationEvidence: false,
      policyPreset: "balanced"
    },
    validationState: "pending",
    roundsCompleted: 0,
    runtime: {
      stalledHeartbeats: 0,
      autoReplans: 0,
      loopGuardTrips: 0
    }
  } as Mission;
}

test("mission compiler: safely normalizes wrong repo-root-prefixed path", async () => {
  const mission = miniMission(
    "Read autonomous_factory/docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md and summarize it."
  );
  const contract = await compileMissionPreflight(mission);
  const ref = contract.pathReferences.find((entry) => entry.rawPath.startsWith("autonomous_factory/docs/agent_execution"));
  assert.ok(ref);
  assert.equal(ref?.normalizedPath, "docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md");
  assert.equal(ref?.existence, "corrected_exists");
  assert.ok(contract.metrics.pathCorrectionsApplied >= 1);
});

test("mission compiler: separates read-only input paths from intended outputs", async () => {
  const mission = miniMission(
    [
      "Read docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md as a reference input.",
      "Create autonomous_factory/docs/generated/compiler_preflight_summary.md as the output."
    ].join("\n")
  );
  const contract = await compileMissionPreflight(mission);
  assert.ok(contract.inputPaths.includes("docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md"));
  assert.ok(contract.outputPaths.includes("docs/generated/compiler_preflight_summary.md"));
  assert.ok(!contract.outputPaths.includes("docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md"));
});

test("mission compiler: surfaces conflicting input/output semantics for the same path", async () => {
  const mission = miniMission(
    [
      "Read docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md as a reference input.",
      "Update docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md with a new summary section."
    ].join("\n")
  );
  const contract = await compileMissionPreflight(mission);
  assert.ok(
    contract.findings.some((finding) => finding.code === "path_role_conflict")
  );
  assert.ok(
    contract.ambiguousPaths.includes("docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md")
  );
});

test("mission compiler: compiled contract is available before startMission schedules execution", async () => {
  const { orchestrator, store } = await createOrchestrator(
    async () => ({ summary: "Plan.", nextWorkItems: [] }),
    async () => ({ ok: true, summary: "noop" })
  );
  const started = await orchestrator.startMission(
    "Compiler-start",
    "Read autonomous_factory/docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md and summarize it.",
    "ollama"
  );
  const mission = store.get(started.mission.id)!;
  assert.ok(mission.compiledContract);
  assert.ok(mission.events.some((event) => event.telemetryKind === "compiler_preflight"));
  assert.ok((mission.runtime?.compilerPreflightAt || 0) > 0);
});

test("mission compiler: downstream role prompts include compiled contract lines", async () => {
  const mission = miniMission(
    [
      "Read autonomous_factory/docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md as a reference input.",
      "Create docs/generated/compiler_preflight_summary.md as the output."
    ].join("\n")
  );
  mission.compiledContract = await compileMissionPreflight(mission);
  const item: WorkItem = {
    id: "w1",
    title: "Implement",
    role: "implementer",
    status: "todo",
    prompt: "Use the reference file and create the summary output."
  };
  const lines = buildRoleSpecificUserPromptCoreLines(mission, item);
  assert.ok(lines.some((line) => line.startsWith("COMPILED OBJECTIVE:")));
  assert.ok(lines.some((line) => line.startsWith("READ-ONLY INPUTS:")));
  assert.ok(lines.some((line) => line.startsWith("INTENDED OUTPUTS:")));
});

test("mission compiler: deliverable shaping excludes read-only input paths", async () => {
  const mission = miniMission(
    [
      "Read docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md as a reference input.",
      "Create docs/generated/compiler_preflight_summary.md."
    ].join("\n")
  );
  mission.compiledContract = await compileMissionPreflight(mission);
  const item: WorkItem = {
    id: "impl-1",
    title: "Create summary",
    role: "implementer",
    status: "todo",
    prompt:
      "Read docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md and create docs/generated/compiler_preflight_summary.md."
  };
  const deliverables = resolveExpectedDeliverableRelPathsForImplementer({ mission, item });
  assert.ok(deliverables.includes("docs/generated/compiler_preflight_summary.md"));
  assert.ok(!deliverables.includes("docs/agent_execution/AF_AUTONOMY_REFACTOR/IMPLEMENTATION_LEDGER.md"));
});
