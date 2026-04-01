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

test("action result: startMission returns mission + scheduled_pass", async () => {
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator } = await createOrchestrator(agent, noop);
  const out = await orchestrator.startMission("ar-start", "p", "ollama");
  assert.equal(out.pass.kind, "scheduled_pass");
  assert.equal(out.pass.missionId, out.mission.id);
});

test("action result: resumeMission on completed is noop_terminal", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("ar-res-term", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  assert.equal(store.get(m.id)!.status, "completed");
  const r = await orchestrator.resumeMission(m.id);
  assert.equal(r.kind, "noop_terminal");
  if (r.kind === "noop_terminal") {
    assert.equal(r.status, "completed");
  }
});

test("action result: resumeMission on awaiting_input is gated_awaiting_input", async () => {
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => ({
    ok: false,
    summary: "n",
    requiresApproval: { kind: "write_file" as const, title: "A", details: "d" }
  });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("ar-gate", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  assert.equal(store.get(m.id)!.status, "awaiting_input");
  const r = await orchestrator.resumeMission(m.id);
  assert.equal(r.kind, "gated_awaiting_input");
});

test("action result: runMission second call joins in-flight pass", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 4);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("ar-join", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  void orchestrator.runMission(m.id);
  const r = await orchestrator.runMission(m.id);
  assert.equal(r.kind, "joined_in_flight_pass");
  assert.equal(r.missionId, m.id);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  const mid = store.get(m.id)!;
  assert.ok(mid.status === "completed" || mid.status === "queued");
});

test("action result: resolveApproval approve then duplicate is noop_unknown_approval", async () => {
  let approvedExecutions = 0;
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) {
      approvedExecutions += 1;
      return { ok: true, summary: "ok" };
    }
    return {
      ok: false,
      summary: "n",
      requiresApproval: { kind: "write_file" as const, title: "A", details: "d" }
    };
  };
  const { orchestrator, store } = await createOrchestrator(
    roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] }],
      reviewer: [{ summary: "LGTM.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    }),
    tool
  );
  const m = await store.create("ar-appr", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);

  const ok = await orchestrator.resolveApproval(m.id, pending.id, true);
  assert.equal(ok.kind, "approved_continuation_scheduled");

  const dup = await orchestrator.resolveApproval(m.id, pending.id, true);
  assert.equal(dup.kind, "noop_unknown_approval");
  if (dup.kind === "noop_unknown_approval") {
    assert.equal(dup.approvalId, pending.id);
  }

  assert.equal(approvedExecutions, 1);
});

test("action result: resolveApproval reject returns rejected_mission_blocked", async () => {
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => ({
    ok: false,
    summary: "n",
    requiresApproval: { kind: "write_file" as const, title: "A", details: "d" }
  });
  const { orchestrator, store } = await createOrchestrator(
    roleScript({
      planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
      implementer: [{ summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] }],
      reviewer: [{ summary: "LGTM.", toolCalls: [] }],
      validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
    }),
    tool
  );
  const m = await store.create("ar-rej", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  const rej = await orchestrator.resolveApproval(m.id, pending.id, false, "no");
  assert.equal(rej.kind, "rejected_mission_blocked");
  if (rej.kind === "rejected_mission_blocked") {
    assert.equal(rej.statusAfter, "blocked");
  }
});
