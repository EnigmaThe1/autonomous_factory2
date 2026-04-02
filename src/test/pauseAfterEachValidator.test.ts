import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";
import { uid } from "../util";
import {
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  createOrchestrator,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

const noop = async (): Promise<ToolResult> => ({ ok: true, summary: "noop" });

test("pauseAfterEachValidator: mission awaits input after validator; resume completes", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.pauseAfterEachValidator", true);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("pv-pause", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  const mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.equal(mid.blockReasonCode, "post_validator_checkpoint");
  assert.match(mid.blocker || "", /Resume Mission/i);
  const v = mid.queue.find((w) => w.role === "validator");
  assert.equal(v?.status, "done");

  const r = await orchestrator.resumeMission(m.id);
  assert.notEqual(r.kind, "gated_awaiting_input");
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
});

test("pauseAfterEachValidator off: completes in one pass without post-validator pause", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.pauseAfterEachValidator", false);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("pv-no-pause", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }]);

  await orchestrator.runMission(m.id);
  assert.equal(store.get(m.id)!.status, "completed");
  assert.notEqual(store.get(m.id)!.blockReasonCode, "post_validator_checkpoint");
});
