import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { uid } from "../util";
import {
  balancedIntegrationPolicy,
  createOrchestrator,
  roleScript,
  type VscodeTestApi
} from "./missionOrchestratorTestHarness";

const workItemRunnerPath = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "missions",
  "orchestrator",
  "missionOrchestratorWorkItemRunner.ts"
);
const runLoopPath = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "missions",
  "orchestrator",
  "missionOrchestratorRunLoop.ts"
);

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("MissionOrchestrator: maxAutoRounds safety block sets blockReasonCode", () => {
  const src = fs.readFileSync(runLoopPath, "utf8");
  assert.match(src, /Reached maxAutoRounds safety limit[\s\S]{0,400}blockReasonCode:\s*"max_auto_rounds"/);
});

test("MissionOrchestrator: operator stream abort mission block sets blockReasonCode", () => {
  const src = fs.readFileSync(workItemRunnerPath, "utf8");
  assert.match(
    src,
    /Model stream cancelled \(operator abort\)\. Resume when ready\.[\s\S]{0,120}blockReasonCode:\s*"operator_stream_abort"/
  );
});

test("MissionOrchestrator: requiresApproval tool path sets blockReasonCode approval_pending", () => {
  const src = fs.readFileSync(workItemRunnerPath, "utf8");
  const idx = src.indexOf("if (toolResult.requiresApproval)");
  assert.ok(idx >= 0);
  const slice = src.slice(idx, idx + 1200);
  assert.match(slice, /status:\s*"awaiting_input"/);
  assert.match(slice, /blockReasonCode:\s*"approval_pending"/);
});

test("MissionOrchestrator: tryCollapseMissionToCompleted clears blockReasonCode", () => {
  const src = fs.readFileSync(runLoopPath, "utf8");
  assert.match(
    src,
    /status:\s*"completed"[\s\S]{0,200}blocker:\s*undefined[\s\S]{0,80}blockReasonCode:\s*undefined/
  );
});

test("runMission collapses to completed without stale blockReasonCode", async () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.missions.maxStepsPerRun", 8);
  const agent = roleScript({});
  const noopTool = async () => ({ ok: true as const, summary: "noop" });
  const { orchestrator, store } = await createOrchestrator(agent, noopTool);
  const m = await store.create("block-reason-collapse", "p", "ollama", undefined, balancedIntegrationPolicy);
  await store.updateMission(m.id, {
    queue: [
      { id: uid("work"), title: "I", role: "implementer", status: "done", prompt: "p" },
      { id: uid("work"), title: "R", role: "reviewer", status: "done", prompt: "p" },
      { id: uid("work"), title: "V", role: "validator", status: "done", prompt: "p" }
    ],
    validationState: "passed",
    blockReasonCode: "generic_blocked",
    blocker: "stale pause metadata"
  });
  await orchestrator.runMission(m.id);
  await orchestrator.whenMissionRunLoopIdle(m.id);
  const done = store.get(m.id)!;
  assert.equal(done.status, "completed");
  assert.equal(done.blockReasonCode, undefined);
});
