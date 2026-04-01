import test from "node:test";
import assert from "node:assert/strict";
import { MissionFileTracker } from "../missions/MissionFileTracker";

function makeMockStore() {
  const missions = new Map<string, { filesModified?: string[] }>();
  missions.set("m-1", {});
  return {
    get: (id: string) => missions.get(id) || null,
    updateMission: async (id: string, patch: { filesModified?: string[] }) => {
      const m = missions.get(id);
      if (m) Object.assign(m, patch);
    },
  };
}

test("MissionFileTracker: tracks files", () => {
  const tracker = new MissionFileTracker(makeMockStore() as never);
  tracker.trackFile("m-1", "/src/main.ts");
  tracker.trackFile("m-1", "/src/util.ts");
  const files = tracker.getModifiedFiles("m-1");
  assert.deepEqual(files, ["/src/main.ts", "/src/util.ts"]);
});

test("MissionFileTracker: deduplicates files", () => {
  const tracker = new MissionFileTracker(makeMockStore() as never);
  tracker.trackFile("m-1", "/src/main.ts");
  tracker.trackFile("m-1", "/src/main.ts");
  tracker.trackFile("m-1", "/src/main.ts");
  const files = tracker.getModifiedFiles("m-1");
  assert.equal(files.length, 1);
});

test("MissionFileTracker: separates missions", () => {
  const tracker = new MissionFileTracker(makeMockStore() as never);
  tracker.trackFile("m-1", "/src/a.ts");
  tracker.trackFile("m-2", "/src/b.ts");
  assert.deepEqual(tracker.getModifiedFiles("m-1"), ["/src/a.ts"]);
  assert.deepEqual(tracker.getModifiedFiles("m-2"), ["/src/b.ts"]);
});

test("MissionFileTracker: returns sorted files", () => {
  const tracker = new MissionFileTracker(makeMockStore() as never);
  tracker.trackFile("m-1", "/src/z.ts");
  tracker.trackFile("m-1", "/src/a.ts");
  tracker.trackFile("m-1", "/src/m.ts");
  assert.deepEqual(tracker.getModifiedFiles("m-1"), ["/src/a.ts", "/src/m.ts", "/src/z.ts"]);
});

test("MissionFileTracker: empty for unknown mission", () => {
  const tracker = new MissionFileTracker(makeMockStore() as never);
  assert.deepEqual(tracker.getModifiedFiles("unknown"), []);
});

test("MissionFileTracker: flush merges with existing", async () => {
  const store = makeMockStore();
  store.get("m-1")!.filesModified = ["/src/existing.ts"];
  const tracker = new MissionFileTracker(store as never);
  tracker.trackFile("m-1", "/src/new.ts");
  await tracker.flush("m-1");
  assert.deepEqual(store.get("m-1")!.filesModified, ["/src/existing.ts", "/src/new.ts"]);
});

test("MissionFileTracker: clear removes tracked files", () => {
  const tracker = new MissionFileTracker(makeMockStore() as never);
  tracker.trackFile("m-1", "/src/a.ts");
  tracker.clear("m-1");
  assert.deepEqual(tracker.getModifiedFiles("m-1"), []);
});
