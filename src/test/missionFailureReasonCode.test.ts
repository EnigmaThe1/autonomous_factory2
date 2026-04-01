import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { MissionToolExecutor } from "../missions/MissionOrchestrator";
import { wrapMission, unwrapMission } from "../storage/PersistenceCodec";
import {
  balancedIntegrationPolicy,
  createOrchestrator,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

const orchestratorPath = path.join(__dirname, "..", "..", "src", "missions", "MissionOrchestrator.ts");

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("MissionOrchestrator catch path sets failureReasonCode and keeps blockReasonCode off failed", () => {
  const src = fs.readFileSync(orchestratorPath, "utf8");
  assert.match(src, /status:\s*"failed"[\s\S]{0,220}blockReasonCode:\s*undefined[\s\S]{0,80}failureReasonCode:\s*"orchestrator_uncaught_error"/);
});

test("uncaught error during runMission leaves mission failed with failureReasonCode and no blockReasonCode", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  const agent = async () => {
    throw new Error("forced_uncaught_for_failure_reason_test");
  };
  const noop: MissionToolExecutor["execute"] = async () => ({ ok: true, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noop);
  const m = await store.create("fail-reason-code", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.updateMission(m.id, {
    queue: [{ id: "w-impl", title: "Do work", role: "implementer", status: "todo", prompt: "Run once." }]
  });
  await orchestrator.runMission(m.id);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  const fin = store.get(m.id)!;
  assert.equal(fin.status, "failed");
  assert.equal(fin.failureReasonCode, "orchestrator_uncaught_error");
  assert.equal(fin.blockReasonCode, undefined);
  assert.match(String(fin.blocker), /forced_uncaught_for_failure_reason_test/);
});

test("persistence wrap/unwrap preserves failureReasonCode on failed mission", () => {
  const mission = {
    id: "m-fail",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "failed" as const,
    activeProviderId: "ollama",
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: {
      closureRequired: true,
      requireReviewerBeforeComplete: true,
      requireValidatorBeforeComplete: true,
      requireImplementerBeforeComplete: true,
      autoContinue: true,
      maxAutoRounds: 1,
      minCompletedWorkItems: 1,
      stallReplanThreshold: 1
    },
    validationState: "failed" as const,
    roundsCompleted: 0,
    blocker: "Error: boom",
    blockReasonCode: undefined,
    failureReasonCode: "orchestrator_uncaught_error" as const
  };
  const roundTripped = unwrapMission(wrapMission(mission as any));
  assert.equal(roundTripped.failureReasonCode, "orchestrator_uncaught_error");
  assert.equal(roundTripped.blockReasonCode, undefined);
});
