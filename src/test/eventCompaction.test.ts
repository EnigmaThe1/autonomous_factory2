import test from "node:test";
import assert from "node:assert/strict";
import { compactEvents } from "../missions/eventCompaction";
import type { MissionEvent } from "../types";

function makeEvent(
  level: MissionEvent["level"],
  source: string,
  message: string,
  ts: number
): MissionEvent {
  return { id: `e-${ts}`, ts, level, source, message };
}

function makeEvents(count: number, source = "tool:readFile", level: MissionEvent["level"] = "info"): MissionEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvent(level, source, `Event ${i + 1}`, 1000 + i * 100)
  );
}

test("compactEvents: no-op when under threshold", () => {
  const events = makeEvents(50);
  const result = compactEvents(events, 100);
  assert.equal(result.events.length, 50);
  assert.equal(result.compactedCount, 0);
});

test("compactEvents: compacts old events, keeps recent", () => {
  const events = makeEvents(200);
  const result = compactEvents(events, 100);
  assert.ok(result.events.length < 200, "should reduce total event count");
  assert.ok(result.compactedCount > 0, "should report compacted count");
  const recentIds = events.slice(-100).map((e) => e.id);
  for (const id of recentIds) {
    assert.ok(result.events.some((e) => e.id === id), `recent event ${id} should be preserved`);
  }
});

test("compactEvents: preserves error events individually", () => {
  const events = [
    ...makeEvents(150, "tool:readFile", "info"),
    makeEvent("error", "orchestrator", "Critical failure", 50000),
    ...makeEvents(50, "tool:writeFile", "info"),
  ];
  const result = compactEvents(events, 60);
  const errorEvents = result.events.filter((e) => e.level === "error" && e.message === "Critical failure");
  assert.equal(errorEvents.length, 1, "error event should be preserved individually");
});

test("compactEvents: groups same-source same-level events within window", () => {
  const events = Array.from({ length: 300 }, (_, i) =>
    makeEvent("info", "tool:readFile", `Read file ${i}`, 1000 + i * 100)
  );
  const result = compactEvents(events, 100);
  const compactedPart = result.events.slice(0, result.events.length - 100);
  assert.ok(compactedPart.length < 200, "old events should be grouped");
  const digestEvent = compactedPart.find((e) => e.message.includes("[") && e.message.includes("events]"));
  assert.ok(digestEvent, "should have at least one digest event");
});

test("compactEvents: different sources create separate groups", () => {
  const events = [
    ...makeEvents(100, "tool:readFile"),
    ...makeEvents(100, "tool:writeFile"),
    ...makeEvents(50, "orchestrator"),
  ];
  const result = compactEvents(events, 50);
  const sources = new Set(result.events.map((e) => e.source));
  assert.ok(sources.has("tool:readFile"), "readFile source preserved");
  assert.ok(sources.has("tool:writeFile"), "writeFile source preserved");
  assert.ok(sources.has("orchestrator"), "orchestrator source preserved");
});

test("compactEvents: maintains chronological order", () => {
  const events = makeEvents(200);
  const result = compactEvents(events, 100);
  for (let i = 1; i < result.events.length; i++) {
    assert.ok(result.events[i].ts >= result.events[i - 1].ts, `event ${i} should be >= previous ts`);
  }
});

test("compactEvents: handles single event", () => {
  const events = [makeEvent("info", "test", "only one", 1000)];
  const result = compactEvents(events, 100);
  assert.equal(result.events.length, 1);
  assert.equal(result.compactedCount, 0);
});

test("compactEvents: digest message shows count and preview", () => {
  const events = Array.from({ length: 200 }, (_, i) =>
    makeEvent("info", "tool:readFile", `Reading src/file${i}.ts`, 1000 + i * 50)
  );
  const result = compactEvents(events, 50);
  const digest = result.events.find((e) => e.message.includes("events]"));
  assert.ok(digest, "should have digest event");
  assert.ok(digest!.message.includes("Reading"), "digest should preview actual messages");
});

test("compactEvents: warn events in old range get compacted", () => {
  const events = makeEvents(200, "tool:runCommand", "warn");
  const result = compactEvents(events, 100);
  assert.ok(result.compactedCount > 0, "warn events should be compacted");
});
