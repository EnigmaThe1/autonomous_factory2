import test from "node:test";
import assert from "node:assert/strict";
import { isLikelyOperatorTestMission } from "../missions/missionTestHeuristic";

test("heuristic: word test", () => {
  assert.equal(isLikelyOperatorTestMission("hello", "this is a test"), true);
});

test("heuristic: testing", () => {
  assert.equal(isLikelyOperatorTestMission("testing mission", "x"), true);
});

test("heuristic: test7 style", () => {
  assert.equal(isLikelyOperatorTestMission("test 7", "p"), true);
});

test("heuristic: TestMission camel (no bare word test)", () => {
  assert.equal(isLikelyOperatorTestMission("TestMission", "run"), true);
});

test("heuristic: latest does not match", () => {
  assert.equal(isLikelyOperatorTestMission("latest run", "ok"), false);
});

test("heuristic: contest does not match", () => {
  assert.equal(isLikelyOperatorTestMission("contest", "x"), false);
});
