import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  effectiveWebResearchMaxCallsPerMission,
  effectiveWebSearchMinIntervalMs,
  missionUsesLocalLlmEconomy
} from "../missions/webResearchBudgetPolicy";
import type { Mission } from "../types";
import type { VscodeTestApi } from "./missionOrchestratorTestHarness";

const baseMission = (provider: string): Mission =>
  ({
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "queued",
    activeProviderId: provider,
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: {
      closureRequired: true,
      requireReviewerBeforeComplete: false,
      requireValidatorBeforeComplete: false,
      requireImplementerBeforeComplete: true,
      autoContinue: true,
      maxAutoRounds: 10,
      minCompletedWorkItems: 1,
      stallReplanThreshold: 2,
      policyPreset: "light",
      requireValidationEvidence: false
    },
    validationState: "pending",
    roundsCompleted: 0,
    runtime: { stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 0 }
  }) as Mission;

beforeEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

afterEach(() => {
  (vscode as VscodeTestApi).__clearTestConfig?.();
});

test("effectiveWebResearchMaxCallsPerMission: ollama + unlimited local => unlimited", () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.maxCallsPerMission", 5);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.unlimitedBudgetForLocalLlm", true);
  const cfg = vscode.workspace.getConfiguration();
  const m = baseMission("ollama");
  assert.equal(effectiveWebResearchMaxCallsPerMission(m, cfg), 0);
  assert.equal(missionUsesLocalLlmEconomy(m, cfg), true);
});

test("effectiveWebResearchMaxCallsPerMission: openai uses configured cap", () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.maxCallsPerMission", 7);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.unlimitedBudgetForLocalLlm", true);
  const cfg = vscode.workspace.getConfiguration();
  const m = baseMission("openai");
  assert.equal(effectiveWebResearchMaxCallsPerMission(m, cfg), 7);
  assert.equal(missionUsesLocalLlmEconomy(m, cfg), false);
});

test("effectiveWebSearchMinIntervalMs: local LLM skips cooldown", () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webSearch.minIntervalMs", 5000);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.unlimitedBudgetForLocalLlm", true);
  const cfg = vscode.workspace.getConfiguration();
  assert.equal(effectiveWebSearchMinIntervalMs(baseMission("ollama"), cfg), 0);
  assert.equal(effectiveWebSearchMinIntervalMs(baseMission("openai"), cfg), 5000);
});

test("effectiveWebResearchMaxCallsPerMission: ollama respects cap when unlimited flag off", () => {
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.maxCallsPerMission", 3);
  (vscode as VscodeTestApi).__setTestConfig?.("myAi.webResearch.unlimitedBudgetForLocalLlm", false);
  const cfg = vscode.workspace.getConfiguration();
  const m = baseMission("ollama");
  assert.equal(effectiveWebResearchMaxCallsPerMission(m, cfg), 3);
});
