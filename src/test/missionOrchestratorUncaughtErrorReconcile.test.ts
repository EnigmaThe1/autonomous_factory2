import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";
import type { MissionAgentRunForTest, MissionToolExecutor } from "../missions/MissionOrchestrator";
import {
  balancedIntegrationPolicy,
  createOrchestrator,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("runMission: uncaught error reconciles running work item to failed (no stale running)", async () => {
  const agent: MissionAgentRunForTest = async (_mission, item) => {
    if (item.role === "researcher") throw new Error("simulated_agent_crash");
    throw new Error(`unexpected role ${item.role}`);
  };
  const toolImpl: MissionToolExecutor["execute"] = async (): Promise<ToolResult> => ({
    ok: true,
    summary: "noop"
  });
  const { orchestrator, store } = await createOrchestrator(agent, toolImpl);
  const m = await store.create("reconcile-uncaught", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: "wi-r", title: "Research step", role: "researcher", status: "todo", prompt: "Research." }
  ]);
  await orchestrator.runMission(m.id);
  const mid = store.get(m.id)!;
  assert.equal(mid.status, "failed");
  assert.equal(mid.failureReasonCode, "orchestrator_uncaught_error");
  const wi = mid.queue.find((w) => w.id === "wi-r")!;
  assert.equal(wi.status, "failed");
  assert.equal(wi.hardStopClass, "unknown_hard_stop");
  assert.match(wi.output || "", /orchestrator_uncaught_error/i);
  assert.equal(mid.queue.some((w) => w.status === "running"), false);
});

test("executeWorkItemToolCalls path: tool execute throw becomes ok:false tool_failure (mission blocked)", async () => {
  const agent: MissionAgentRunForTest = async () => ({
    summary: "need file",
    toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "y" } }]
  });
  const toolImpl: MissionToolExecutor["execute"] = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.tool === "writeFile") throw new Error("tool_layer_simulated_throw");
    return { ok: true, summary: "noop" };
  };
  const { orchestrator, store } = await createOrchestrator(agent, toolImpl);
  const m = await store.create("reconcile-tool-throw", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: "wi-r2", title: "Implement with tools", role: "implementer", status: "todo", prompt: "Use writeFile." }
  ]);
  await orchestrator.runMission(m.id);
  const mid = store.get(m.id)!;
  assert.equal(mid.status, "blocked");
  assert.equal(mid.blockReasonCode, "tool_failure");
  const wi = mid.queue.find((w) => w.id === "wi-r2")!;
  assert.equal(wi.status, "failed");
  assert.equal(wi.hardStopClass, "tool_failure");
  assert.match(wi.output || "", /tool_layer_simulated_throw/);
  assert.equal(mid.queue.some((w) => w.status === "running"), false);
});
