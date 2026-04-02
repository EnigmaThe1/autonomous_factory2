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
