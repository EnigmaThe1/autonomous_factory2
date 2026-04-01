import test from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  awaitMissionRunLoopIdle,
  createOrchestrator,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";
import { isKnownImplementerHardStopClassValue } from "../missions/implementerHardStopClassInvariant";
import type { MissionPolicy } from "../types";
import { uid } from "../util";

test("orchestrator: implementer markStatus blocked persists known hardStopClass", async () => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
  const plannerId = uid("planner");
  const implId = uid("impl");
  const policy: Partial<MissionPolicy> = {
    minCompletedWorkItems: 1,
    requireReviewerBeforeComplete: false,
    requireValidatorBeforeComplete: false,
    requireImplementerBeforeComplete: true,
    closureRequired: false,
    maxAutoRounds: 8
  };
  const agent = roleScript({
    planner: [{ summary: "planned", nextWorkItems: [] }],
    implementer: [{ summary: "model says blocked", markStatus: "blocked", decision: "blocked" }]
  });
  const { orchestrator, store } = await createOrchestrator(agent, async () => ({ ok: true, summary: "ok" }));
  const m = await store.create("hsc-mark-blocked", "p", "ollama", undefined, policy);
  await store.enqueue(m.id, [
    { id: plannerId, title: "Plan", role: "planner", status: "todo", prompt: "Plan." },
    {
      id: implId,
      title: "Implement",
      role: "implementer",
      status: "todo",
      prompt: "Do work.",
      dependsOn: [plannerId]
    }
  ]);
  await store.updateMission(m.id, { status: "queued" });
  await orchestrator.runMission(m.id);
  await awaitMissionRunLoopIdle(orchestrator, m.id);
  const fin = store.get(m.id)!;
  const wi = fin.queue.find((w) => w.id === implId)!;
  assert.equal(wi.status, "blocked");
  assert.ok(isKnownImplementerHardStopClassValue(wi.hardStopClass));
  assert.equal(wi.hardStopClass, "unknown_hard_stop");
  (vscode as VscodeTestApi).__clearTestConfig?.();
});
