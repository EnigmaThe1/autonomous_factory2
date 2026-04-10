import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  balancedIntegrationPolicy,
  buildStandardNextQueue,
  createOrchestrator,
  runMissionUntilCompleted,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";
import { uid } from "../util";

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("integration: tool failure with failure investigation runs recovery chain then completes", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.failureInvestigation.enabled", true);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.failureInvestigation.maxWavesPerMission", 2);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 48);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxAutoRounds", 48);

  let writeFileCalls = 0;
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    if (call.tool === "writeFile") {
      writeFileCalls += 1;
      if (writeFileCalls === 1) return { ok: false, summary: "writeFile failed hard" };
      return { ok: true, summary: "Wrote file" };
    }
    return { ok: true, summary: "ok" };
  };

  const agent = roleScript({
    planner: [{ summary: "Plan.", nextWorkItems: buildStandardNextQueue() }],
    implementer: [
      { summary: "Try write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "y" } }] },
      { summary: "Retry write", toolCalls: [{ tool: "writeFile", args: { path: "x.txt", content: "y" } }] }
    ],
    researcher: [{ summary: "MEMORY: root cause is stubbed first write failure.", toolCalls: [] }],
    reviewer: [
      { summary: "Recovery review OK.", toolCalls: [] },
      { summary: "Main review OK.", toolCalls: [] }
    ],
    validator: [
      { summary: "COMPLETE: recovery acceptable.", decision: "complete", toolCalls: [] },
      { summary: "COMPLETE:", decision: "complete", toolCalls: [] }
    ]
  });

  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("lifecycle-recovery-e2e", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.enqueue(m.id, [{ id: "p0", title: "Plan", role: "planner", status: "todo", prompt: "Plan." }]);

  const fin = await runMissionUntilCompleted(orchestrator, store, m.id, 32);

  assert.equal(fin.status, "completed");
  assert.equal(fin.validationState, "passed");
  assert.ok(fin.events.some((e) => String(e.message || "").includes("Failure investigation wave enqueued")));

  const chainIds = new Set(
    fin.queue
      .map((w) => w.recoveryChainId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  assert.ok(chainIds.size >= 1, "recovery items share a chain id");

  assert.ok(fin.queue.some((w) => w.workItemPurpose === "failure_investigation_diagnose" && w.status === "done"));
  assert.ok(fin.queue.some((w) => w.workItemPurpose === "failure_recovery_retry" && w.status === "done"));
  assert.ok(fin.queue.some((w) => w.title.startsWith("Recovery review:") && w.status === "done"));
  assert.ok(fin.queue.some((w) => w.title.startsWith("Recovery validation:") && w.status === "done"));

  const spawned = fin.queue.filter((w) => typeof w.spawnedFromFailureOf === "string");
  assert.ok(spawned.length >= 3, "recovery rows link to failed item via spawnedFromFailureOf");
});
