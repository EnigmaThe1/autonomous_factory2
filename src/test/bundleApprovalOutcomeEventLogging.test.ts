import test from "node:test";
import assert from "node:assert/strict";
import { AiSidebarProvider } from "../ui/AiSidebarProvider";

function miniMission(id: string) {
  return { id, events: [], approvals: [] } as any;
}

async function callResolveBundle(fake: any, bundleId: string, approved: boolean) {
  // resolveBundle is a private method; access via prototype for contract tests.
  const fn = (AiSidebarProvider.prototype as any).resolveBundle;
  await fn.call(fake, bundleId, approved, "ix");
}

test("bundle approve logs per affected mission (once)", async () => {
  const events: any[] = [];
  const m1 = miniMission("m1");
  const fake = {
    missionStore: {
      list: () => [m1],
      get: (id: string) => (id === "m1" ? m1 : undefined),
      saveEvent: async (_id: string, e: any) => events.push(e)
    },
    orchestrator: {
      resolveApproval: async () => ({ kind: "approved_continuation_scheduled", missionId: "m1" })
    },
    buildApprovalBundles: () => [{ id: "b1", missionId: "m1", approvalIds: ["a1", "a2"] }],
    focusMission: () => undefined,
    postMessage: () => undefined
  };
  await callResolveBundle(fake, "b1", true);
  assert.equal(events.length, 1);
  assert.match(events[0].message, /bundle action/i);
  assert.match(events[0].message, /scheduled/i);
  assert.ok(!/completed/i.test(events[0].message));
});

test("bundle reject logs per affected mission (once)", async () => {
  const events: any[] = [];
  const m1 = miniMission("m1");
  const fake = {
    missionStore: {
      list: () => [m1],
      get: (id: string) => (id === "m1" ? m1 : undefined),
      saveEvent: async (_id: string, e: any) => events.push(e)
    },
    orchestrator: {
      resolveApproval: async () => ({ kind: "rejected_mission_blocked", missionId: "m1", statusAfter: "blocked" })
    },
    buildApprovalBundles: () => [{ id: "b1", missionId: "m1", approvalIds: ["a1"] }],
    focusMission: () => undefined,
    postMessage: () => undefined
  };
  await callResolveBundle(fake, "b1", false);
  assert.equal(events.length, 1);
  assert.match(events[0].message, /rejected via bundle/i);
});

test("bundle action: unknown approvals do not fabricate mission event", async () => {
  const events: any[] = [];
  const m1 = miniMission("m1");
  const fake = {
    missionStore: {
      list: () => [m1],
      get: (id: string) => (id === "m1" ? m1 : undefined),
      saveEvent: async (_id: string, e: any) => events.push(e)
    },
    orchestrator: {
      resolveApproval: async () => ({ kind: "noop_unknown_approval", missionId: "m1", approvalId: "a1" })
    },
    buildApprovalBundles: () => [{ id: "b1", missionId: "m1", approvalIds: ["a1"] }],
    focusMission: () => undefined,
    postMessage: () => undefined
  };
  await callResolveBundle(fake, "b1", true);
  assert.equal(events.length, 0);
});

test("bundle action: duplicate consecutive bundle events are suppressed", async () => {
  const events: any[] = [];
  const m1 = miniMission("m1");
  m1.events.push({ id: "e1", ts: 1, level: "info", source: "operator-action", message: "Approval accepted via bundle action; mission continuation was scheduled." });
  const fake = {
    missionStore: {
      list: () => [m1],
      get: (id: string) => (id === "m1" ? m1 : undefined),
      saveEvent: async (_id: string, e: any) => events.push(e)
    },
    orchestrator: {
      resolveApproval: async () => ({ kind: "approved_continuation_scheduled", missionId: "m1" })
    },
    buildApprovalBundles: () => [{ id: "b1", missionId: "m1", approvalIds: ["a1"] }],
    focusMission: () => undefined,
    postMessage: () => undefined
  };
  await callResolveBundle(fake, "b1", true);
  assert.equal(events.length, 0);
});

