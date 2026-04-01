import test from "node:test";
import assert from "node:assert/strict";
import { parseValidatorModelOutput } from "../agents/validatorOutputParse";

function finalizeValidatorParsed(parsed: ReturnType<typeof parseValidatorModelOutput>) {
  const { toolCalls, blocked, complete } = parsed;
  let { nextWorkItems } = parsed;
  if (complete && !blocked) nextWorkItems = [];
  const decision = blocked ? "blocked" : complete ? "complete" : "needs_followup";
  return { toolCalls, nextWorkItems, decision };
}

test("parseValidatorModelOutput extracts WORK lines", () => {
  const t = parseValidatorModelOutput("WORK:implementer:Title - prompt here");
  assert.equal(t.nextWorkItems.length, 1);
  assert.equal(t.complete, false);
  assert.equal(finalizeValidatorParsed(t).decision, "needs_followup");
});

test("COMPLETE without WORK is complete", () => {
  const t = parseValidatorModelOutput("Looks good.\nCOMPLETE:");
  const f = finalizeValidatorParsed(t);
  assert.equal(f.decision, "complete");
  assert.equal(f.nextWorkItems.length, 0);
});

test("COMPLETE with WORK lines collapses to complete (no follow-up enqueue)", () => {
  const t = parseValidatorModelOutput(
    "COMPLETE:\nOptional note\nWORK:implementer:Extra - should not apply when complete"
  );
  assert.equal(t.nextWorkItems.length, 1);
  const f = finalizeValidatorParsed(t);
  assert.equal(f.decision, "complete");
  assert.equal(f.nextWorkItems.length, 0);
});

test("BLOCKER wins over COMPLETE", () => {
  const t = parseValidatorModelOutput("BLOCKER:\nCOMPLETE:");
  const f = finalizeValidatorParsed(t);
  assert.equal(f.decision, "blocked");
});
