import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ToolCall } from "../types";
import type { ToolResult } from "../tools/ToolRegistry";
import { uid } from "../util";
import {
  awaitMissionRunLoopIdle,
  balancedIntegrationPolicy,
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

test("Verifier obligations: after implementer mutation, orchestrator runs runLinter and runTests (balanced)", async () => {
  const seen: string[] = [];
  const tool = async (_mid: string, call: ToolCall): Promise<ToolResult> => {
    seen.push(call.tool);
    if (call.tool === "runLinter") return { ok: true, summary: "lint ok" };
    if (call.tool === "runTests") return { ok: true, summary: "tests ok" };
    if (call.tool === "writeFile") return { ok: true, summary: "wrote" };
    return { ok: true, summary: "ok" };
  };

  const agent = roleScript({
    implementer: [{ summary: "write", toolCalls: [{ tool: "writeFile", args: { path: "a.txt", content: "b" } }] }],
    reviewer: [{ summary: "r", toolCalls: [] }],
    validator: [{ summary: "COMPLETE:", decision: "complete", toolCalls: [] }]
  });

  const { orchestrator, store } = await createOrchestrator(agent, tool);
  const m = await store.create("verif", "p", "ollama", undefined, { ...balancedIntegrationPolicy, minCompletedWorkItems: 1 });
  await store.enqueue(m.id, [{ id: uid("work"), title: "Implement", role: "implementer", status: "todo", prompt: "i" }]);

  await orchestrator.runMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);

  assert.ok(seen.includes("writeFile"));
  assert.ok(seen.includes("runLinter"));
  assert.ok(seen.includes("runTests"));

  const fin = store.get(m.id)!;
  assert.ok(typeof fin.runtime?.lastImplementerMutationAt === "number");
  assert.ok(typeof fin.runtime?.lastVerificationAt === "number");
  assert.ok((fin.runtime!.lastVerificationAt as number) >= (fin.runtime!.lastImplementerMutationAt as number));
});

