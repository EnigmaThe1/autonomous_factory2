import test from "node:test";
import assert from "node:assert/strict";
import type { Mission } from "../types";
import { memento } from "./missionOrchestratorTestHarness";
import { MissionStore } from "../missions/MissionStore";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { WorkspacePaths } from "../storage/WorkspacePaths";

function mkStore(): MissionStore {
  return new MissionStore(memento(), memento(), new DiskMissionPersistence(new WorkspacePaths()));
}

function stubDiskMissionPersistence(payload: { missions: Mission[] }): DiskMissionPersistence {
  return {
    async loadAll() {
      return payload.missions;
    },
    async saveMission() {},
    async deleteMission() {},
    async ensureFolders() {},
    getAndClearLoadIssues: () => []
  } as unknown as DiskMissionPersistence;
}

test("subscribeMissionMutation: fires on microtask after upsert", async () => {
  const store = mkStore();
  const m = await store.create("n1", "p", "ollama");
  let hits = 0;
  const unsub = store.subscribeMissionMutation(m.id, () => {
    hits += 1;
  });
  await store.updateMission(m.id, { blocker: "b" });
  // `updateMission` queues delivery on a microtask; it runs before this continuation resumes.
  assert.equal(hits, 1);
  unsub();
  await store.updateMission(m.id, { blocker: "c" });
  await new Promise<void>((r) => queueMicrotask(r));
  assert.equal(hits, 1);
});

test("subscribeMissionMutation: fires after deleteMission", async () => {
  const store = mkStore();
  const m = await store.create("n2", "p", "ollama");
  let hits = 0;
  store.subscribeMissionMutation(m.id, () => {
    hits += 1;
  });
  await store.updateMission(m.id, { status: "failed", blocker: "x", validationState: "failed" });
  await new Promise<void>((r) => queueMicrotask(r));
  assert.equal(hits, 1);
  await store.deleteMission(m.id);
  await new Promise<void>((r) => queueMicrotask(r));
  assert.equal(hits, 2);
});

test("subscribeMissionMutation: hydrateFromDisk notifies when disk version wins merge", async () => {
  const diskPayload: { missions: Mission[] } = { missions: [] };
  const store = new MissionStore(memento(), memento(), stubDiskMissionPersistence(diskPayload));
  const m = await store.create("hyd-wins", "p", "ollama");
  let hits = 0;
  store.subscribeMissionMutation(m.id, () => {
    hits += 1;
  });
  const inner = store.get(m.id)!;
  diskPayload.missions = [
    {
      ...inner,
      updatedAt: inner.updatedAt + 50_000,
      status: "blocked",
      blocker: "hydrate-from-disk",
      validationState: "failed"
    }
  ];
  await store.hydrateFromDisk();
  assert.equal(store.get(m.id)!.status, "blocked");
  assert.equal(hits, 1);
});

test("subscribeMissionMutation: hydrateFromDisk skips notify when disk is older", async () => {
  const diskPayload: { missions: Mission[] } = { missions: [] };
  const store = new MissionStore(memento(), memento(), stubDiskMissionPersistence(diskPayload));
  const m = await store.create("hyd-old", "p", "ollama");
  let hits = 0;
  store.subscribeMissionMutation(m.id, () => {
    hits += 1;
  });
  const inner = store.get(m.id)!;
  diskPayload.missions = [
    {
      ...inner,
      updatedAt: Math.max(0, inner.updatedAt - 1),
      status: "blocked",
      blocker: "stale-disk",
      validationState: "failed"
    }
  ];
  await store.hydrateFromDisk();
  assert.equal(store.get(m.id)!.status, "queued");
  assert.equal(hits, 0);
});
