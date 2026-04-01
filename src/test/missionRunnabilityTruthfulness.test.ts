import test from "node:test";
import assert from "node:assert/strict";

const {
  describeMissionCurrentNext,
  formatMissionCardCurrentNextHtml,
  formatInspectorCurrentNextHtml
} = require("../../media/chat/missionQueueCurrentNext.js");

test("runnability: dependency-blocked downstream todo is not presented as next", () => {
  const desc = describeMissionCurrentNext([
    { id: "impl", status: "blocked", role: "implementer", title: "Implement tranche" },
    { id: "rev", status: "todo", role: "reviewer", title: "Review tranche", dependsOn: ["impl"] }
  ]);
  assert.equal(desc.current, undefined);
  assert.equal(desc.next, undefined);
  assert.equal(desc.dependencyBlocked, undefined);
  assert.equal(desc.pausedOn.role, "implementer");
});

test("runnability: pass-limit queued mission with runnable continuation points to the eligible todo", () => {
  const desc = describeMissionCurrentNext([
    { id: "plan", status: "done", role: "planner", title: "Plan tranche" },
    { id: "impl", status: "todo", role: "implementer", title: "Implement tranche", dependsOn: ["plan"] },
    { id: "rev", status: "todo", role: "reviewer", title: "Review tranche", dependsOn: ["impl"] }
  ]);
  assert.equal(desc.pausedOn, undefined);
  assert.equal(desc.dependencyBlocked, undefined);
  assert.equal(desc.next.role, "implementer");
  assert.match(desc.next.title, /Implement tranche/);
});

test("runnability: blocked mission with downstream todos keeps blocker primary and hides downstream next", () => {
  const desc = describeMissionCurrentNext([
    { id: "impl", status: "failed", role: "implementer", title: "Implement tranche" },
    { id: "rev", status: "todo", role: "reviewer", title: "Review tranche" },
    { id: "val", status: "todo", role: "validator", title: "Validation tranche" }
  ]);
  assert.equal(desc.next, undefined);
  assert.equal(desc.dependencyBlocked, undefined);
  assert.equal(desc.pausedOn.role, "implementer");
});

test("runnability: skipped and already-satisfied rows expose later runnable work truthfully", () => {
  const desc = describeMissionCurrentNext([
    { id: "impl-a", status: "done", completionKind: "already_satisfied", role: "implementer", title: "Already satisfied tranche" },
    { id: "impl-b", status: "skipped", role: "implementer", title: "Superseded tranche" },
    { id: "rev", status: "todo", role: "reviewer", title: "Review tranche", dependsOn: ["impl-a", "impl-b"] }
  ]);
  assert.equal(desc.pausedOn, undefined);
  assert.equal(desc.dependencyBlocked, undefined);
  assert.equal(desc.next.role, "reviewer");
});

test("runnability: earlier dependency-blocked todo does not hide later runnable todo after neutralized history", () => {
  const desc = describeMissionCurrentNext([
    { id: "impl-stale", status: "skipped", role: "implementer", title: "Superseded stale implementer" },
    { id: "rev-wait", status: "todo", role: "reviewer", title: "Review still blocked on missing follow-up", dependsOn: ["missing-followup"] },
    { id: "impl-active", status: "done", completionKind: "already_satisfied", role: "implementer", title: "Active implementer satisfied" },
    { id: "val-ready", status: "todo", role: "validator", title: "Validation ready now", dependsOn: ["impl-active"] }
  ]);
  assert.equal(desc.dependencyBlocked, undefined);
  assert.equal(desc.next.role, "validator");
  assert.match(desc.next.title, /Validation ready now/);
});

test("runnability: blocked mission semantics stay primary even if another todo is dependency-blocked", () => {
  const desc = describeMissionCurrentNext([
    { id: "impl", status: "blocked", role: "implementer", title: "Implement tranche" },
    { id: "rev", status: "todo", role: "reviewer", title: "Review tranche", dependsOn: ["impl"] },
    { id: "val", status: "todo", role: "validator", title: "Validation tranche", dependsOn: ["rev"] }
  ]);
  assert.equal(desc.next, undefined);
  assert.equal(desc.dependencyBlocked, undefined);
  assert.equal(desc.pausedOn.role, "implementer");
});

test("runnability formatting: dependency-blocked wording stays distinct from next-step wording", () => {
  const desc = describeMissionCurrentNext([
    { id: "rev", status: "todo", role: "reviewer", title: "Review tranche", dependsOn: ["missing"] }
  ]);
  const card = formatMissionCardCurrentNextHtml(desc, (x: string) => x);
  const inspector = formatInspectorCurrentNextHtml(desc, (x: string) => x);
  assert.match(card, /Waiting on dependency:/);
  assert.doesNotMatch(card, /Next:/);
  assert.match(inspector, /Waiting on dependency:/);
  assert.doesNotMatch(inspector, /Next step:/);
});
