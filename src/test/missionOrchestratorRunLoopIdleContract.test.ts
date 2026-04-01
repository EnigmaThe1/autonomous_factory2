import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { isMissionTerminalLifecycleStatus } from "../missions/LifecycleRules";
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

test("whenMissionRunLoopIdle: startMission schedules work; idle after pass does not imply terminal", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const { mission: m } = await orchestrator.startMission("Idle-start", "p", "ollama");
  await orchestrator.whenMissionRunLoopIdle(m.id);
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
  const mid = store.get(m.id)!;
  assert.equal(mid.status, "queued");
  assert.equal(isMissionTerminalLifecycleStatus(mid.status), false);
});

test("whenMissionRunLoopIdle: resolveApproval then idle ends continuation pass; may still be queued under maxSteps", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) return { ok: true, summary: "ok" };
    return {
      ok: false,
      summary: "n",
      requiresApproval: { kind: "write_file" as const, title: "A", details: "d" }
    };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "y" } }] }],
    reviewer: [{ summary: "LGTM.", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Idle-appr", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  await orchestrator.resolveApproval(m.id, pending.id, true);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  const mid = store.get(m.id)!;
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
  assert.equal(mid.status, "queued");
  assert.equal(isMissionTerminalLifecycleStatus(mid.status), false);
});

test("whenMissionRunLoopIdle: resumeMission on queued resumable mission awaits one pass then idle", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("Idle-resume", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  await orchestrator.resumeMission(m.id);
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
  const mid = store.get(m.id)!;
  assert.ok(mid.status === "queued" || isMissionTerminalLifecycleStatus(mid.status));
});

test("whenMissionRunLoopIdle: resumeMission while run active joins in-flight pass (no extra pass)", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 4);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("Idle-dup-resume", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  void orchestrator.runMission(m.id);
  await orchestrator.resumeMission(m.id);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  const mid = store.get(m.id)!;
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
  assert.ok(isMissionTerminalLifecycleStatus(mid.status) || mid.status === "queued");
});

test("whenMissionRunLoopIdle: blocked and awaiting_input missions have no active run loop after settle", async () => {
  const tool = async (_mid: string, _call: ToolCall): Promise<ToolResult> => ({
    ok: false,
    summary: "n",
    requiresApproval: { kind: "write_file" as const, title: "R", details: "d" }
  });
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "W.", toolCalls: [{ tool: "write_file", args: { path: "z.txt", content: "1" } }] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("Idle-await", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  let mid = store.get(m.id)!;
  assert.equal(mid.status, "awaiting_input");
  assert.equal(isMissionTerminalLifecycleStatus(mid.status), false);

  const pending = mid.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  await orchestrator.resolveApproval(m.id, pending.id, false, "no");
  await orchestrator.whenMissionRunLoopIdle(m.id);
  mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.equal(isMissionTerminalLifecycleStatus(mid.status), true);
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
});

test("join in-flight: concurrent resumeMission calls await the same active pass", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 4);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("Idle-parallel-resume", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  void orchestrator.runMission(m.id);
  await Promise.all([orchestrator.resumeMission(m.id), orchestrator.resumeMission(m.id)]);
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
  const mid = store.get(m.id)!;
  assert.ok(isMissionTerminalLifecycleStatus(mid.status) || mid.status === "queued");
});

test("join in-flight: second runMission awaits first pass without stacking passes", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 4);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("Idle-dup-runMission", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  void orchestrator.runMission(m.id);
  await orchestrator.runMission(m.id);
  assert.equal(orchestrator.isMissionRunLoopActive(m.id), false);
  const mid = store.get(m.id)!;
  assert.ok(isMissionTerminalLifecycleStatus(mid.status) || mid.status === "queued");
});
