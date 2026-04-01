import test from "node:test";
import assert from "node:assert/strict";
import { applyToolDrivenValidatorCompletion } from "../missions/toolDrivenValidatorCompletion";
import { AgentTurnResult } from "../types";

test("infers complete when validator used tools, needs_followup, no WORK/BLOCKER", () => {
  const result: AgentTurnResult = {
    summary: "TOOL:{}\nreadFile succeeded; file looks correct.",
    toolCalls: [{ tool: "readFile", args: { path: "hello_note.md" } }],
    decision: "needs_followup",
    nextWorkItems: []
  };
  const out = applyToolDrivenValidatorCompletion("validator", result);
  assert.equal(out.decision, "complete");
  assert.equal(out.nextWorkItems?.length ?? 0, 0);
});

test("does not infer when WORK line present", () => {
  const result: AgentTurnResult = {
    summary: "WORK:implementer:Fix typo - update file",
    toolCalls: [{ tool: "readFile", args: { path: "a.md" } }],
    decision: "needs_followup"
  };
  const out = applyToolDrivenValidatorCompletion("validator", result);
  assert.equal(out.decision, "needs_followup");
});

test("does not infer without tool calls", () => {
  const result: AgentTurnResult = {
    summary: "Looks fine.",
    decision: "needs_followup"
  };
  const out = applyToolDrivenValidatorCompletion("validator", result);
  assert.equal(out.decision, "needs_followup");
});

test("does not change implementer results", () => {
  const result: AgentTurnResult = {
    summary: "done",
    toolCalls: [{ tool: "readFile", args: {} }],
    decision: "needs_followup"
  };
  const out = applyToolDrivenValidatorCompletion("implementer", result);
  assert.equal(out.decision, "needs_followup");
});
