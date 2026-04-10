import test from "node:test";
import assert from "node:assert/strict";
import { extractFixtureMissionPrompt } from "../fixtures/fixturePrompt";

test("extractFixtureMissionPrompt: extracts section under '## Mission prompt'", () => {
  const md = [
    "# Fixture",
    "",
    "## Mission prompt",
    "",
    "Line 1",
    "Line 2",
    "",
    "## Expected behavior",
    "x"
  ].join("\n");
  assert.equal(extractFixtureMissionPrompt(md), ["Line 1", "Line 2"].join("\n"));
});

test("extractFixtureMissionPrompt: falls back to whole file when section missing", () => {
  const md = "# X\n\nNo section.";
  assert.equal(extractFixtureMissionPrompt(md), md.trim());
});

