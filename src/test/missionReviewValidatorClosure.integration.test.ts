/**
 * Phase 7: structured reviewer/validator outcomes and closure-loop routing.
 */
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { MissionAgentRunForTest } from "../missions/MissionOrchestrator";
import type { MissionPolicy } from "../types";
import { uid } from "../util";
import {
  balancedIntegrationPolicy,
  createOrchestrator,
  runMissionUntilCompleted,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

const V = vscode as VscodeTestApi;

const p75: Partial<MissionPolicy> = {
  ...balancedIntegrationPolicy,
  minCompletedWorkItems: 2
};

beforeEach(() => {
  V.__clearTestConfig?.();
});

afterEach(() => {
  V.__clearTestConfig?.();
});

test("integration: reviewer revision_required injects remediation then completes", async () => {
  V.__setTestConfig?.("myAi.reviewers.autoCreateFixTasks", true);
  V.__setTestConfig?.("myAi.missions.maxStepsPerRun", 96);
  V.__setTestConfig?.("myAi.missions.requirePlannerCoverage", false);

  const iid = "rv-impl";
  const rid = "rv-rev";

  const agent: MissionAgentRunForTest = async (_m, item) => {
    if (item.role === "planner") {
      return {
        summary: "plan",
        nextWorkItems: [
          { id: iid, title: "Implementation", role: "implementer", status: "todo", prompt: "impl" },
          { id: rid, title: "Review", role: "reviewer", status: "todo", prompt: "rev", dependsOn: [iid] }
        ],
        markStatus: "done"
      };
    }
    if (item.id === iid) return { summary: "impl ok", nextWorkItems: [], markStatus: "done" };
    if (item.id === rid) {
      return {
        summary: "REVIEW_OUTCOME: revision_required\nREVIEW_FINDINGS: add coverage\n",
        nextWorkItems: [],
        markStatus: "done"
      };
    }
    if (item.title.includes("Reviewer remediation")) {
      return { summary: "fixed", nextWorkItems: [], markStatus: "done" };
    }
    if (item.title.includes("Re-review")) {
      return { summary: "REVIEW_OUTCOME: approved\n", nextWorkItems: [], markStatus: "done" };
    }
    if (item.title.includes("Re-validation")) {
      return {
        summary: "VALIDATION_OUTCOME: pass\nCOMPLETE:\n",
        nextWorkItems: [],
        markStatus: "done",
        decision: "complete"
      };
    }
    if (item.role === "validator") {
      return {
        summary: "VALIDATION_OUTCOME: pass\nCOMPLETE:\n",
        nextWorkItems: [],
        markStatus: "done",
        decision: "complete"
      };
    }
    return { summary: "?", nextWorkItems: [], markStatus: "done" };
  };

  const noop = async () => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("rev-val-loop", "goal", "ollama", undefined, p75);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial plan", role: "planner", status: "todo", prompt: "Plan" }
  ]);
  await runMissionUntilCompleted(orchestrator, store, m.id, 80);
  const end = store.get(m.id)!;
  assert.equal(end.status, "completed");
  assert.equal(end.validationState, "passed");
});

test("integration: validator inconclusive enqueues researcher+planner follow-ups", async () => {
  V.__setTestConfig?.("myAi.missions.maxStepsPerRun", 64);
  V.__setTestConfig?.("myAi.missions.requirePlannerCoverage", false);

  const iid = "inc-impl";
  const rid = "inc-rev";

  const agent: MissionAgentRunForTest = async (_m, item) => {
    if (item.role === "planner" && item.title === "Initial plan") {
      return {
        summary: "plan",
        nextWorkItems: [
          { id: iid, title: "Implementation", role: "implementer", status: "todo", prompt: "impl" },
          { id: rid, title: "Review", role: "reviewer", status: "todo", prompt: "rev", dependsOn: [iid] }
        ],
        markStatus: "done"
      };
    }
    if (item.id === iid) return { summary: "impl", nextWorkItems: [], markStatus: "done" };
    if (item.id === rid) return { summary: "REVIEW_OUTCOME: approved\n", nextWorkItems: [], markStatus: "done" };
    if (item.role === "validator" && item.title.includes("Required validation")) {
      return {
        summary: "VALIDATION_OUTCOME: inconclusive\nVALIDATION_SUSPECTED_CLASS: environment\n",
        nextWorkItems: [],
        markStatus: "done",
        decision: "complete"
      };
    }
    if (item.role === "researcher") {
      return { summary: "MEMORY: finding: - check env\n", nextWorkItems: [], markStatus: "done" };
    }
    if (item.role === "planner" && item.title.includes("inconclusive")) {
      return {
        summary: "close",
        nextWorkItems: [
          { id: "i2", title: "Follow-up impl", role: "implementer", status: "todo", prompt: "f" },
          { id: "r2", title: "Follow-up review", role: "reviewer", status: "todo", prompt: "r", dependsOn: ["i2"] },
          { id: "v2", title: "Follow-up validate", role: "validator", status: "todo", prompt: "v", dependsOn: ["r2"] }
        ],
        markStatus: "done"
      };
    }
    if (item.id === "i2") return { summary: "ok", nextWorkItems: [], markStatus: "done" };
    if (item.id === "r2") return { summary: "REVIEW_OUTCOME: approved\n", nextWorkItems: [], markStatus: "done" };
    if (item.id === "v2") {
      return {
        summary: "VALIDATION_OUTCOME: pass\nCOMPLETE:\n",
        nextWorkItems: [],
        markStatus: "done",
        decision: "complete"
      };
    }
    return { summary: "?", nextWorkItems: [], markStatus: "done" };
  };

  const noop = async () => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("inc-val", "goal", "ollama", undefined, p75);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial plan", role: "planner", status: "todo", prompt: "Plan" }
  ]);
  let sawInconclusiveTrail = false;
  for (let i = 0; i < 40; i++) {
    await orchestrator.runMission(m.id);
    const q = store.get(m.id)!.queue;
    if (q.some((w) => w.title.includes("inconclusive"))) {
      sawInconclusiveTrail = true;
      break;
    }
    const st = store.get(m.id)!.status;
    if (st === "completed" || st === "blocked" || st === "failed") break;
  }
  assert.ok(sawInconclusiveTrail, "expected researcher/planner inconclusive follow-ups to be enqueued");

  await runMissionUntilCompleted(orchestrator, store, m.id, 80);
  assert.equal(store.get(m.id)!.status, "completed");
});
