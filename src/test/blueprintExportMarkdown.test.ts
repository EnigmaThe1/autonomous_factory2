import test from "node:test";
import assert from "node:assert/strict";
import { missionBlueprintToMarkdown, slugifyMissionTitleForFile } from "../missions/blueprintExportMarkdown";
import type { MissionBlueprint } from "../missions/missionBlueprintTypes";

test("slugifyMissionTitleForFile: basic", () => {
  assert.equal(slugifyMissionTitleForFile("Hello World!"), "hello-world");
  assert.equal(slugifyMissionTitleForFile("   "), "mission");
});

test("missionBlueprintToMarkdown: includes steps and criteria", () => {
  const bp: MissionBlueprint = {
    version: 1,
    createdAt: 1_700_000_000_000,
    status: "awaiting_approval",
    requirementsSummary: "Do the thing",
    architectureSummary: "TS + tests",
    steps: [
      {
        id: "s1",
        title: "First",
        summary: "Build it",
        roleHint: "implementer",
        acceptanceCriteria: ["Tests pass"],
        status: "pending"
      }
    ],
    amendments: []
  };
  const md = missionBlueprintToMarkdown("My Mission", bp);
  assert.match(md, /# Mission blueprint: My Mission/);
  assert.match(md, /Do the thing/);
  assert.match(md, /### s1: First/);
  assert.match(md, /Tests pass/);
  assert.match(md, /awaiting_approval/);
});

test("missionBlueprintToMarkdown: includes pre-blueprint Q&A when provided", () => {
  const bp: MissionBlueprint = {
    version: 1,
    createdAt: 1,
    status: "approved",
    requirementsSummary: "R",
    architectureSummary: "A",
    steps: [
      {
        id: "s1",
        title: "T",
        summary: "S",
        roleHint: "implementer",
        acceptanceCriteria: ["C"],
        status: "pending"
      }
    ],
    amendments: []
  };
  const md = missionBlueprintToMarkdown("M", bp, {
    questions: ["Which stack?"],
    answersMarkdown: "Use Node.",
    status: "complete"
  });
  assert.match(md, /## Pre-blueprint clarification/);
  assert.match(md, /Which stack/);
  assert.match(md, /Operator answers/);
  assert.match(md, /Use Node/);
});
