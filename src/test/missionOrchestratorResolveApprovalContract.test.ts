import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";
import { uid } from "../util";
import {
  awaitMissionRunLoopIdle,
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

test("resolveApproval: approved tool runs once; duplicate resolve is ignored", async () => {
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
  const m = await store.create("idem-appr", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);

  await orchestrator.resolveApproval(m.id, pending.id, true);
  await orchestrator.resolveApproval(m.id, pending.id, true);
  await awaitMissionRunLoopIdle(orchestrator, m.id);

  assert.equal(approvedExecutions, 1);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
});

test("resolveApproval: promise settles before mission reaches terminal (continuation async)", async () => {
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.args.__approved) return { ok: true, summary: "ok" };
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
  const m = await store.create("early-ret", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [
    { id: uid("work"), title: "Initial planning", role: "planner", status: "todo", prompt: "Plan." }
  ]);
  await orchestrator.runMission(m.id);
  const pending = store.get(m.id)!.approvals.find((a) => a.status === "pending");
  assert.ok(pending);

  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 1);
  const approveRes = await orchestrator.resolveApproval(m.id, pending.id, true);
  assert.equal(approveRes.kind, "approved_continuation_scheduled");
  const rightAfter = store.get(m.id)!;
  assert.notEqual(
    rightAfter.status,
    "completed",
    "caller must not assume mission is finished when resolveApproval resolves"
  );

  await awaitMissionRunLoopIdle(orchestrator, m.id);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 32);
  await orchestrator.runMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
});
