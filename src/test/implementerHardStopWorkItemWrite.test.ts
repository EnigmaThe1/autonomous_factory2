import test from "node:test";
import assert from "node:assert/strict";
import type { WorkItem } from "../types";
import { memento } from "./missionOrchestratorTestHarness";
import { MissionStore } from "../missions/MissionStore";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import { updateWorkItemWithImplementerHardStopInvariant } from "../missions/implementerHardStopWorkItemWrite";

function mkStore(): MissionStore {
  return new MissionStore(memento(), memento(), new DiskMissionPersistence(new WorkspacePaths()));
}

const impl = (status: WorkItem["status"], hc?: WorkItem["hardStopClass"]): WorkItem => ({
  id: "wi1",
  title: "i",
  role: "implementer",
  status,
  prompt: "p",
  ...(hc !== undefined ? { hardStopClass: hc } : {})
});

test("updateWorkItemWithImplementerHardStopInvariant: blocked without known class throws", async () => {
  const store = mkStore();
  const miss = await store.create("t", "p", "ollama");
  const item = impl("running");
  await store.enqueue(miss.id, [item]);
  await assert.rejects(
    () => updateWorkItemWithImplementerHardStopInvariant(store, miss.id, item, { status: "blocked", output: "x" }),
    /cannot be persisted as blocked without a known hardStopClass/
  );
});

test("updateWorkItemWithImplementerHardStopInvariant: blocked with class in patch ok", async () => {
  const store = mkStore();
  const miss = await store.create("t2", "p", "ollama");
  const item = impl("todo");
  await store.enqueue(miss.id, [item]);
  await updateWorkItemWithImplementerHardStopInvariant(store, miss.id, item, {
    status: "blocked",
    hardStopClass: "tool_failure",
    output: "fail"
  });
  const w = store.get(miss.id)!.queue[0];
  assert.equal(w.status, "blocked");
  assert.equal(w.hardStopClass, "tool_failure");
});

test("updateWorkItemWithImplementerHardStopInvariant: optional implementer skips invariant", async () => {
  const store = mkStore();
  const miss = await store.create("t3", "p", "ollama");
  const item: WorkItem = {
    id: "wi1",
    title: "i",
    role: "implementer",
    status: "todo",
    prompt: "p",
    requiredForCompletion: false
  };
  await store.enqueue(miss.id, [item]);
  await updateWorkItemWithImplementerHardStopInvariant(store, miss.id, item, { status: "failed", output: "x" });
  assert.equal(store.get(miss.id)!.queue[0].status, "failed");
});

test("updateWorkItemWithImplementerHardStopInvariant: failed without known class throws", async () => {
  const store = mkStore();
  const miss = await store.create("t5", "p", "ollama");
  const item = impl("running");
  await store.enqueue(miss.id, [item]);
  await assert.rejects(
    () => updateWorkItemWithImplementerHardStopInvariant(store, miss.id, item, { status: "failed", output: "x" }),
    /cannot be persisted as failed without a known hardStopClass/
  );
});

test("updateWorkItemWithImplementerHardStopInvariant: blocked uses existing item hardStopClass when not in patch", async () => {
  const store = mkStore();
  const miss = await store.create("t6", "p", "ollama");
  const item = impl("blocked", "approval_pending");
  await store.enqueue(miss.id, [item]);
  await updateWorkItemWithImplementerHardStopInvariant(store, miss.id, item, { output: "extra" });
  assert.ok(store.get(miss.id)!.queue[0].output?.includes("extra"));
});

test("updateWorkItemWithImplementerHardStopInvariant: reviewer blocked without class ok", async () => {
  const store = mkStore();
  const miss = await store.create("t4", "p", "ollama");
  const item: WorkItem = { id: "r1", title: "r", role: "reviewer", status: "todo", prompt: "p" };
  await store.enqueue(miss.id, [item]);
  await updateWorkItemWithImplementerHardStopInvariant(store, miss.id, item, { status: "blocked", output: "x" });
  assert.equal(store.get(miss.id)!.queue[0].status, "blocked");
});
