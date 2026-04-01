import test from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { balancedIntegrationPolicy, createOrchestrator, roleScript, type VscodeTestApi } from "./missionOrchestratorTestHarness";

test("runMission logs explicit invariant mission event when required implementer hardStopClass is missing", async () => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
  const agent = roleScript({
    planner: [{ summary: "noop", nextWorkItems: [] }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "ok" }));
  const m = await store.create("malformed-hsc", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.updateMission(m.id, {
    status: "queued",
    validationState: "failed",
    queue: [{ id: "wi", title: "impl", role: "implementer", status: "failed", prompt: "p", output: "x" }]
  });
  await orchestrator.runMission(m.id);
  const fin = store.get(m.id)!;
  const evs = fin.events.filter((e) => e.source === "orchestrator" && e.message.includes("Invariant:"));
  assert.ok(evs.length >= 1);
  assert.ok(evs.some((e) => e.level === "error" && e.message.includes("hardStopClass is missing")));
  (vscode as VscodeTestApi).__clearTestConfig?.();
});
