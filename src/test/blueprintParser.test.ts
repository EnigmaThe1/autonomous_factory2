import test from "node:test";
import assert from "node:assert/strict";
import { parseBlueprintModelOutput } from "../missions/blueprintParser";

test("parseBlueprintModelOutput: happy path from fenced JSON", () => {
  const text = `Here is the plan:\n\`\`\`json\n${JSON.stringify({
    requirementsSummary: "Build shop",
    architectureSummary: "Next.js + API",
    steps: [
      {
        id: "s1",
        title: "Scaffold",
        summary: "Create app",
        roleHint: "implementer",
        acceptanceCriteria: ["App runs"],
        dependsOn: []
      },
      {
        id: "s2",
        title: "Cart",
        summary: "Add cart",
        roleHint: "implementer",
        acceptanceCriteria: ["Cart works"],
        dependsOn: ["s1"]
      }
    ]
  })}\n\`\`\``;
  const { blueprint, errors } = parseBlueprintModelOutput(text, { now: 1 });
  assert.equal(errors.length, 0);
  assert.ok(blueprint);
  assert.equal(blueprint!.steps.length, 2);
  assert.equal(blueprint!.steps[1].dependsOn?.[0], "s1");
});

test("parseBlueprintModelOutput: rejects missing acceptanceCriteria", () => {
  const { blueprint, errors } = parseBlueprintModelOutput(
    JSON.stringify({
      requirementsSummary: "R",
      architectureSummary: "A",
      steps: [{ id: "x", title: "t", summary: "s", roleHint: "implementer", acceptanceCriteria: [] }]
    })
  );
  assert.ok(!blueprint);
  assert.ok(errors.some((e) => e.includes("acceptanceCriteria")));
});
