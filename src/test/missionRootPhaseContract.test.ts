import test from "node:test";
import assert from "node:assert/strict";
import { parsePersistableArtifactRootFromSummary, persistArtifactRootFromSummaryIfNew } from "../missions/missionArtifactRootBinding";
import {
  buildReviewerValidatorReadScope,
  isReadPathAllowedInReviewScope,
  normalizeWorkspaceRelPath
} from "../missions/missionReviewReadScope";
import { classifyToolOutcome } from "../missions/orchestrator/toolOutcomeClassifier";
import { classifyToolFailureStructured, routeStructuredRecovery } from "../missions/failure";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";
import { extractImplementerDeliverablePathsFromStep } from "../missions/blueprintSynthesis";
import type { BlueprintStep } from "../missions/missionBlueprintTypes";

test("normalizeWorkspaceRelPath rejects traversal", () => {
  assert.equal(normalizeWorkspaceRelPath("docs/../x.md"), undefined);
  assert.equal(normalizeWorkspaceRelPath("docs/a.md"), "docs/a.md");
});

test("parsePersistableArtifactRootFromSummary accepts valid relative path", () => {
  assert.equal(
    parsePersistableArtifactRootFromSummary("hello\nMISSION_ARTIFACT_ROOT: docs/run_1/foo\nbye"),
    "docs/run_1/foo"
  );
  assert.equal(parsePersistableArtifactRootFromSummary("MISSION_ARTIFACT_ROOT: ../../etc"), undefined);
});

test("buildReviewerValidatorReadScope: off when no scope signals", () => {
  const scope = buildReviewerValidatorReadScope(
    { filesModified: [] } as unknown as import("../types").Mission,
    { role: "reviewer", prompt: "x" } as import("../types").WorkItem
  );
  assert.equal(scope.mode, "off");
});

test("buildReviewerValidatorReadScope: enforce from filesModified", () => {
  const scope = buildReviewerValidatorReadScope(
    { filesModified: ["docs/a.md"] } as unknown as import("../types").Mission,
    { role: "reviewer", prompt: "review" } as import("../types").WorkItem
  );
  assert.equal(scope.mode, "enforce");
  if (scope.mode === "enforce") {
    assert.equal(isReadPathAllowedInReviewScope(scope, "docs/a.md"), true);
    assert.equal(isReadPathAllowedInReviewScope(scope, "docs/future_99.md"), false);
  }
});

test("classifyToolOutcome: out-of-scope review read blocks (not recoverable readonly)", () => {
  const decision = classifyToolOutcome({
    call: { tool: "readFile", args: { path: "docs/future_99.md" } } as ToolCall,
    result: { ok: false, summary: "ENOENT", data: { code: "ENOENT" } } as ToolResult,
    isReadonlyTool: true,
    isMutatingTool: false,
    readonlyBudgetRemaining: true,
    isReadFileMissing: false,
    reviewReadOutOfAllowlist: true
  });
  assert.equal(decision.kind, "blocked");
  if (decision.kind === "blocked") assert.equal(decision.category, "out_of_scope_review_read");
});

test("classifyToolFailureStructured: out_of_scope maps to premature_or_out_of_scope_read", () => {
  const call: ToolCall = { tool: "readFile", args: { path: "x" } };
  const result: ToolResult = { ok: false, summary: "missing" };
  const s = classifyToolFailureStructured({ kind: "blocked", category: "out_of_scope_review_read" }, call, result);
  assert.equal(s.code, "premature_or_out_of_scope_read");
});

test("routeStructuredRecovery: premature_or_out_of_scope_read → replan", () => {
  const d = routeStructuredRecovery(
    { class: "repairable", domain: "tool", code: "premature_or_out_of_scope_read", message: "m" },
    {
      sameFingerprintStreak: 1,
      failureInvestigationEnabled: true,
      failureInvestigationWavesRemaining: 2,
      workItemRole: "reviewer"
    }
  );
  assert.equal(d.route, "replan");
});

test("extractImplementerDeliverablePathsFromStep pulls path-like criteria", () => {
  const step: BlueprintStep = {
    id: "i",
    title: "t",
    summary: "s",
    roleHint: "implementer",
    acceptanceCriteria: ["docs/out/report.md", "Also `src/x.ts`"],
    status: "pending"
  };
  const p = extractImplementerDeliverablePathsFromStep(step);
  assert.ok(p.includes("docs/out/report.md"));
  assert.ok(p.includes("src/x.ts"));
});

test("extractImplementerDeliverablePathsFromStep empty for non-implementer", () => {
  const step: BlueprintStep = {
    id: "i",
    title: "t",
    summary: "s",
    roleHint: "reviewer",
    acceptanceCriteria: ["report.md"],
    status: "pending"
  };
  assert.equal(extractImplementerDeliverablePathsFromStep(step).length, 0);
});

test("persistArtifactRootFromSummaryIfNew updates runtime once", async () => {
  const runtime: import("../types").MissionRuntime = {
    stalledHeartbeats: 0,
    autoReplans: 0,
    loopGuardTrips: 0
  };
  let updateCount = 0;
  let eventCount = 0;
  const store = {
    get: () => ({ id: "m1", runtime }),
    updateRuntime: async (_id: string, patch: Partial<import("../types").MissionRuntime>) => {
      updateCount += 1;
      Object.assign(runtime, patch);
    },
    saveEvent: async () => {
      eventCount += 1;
    }
  };
  await persistArtifactRootFromSummaryIfNew(store as never, "m1", "MISSION_ARTIFACT_ROOT: docs/r1\n");
  await persistArtifactRootFromSummaryIfNew(store as never, "m1", "MISSION_ARTIFACT_ROOT: docs/r1\n");
  assert.equal(updateCount, 1);
  assert.equal(eventCount, 1);
  assert.equal(runtime.resolvedArtifactRootRelative, "docs/r1");
});
