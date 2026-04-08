import test from "node:test";
import assert from "node:assert/strict";
import {
  checkpointSummaryForTerminalWorkItem,
  extractKeywords,
  flattenSubItems,
  isPotentiallyMutatingToolCall,
  mutatingToolTarget,
  readinessMessageText
} from "../missions/orchestrator/orchestratorLeafHelpers";
import type { ToolCall, WorkItem } from "../types";

test("readinessMessageText: errors and warnings", () => {
  const text = readinessMessageText({
    ok: false,
    report: { errors: ["e1"], warnings: ["w1"] }
  });
  assert.ok(text.includes("Errors:"));
  assert.ok(text.includes("e1"));
  assert.ok(text.includes("Warnings:"));
  assert.ok(text.includes("w1"));
});

test("readinessMessageText: empty report sections omitted", () => {
  assert.equal(readinessMessageText({ ok: true, report: { errors: [], warnings: [] } }), "");
});

test("isPotentiallyMutatingToolCall: read-only builtins false", () => {
  assert.equal(isPotentiallyMutatingToolCall({ tool: "readFile", args: {} }), false);
});

test("isPotentiallyMutatingToolCall: default mutating", () => {
  assert.equal(isPotentiallyMutatingToolCall({ tool: "writeFile", args: {} }), true);
});

test("mutatingToolTarget: path from args", () => {
  assert.equal(mutatingToolTarget({ tool: "writeFile", args: { path: "src/x.ts" } }), "src/x.ts");
  assert.equal(mutatingToolTarget({ tool: "writeFile", args: {} }), undefined);
});

test("checkpointSummaryForTerminalWorkItem", () => {
  const item = { role: "implementer", title: "Fix bug" } as WorkItem;
  assert.match(checkpointSummaryForTerminalWorkItem(item, "blocked"), /blocked/);
  assert.match(checkpointSummaryForTerminalWorkItem(item, "failed"), /failed/);
});

test("flattenSubItems: sub-items before marked-done parent", () => {
  const sub: WorkItem = { id: "s1", title: "sub", role: "implementer", status: "todo", prompt: "p" };
  const parent: WorkItem = {
    id: "p1",
    title: "parent",
    role: "planner",
    status: "todo",
    prompt: "p",
    subItems: [sub]
  };
  const flat = flattenSubItems([parent]);
  assert.equal(flat[0].id, "s1");
  assert.equal(flat[1].id, "p1");
  assert.equal(flat[1].status, "done");
  assert.equal(flat[1].subItems, undefined);
});

test("extractKeywords: caps and filters stop words", () => {
  const k = extractKeywords("The quick brown fox jumps for testing-code", 3);
  assert.ok(k.length <= 3);
  assert.ok(k.includes("quick") || k.includes("brown") || k.includes("fox"));
  assert.ok(!k.includes("the"));
});
