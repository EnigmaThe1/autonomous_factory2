import test from "node:test";
import assert from "node:assert/strict";
import type { Mission } from "../types";
import { uid } from "../util";
import { memento } from "./missionOrchestratorTestHarness";
import { MissionStore } from "../missions/MissionStore";
import type { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
function stubDisk(payload: { missions: Mission[]; deleted?: string[] }): DiskMissionPersistence {
  const deleted = payload.deleted ?? [];
  return {
    async loadAll() {
      return payload.missions;
    },
    async saveMission() {},
    async deleteMission(missionId: string) {
      deleted.push(missionId);
    },
    async ensureFolders() {},
    getAndClearLoadIssues: () => []
  } as unknown as DiskMissionPersistence;
}

/** P4-T-002: same hydrate pass can apply disk winner for one id and keep memento for another. */
test("hydrateFromDisk: per-mission updatedAt — disk wins A, memento wins B, both missions preserved", async () => {
  const diskPayload: { missions: Mission[] } = { missions: [] };
  const store = new MissionStore(memento(), memento(), stubDisk(diskPayload));
  const a = await store.create("mission-a", "pa", "ollama");
  const b = await store.create("mission-b", "pb", "ollama");
  const aSnap = store.get(a.id)!;
  const bSnap = store.get(b.id)!;

  diskPayload.missions = [
    {
      ...aSnap,
      updatedAt: aSnap.updatedAt + 100_000,
      status: "blocked",
      blocker: "disk-newer-a",
      validationState: "failed"
    },
    {
      ...bSnap,
      updatedAt: Math.max(0, bSnap.updatedAt - 1),
      status: "failed",
      blocker: "stale-disk-b",
      validationState: "failed"
    }
  ];

  await store.hydrateFromDisk();

  const afterA = store.get(a.id)!;
  const afterB = store.get(b.id)!;
  assert.equal(afterA.status, "blocked");
  assert.equal(afterA.blocker, "disk-newer-a");
  assert.equal(afterB.status, "queued");
  assert.equal(afterB.blocker, undefined);
  assert.equal(store.list().length, 2);
});

/** P4-T-002: deleteMission removes global state entry and invokes disk delete. */
test("deleteMission: calls disk.deleteMission and mission is gone from list()", async () => {
  const deletedIds: string[] = [];
  const store = new MissionStore(
    memento(),
    memento(),
    {
      async loadAll() {
        return [];
      },
      async saveMission() {},
      async deleteMission(missionId: string) {
        deletedIds.push(missionId);
      },
      async ensureFolders() {},
      getAndClearLoadIssues: () => []
    } as unknown as DiskMissionPersistence
  );
  const m = await store.create("del-hydrate", "p", "ollama");
  await store.updateMission(m.id, { status: "failed", blocker: "x", validationState: "failed" });
  await store.deleteMission(m.id);
  assert.equal(store.get(m.id), undefined);
  assert.ok(deletedIds.includes(m.id));
});

/** P4-T-002: disk introduces mission id absent from memento → merged list includes it. */
test("hydrateFromDisk: disk-only mission id is merged into global list", async () => {
  const diskPayload: { missions: Mission[] } = { missions: [] };
  const store = new MissionStore(memento(), memento(), stubDisk(diskPayload));
  const keep = await store.create("keep", "p", "ollama");
  const inner = store.get(keep.id)!;
  const orphanId = uid("mission");
  diskPayload.missions = [
    {
      ...inner,
      id: orphanId,
      title: "from-disk",
      updatedAt: inner.updatedAt + 1,
      queue: [],
      events: [],
      checkpoints: [],
      approvals: []
    }
  ];
  await store.hydrateFromDisk();
  assert.ok(store.get(orphanId));
  assert.equal(store.list().length, 2);
});
