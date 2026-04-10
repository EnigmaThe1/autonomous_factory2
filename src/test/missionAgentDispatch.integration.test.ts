import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { MissionAgentRole } from "../types";
import type { ToolCall } from "../types";
import { researcherTargetedEnrichmentNeeded } from "../missions/agentDispatch";
import type { ToolResult } from "../tools/ToolRegistry";
import {
  awaitMissionRunLoopIdle,
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  createOrchestrator,
  roleScript,
  runMissionUntilCompleted,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";
import { uid } from "../util";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.autonomy.mode", "workspace_coder");
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.tools.requireApprovalForInWorkspaceWrites", false);
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("integration: standard P→I→R→V chain completes with all five roles done", async () => {
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [{ summary: "Impl", toolCalls: [] }],
    reviewer: [{ summary: "LGTM", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const tool = async (): Promise<ToolResult> => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("dispatch-pirv", "p", "ollama", undefined, {
    ...balancedIntegrationPolicy,
    minCompletedWorkItems: 4,
    maxAutoRounds: 24
  });
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: MissionAgentRole.Planner, status: "todo", prompt: "Plan." }]);
  const fin = await runMissionUntilCompleted(orchestrator, store, m.id, 20);
  assert.equal(fin.status, "completed");
  assert.ok(fin.queue.some((w) => w.role === "planner" && w.status === "done"));
  assert.ok(fin.queue.some((w) => w.role === "implementer" && w.status === "done"));
  assert.ok(fin.queue.some((w) => w.role === "reviewer" && w.status === "done"));
  assert.ok(fin.queue.some((w) => w.role === "validator" && w.status === "done"));
});

test("integration: generic researcher todo does not imply researcher web tools on planner step", () => {
  const m = researcherTargetedEnrichmentNeeded(
    {
      id: "w",
      title: "Research tranche",
      role: MissionAgentRole.Researcher,
      status: "todo",
      prompt: "Optional background."
    } as any,
    {
      id: "mid",
      title: "M",
      prompt: "g",
      status: "queued",
      memory: [],
      queue: [],
      routing: {},
      policy: {} as any,
      activeProviderId: "x",
      activeModel: "y",
      createdAt: 0,
      updatedAt: 0,
      validationState: "unknown"
    } as any
  );
  assert.equal(m, false);
});

test("integration: implementer in-workspace write without approval under workspace_coder", async () => {
  let sawWrite = false;
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.tool === "writeFile") {
      sawWrite = true;
      return { ok: true, summary: "written" };
    }
    return { ok: true, summary: "noop" };
  };
  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      {
        summary: "Write.",
        toolCalls: [{ tool: "writeFile", args: { path: "out-dispatch.txt", content: "ok" } }]
      }
    ],
    reviewer: [{ summary: "LGTM", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("dispatch-write", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: uid("work"), title: "Initial planning", role: MissionAgentRole.Planner, status: "todo", prompt: "Plan." }]);
  await orchestrator.runMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  assert.equal(sawWrite, true);
  assert.equal(store.get(m.id)?.status, "completed");
});
