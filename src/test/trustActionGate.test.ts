import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTrustActionGate,
  isDependencyStyleShellCommand,
  isLargeApplyPatch
} from "../missions/trustActionGate";
import type { Mission, ToolCall } from "../types";

const cfgOff = { get<T>(_k: string, d?: T): T {
  return d as T;
} };
const cfgOn = {
  get<T>(k: string, d?: T): T {
    if (k === "myAi.missions.trustGates.enabled") return true as T;
    if (k === "myAi.missions.trustGates.largePatchMinChars") return 100 as T;
    if (k === "myAi.missions.trustGates.manyModifiedFilesThreshold") return 2 as T;
    return d as T;
  }
};

test("isDependencyStyleShellCommand", () => {
  assert.equal(isDependencyStyleShellCommand("npm install"), true);
  assert.equal(isDependencyStyleShellCommand("echo hello"), false);
});

test("isLargeApplyPatch", () => {
  assert.equal(isLargeApplyPatch("x".repeat(60), "y".repeat(50), 100), true);
  assert.equal(isLargeApplyPatch("a", "b", 100), false);
});

test("evaluateTrustActionGate: off", () => {
  const mission = { memory: [] } as unknown as Mission;
  const call = { tool: "runCommand", args: { command: "npm install" } } as ToolCall;
  assert.equal(evaluateTrustActionGate({ cfg: cfgOff, mission, call, commandText: "npm install", approved: false }), undefined);
});

test("evaluateTrustActionGate: dependency command blocks without verified claim", () => {
  const mission = { memory: [] } as unknown as Mission;
  const call = { tool: "runCommand", args: { command: "npm ci" } } as ToolCall;
  const g = evaluateTrustActionGate({ cfg: cfgOn, mission, call, commandText: "npm ci", approved: false });
  assert.ok(g?.requiresApproval);
});

test("evaluateTrustActionGate: allows with verified claim memory", () => {
  const mission = {
    memory: [{ id: "1", ts: Date.now(), kind: "finding", text: "x", tags: ["claim:verified_web"] }]
  } as unknown as Mission;
  const call = { tool: "runCommand", args: { command: "npm ci" } } as ToolCall;
  assert.equal(evaluateTrustActionGate({ cfg: cfgOn, mission, call, commandText: "npm ci", approved: false }), undefined);
});

test("evaluateTrustActionGate: large patch + many files", () => {
  const mission = {
    memory: [],
    filesModified: ["a", "b", "c"]
  } as unknown as Mission;
  const call = { tool: "applyPatch", args: { path: "x" } } as ToolCall;
  const g = evaluateTrustActionGate({
    cfg: cfgOn,
    mission,
    call,
    applyPatchSearch: "x".repeat(60),
    applyPatchReplace: "y".repeat(50),
    approved: false
  });
  assert.ok(g?.requiresApproval);
});
