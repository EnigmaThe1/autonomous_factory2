import test from "node:test";
import assert from "node:assert/strict";
import { MissionAgentRole, type Mission } from "../types";
import {
  attachRoleDispatchMeta,
  buildRoleSpecificUserPromptCoreLines,
  isMissionToolAllowedForRole,
  missionWorkItemContextKeywords,
  researcherTargetedEnrichmentNeeded,
  shouldAttachOptionalContextLabel
} from "../missions/agentDispatch";
import {
  assessToolFailureEvidence,
  buildWorkItemEvidenceContract,
  classifyToolEvidenceNecessity,
  shouldPreferRepositoryHistoryEvidence,
  shouldPreferArtifactScopedEvidence
} from "../missions/missionEvidenceContract";

function minimalMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    title: "T",
    prompt: "Goal: ship feature X.",
    status: "queued",
    memory: [],
    queue: [
      { id: "q1", title: "Plan", role: MissionAgentRole.Planner, status: "todo", prompt: "p" },
      { id: "q2", title: "Impl", role: MissionAgentRole.Implementer, status: "done", prompt: "i" }
    ],
    routing: {},
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
    activeProviderId: "ollama",
    activeModel: "m",
    createdAt: 1,
    updatedAt: 1,
    validationState: "unknown",
    ...overrides
  } as Mission;
}

test("isMissionToolAllowedForRole: planner cannot writeFile; implementer can", () => {
  assert.equal(isMissionToolAllowedForRole(MissionAgentRole.Planner, "writeFile"), false);
  assert.equal(isMissionToolAllowedForRole(MissionAgentRole.Implementer, "writeFile"), true);
  assert.equal(isMissionToolAllowedForRole(MissionAgentRole.Reviewer, "runTests"), false);
  assert.equal(isMissionToolAllowedForRole(MissionAgentRole.Validator, "runTests"), true);
});

test("missionWorkItemContextKeywords: planner gets no rg keywords", () => {
  const m = minimalMission();
  const item = { id: "w", title: "P", role: MissionAgentRole.Planner, status: "todo", prompt: "long complicated planning words here" };
  assert.deepEqual(missionWorkItemContextKeywords(m, item as any), []);
});

test("researcherTargetedEnrichmentNeeded: true for failure investigation purpose", () => {
  const m = minimalMission({ blocker: "tool failed" });
  const item = {
    id: "w",
    title: "Diagnose",
    role: MissionAgentRole.Researcher,
    status: "todo",
    prompt: "p",
    workItemPurpose: "failure_investigation_diagnose" as const
  };
  assert.equal(researcherTargetedEnrichmentNeeded(item as any, m), true);
});

test("buildRoleSpecificUserPromptCoreLines: planner includes QUEUE summary", () => {
  const m = minimalMission();
  const item = { id: "w", title: "Plan tranche", role: MissionAgentRole.Planner, status: "todo", prompt: "Sequence work." };
  const lines = buildRoleSpecificUserPromptCoreLines(m, item as any);
  const joined = lines.join("\n");
  assert.match(joined, /QUEUE \(work items\)/);
  assert.match(joined, /\[todo\]/);
});

test("buildRoleSpecificUserPromptCoreLines: reviewer mentions REVIEW TARGET", () => {
  const m = minimalMission({ filesModified: ["src/a.ts"] });
  const item = { id: "w", title: "Review", role: MissionAgentRole.Reviewer, status: "todo", prompt: "Check quality." };
  const lines = buildRoleSpecificUserPromptCoreLines(m, item as any);
  assert.ok(lines.some((l) => l.includes("REVIEW TARGET")));
});

test("reviewer evidence contract prefers artifact-scoped evidence and does not auto-attach git status", () => {
  const m = minimalMission({
    prompt:
      "Phase-scoped document review.\nRequired files:\n- docs/run_1/phase_outputs/phase2/04_current_phase_review.md",
    runtime: { stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 0, resolvedArtifactRootRelative: "docs/run_1" }
  } as Mission);
  const item = {
    id: "w",
    title: "Review",
    role: MissionAgentRole.Reviewer,
    status: "todo",
    prompt: "Review only docs/run_1/phase_outputs/phase2/04_current_phase_review.md."
  };
  assert.equal(shouldPreferArtifactScopedEvidence(m, item as any), true);
  assert.equal(
    classifyToolEvidenceNecessity({
      mission: m,
      item: item as any,
      call: { tool: "git.status", args: {} }
    }),
    "optional"
  );
  assert.equal(shouldAttachOptionalContextLabel(m, item as any, "GIT STATUS"), false);
  const lines = buildRoleSpecificUserPromptCoreLines(m, item as any).join("\n");
  assert.match(lines, /REPO GIT EVIDENCE \(optional\): Repository-state probes are optional context/);
});

test("explicit git review contract marks git probe as required", () => {
  const m = minimalMission({ prompt: "Review repository status and confirm the working tree is clean." });
  const item = {
    id: "w",
    title: "Review git state",
    role: MissionAgentRole.Reviewer,
    status: "todo",
    prompt: "Use git status and git diff to confirm the repository state."
  };
  assert.equal(
    classifyToolEvidenceNecessity({
      mission: m,
      item: item as any,
      call: { tool: "git.status", args: {} }
    }),
    "required"
  );
  assert.equal(shouldAttachOptionalContextLabel(m, item as any, "GIT STATUS"), true);
});

test("code-focused review can treat git evidence as preferred without making it mandatory", () => {
  const m = minimalMission({ filesModified: ["src/orchestrator.ts"] });
  const item = {
    id: "w",
    title: "Review code change",
    role: MissionAgentRole.Reviewer,
    status: "todo",
    prompt: "Review the changed implementation in src/orchestrator.ts and check the diff if helpful."
  };
  assert.equal(shouldPreferRepositoryHistoryEvidence(m, item as any), true);
  const contract = buildWorkItemEvidenceContract(m, item as any);
  const repoReq = contract.requirements.find((req) => req.id === "repo_history_evidence");
  assert.equal(repoReq?.necessity, "preferred");
  assert.equal(shouldAttachOptionalContextLabel(m, item as any, "GIT STATUS"), true);
});

test("assessToolFailureEvidence degrades reviewer git probe when substitute artifact evidence remains", () => {
  const m = minimalMission({
    prompt: "Review only docs/run_1/report.md.",
    runtime: { stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 0, resolvedArtifactRootRelative: "docs/run_1" }
  } as Mission);
  const item = {
    id: "w",
    title: "Review scoped artifact",
    role: MissionAgentRole.Reviewer,
    status: "todo",
    prompt: "Review docs/run_1/report.md only."
  };
  const assessment = assessToolFailureEvidence({
    mission: m,
    item: item as any,
    call: { tool: "git.status", args: {} }
  });
  assert.equal(assessment?.necessity, "optional");
  assert.equal(assessment?.handling, "continue_degraded");
  assert.equal(assessment?.substituteEvidenceAvailable, true);
});

test("attachRoleDispatchMeta includes evidence contract summary for reviewer packets", () => {
  const m = minimalMission({
    prompt: "Review only docs/run_1/report.md.",
    runtime: { stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 0, resolvedArtifactRootRelative: "docs/run_1" }
  } as Mission);
  const item = {
    id: "w",
    title: "Review scoped artifact",
    role: MissionAgentRole.Reviewer,
    status: "todo",
    prompt: "Review docs/run_1/report.md only."
  };
  const ctx = attachRoleDispatchMeta(MissionAgentRole.Reviewer, {}, m, item as any);
  assert.equal(ctx.roleDispatch?.evidenceStrategy, "artifact_scoped");
  assert.equal(ctx.roleDispatch?.primaryArtifactRoot, "docs/run_1");
  assert.ok(ctx.roleDispatch?.requiredEvidence?.includes("direct_scope_evidence"));
  assert.ok(ctx.roleDispatch?.optionalEvidence?.includes("repo_history_evidence"));
});

test("buildRoleSpecificUserPromptCoreLines: validator mentions VALIDATION STATE", () => {
  const m = minimalMission({ validationState: "failed" });
  const item = {
    id: "w",
    title: "Validate",
    role: MissionAgentRole.Validator,
    status: "todo",
    prompt: "Prove closure.",
    validationScopeHint: "Focus on API surface."
  };
  const lines = buildRoleSpecificUserPromptCoreLines(m, item as any);
  const joined = lines.join("\n");
  assert.match(joined, /VALIDATION STATE: failed/);
  assert.match(joined, /Focus on API surface/);
});
