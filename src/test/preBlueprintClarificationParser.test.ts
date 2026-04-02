import test from "node:test";
import assert from "node:assert/strict";
import { parsePreBlueprintClarificationOutput } from "../missions/preBlueprintClarificationParser";

test("parsePreBlueprintClarificationOutput: happy path", () => {
  const text = "```json\n" + JSON.stringify({ questions: ["Preferred stack?", "Deadline?"] }) + "\n```";
  const { questions, errors } = parsePreBlueprintClarificationOutput(text);
  assert.equal(errors.length, 0);
  assert.deepEqual(questions, ["Preferred stack?", "Deadline?"]);
});

test("parsePreBlueprintClarificationOutput: rejects empty questions", () => {
  const { questions, errors } = parsePreBlueprintClarificationOutput(JSON.stringify({ questions: [] }));
  assert.ok(errors.length);
  assert.equal(questions.length, 0);
});

test("parsePreBlueprintClarificationOutput: skips blank strings", () => {
  const { questions, errors } = parsePreBlueprintClarificationOutput(
    JSON.stringify({ questions: ["", "  ", "Only this"] })
  );
  assert.equal(errors.length, 0);
  assert.deepEqual(questions, ["Only this"]);
});
