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

test("whenMissionReachesTerminalLifecycleStatus: resolves when mission completes (not idle-only)", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const { mission: m } = await orchestrator.startMission("Term-wait-done", "p", "ollama");
  await orchestrator.whenMissionReachesTerminalLifecycleStatus(m.id, { timeoutMs: 30_000 });
  const mid = store.get(m.id)!;
  assert.equal(isMissionTerminalLifecycleStatus(mid.status), true);
  assert.equal(mid.status, "completed");
});

test("whenMissionReachesTerminalLifecycleStatus: times out if status stays non-terminal", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("Term-wait-timeout", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  assert.equal(isMissionTerminalLifecycleStatus(store.get(m.id)!.status), false);
  await assert.rejects(
    () => orchestrator.whenMissionReachesTerminalLifecycleStatus(m.id, { timeoutMs: 200 }),
    /whenMissionReachesTerminalLifecycleStatus: timeout/
  );
});

test("whenMissionReachesTerminalLifecycleStatus: resolves on blocked after approval reject", async () => {
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
  const m = await store.create("Term-wait-blocked", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);
  await orchestrator.resolveApproval(m.id, pending.id, false, "no");
  await orchestrator.whenMissionReachesTerminalLifecycleStatus(m.id, { timeoutMs: 15_000 });
  assert.equal(store.get(m.id)!.status, "blocked");
  assert.equal(isMissionTerminalLifecycleStatus(store.get(m.id)!.status), true);
});

test("whenMissionReachesTerminalLifecycleStatus: idle phase resolves when store reaches terminal via mutation notify", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "I", toolCalls: [] }],
    reviewer: [{ summary: "R", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("Term-wait-notify", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  assert.equal(store.get(m.id)!.status, "queued");
  const wait = orchestrator.whenMissionReachesTerminalLifecycleStatus(m.id, { timeoutMs: 5_000 });
  await store.updateMission(m.id, { status: "blocked", blocker: "external test block", validationState: "failed" });
  await wait;
  assert.equal(store.get(m.id)!.status, "blocked");
  assert.equal(isMissionTerminalLifecycleStatus(store.get(m.id)!.status), true);
});

test("whenMissionReachesTerminalLifecycleStatus: awaiting_input is non-terminal until timeout", async () => {
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
  const m = await store.create("Term-wait-awaiting", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  assert.equal(store.get(m.id)!.status, "awaiting_input");
  await assert.rejects(
    () => orchestrator.whenMissionReachesTerminalLifecycleStatus(m.id, { timeoutMs: 120 }),
    /whenMissionReachesTerminalLifecycleStatus: timeout/
  );
});
