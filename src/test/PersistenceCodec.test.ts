import test from "node:test";
import assert from "node:assert/strict";
import { unwrapGlobalMemory, unwrapMcpSessions, unwrapMission, wrapGlobalMemory, wrapMcpSessions, wrapMission } from "../storage/PersistenceCodec";

test("mission codec supports envelope and legacy payload", () => {
  const mission = {
    id: "m1",
    title: "t",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "queued",
    activeProviderId: "ollama",
    queue: [],
    memory: [],
    events: [],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: { closureRequired: true, requireReviewerBeforeComplete: true, requireValidatorBeforeComplete: true, requireImplementerBeforeComplete: true, autoContinue: true, maxAutoRounds: 1, minCompletedWorkItems: 1, stallReplanThreshold: 1 },
    validationState: "pending",
    roundsCompleted: 0
  } as any;
  assert.equal(unwrapMission(mission).id, "m1");
  assert.equal(unwrapMission(wrapMission(mission)).id, "m1");
});

test("memory and mcp codecs support envelope and legacy arrays", () => {
  const memory = [{ id: "a", ts: 1, kind: "user", text: "x" }] as any;
  const sessions = [{ name: "s", status: "ready" }] as any;
  assert.equal(unwrapGlobalMemory(memory).length, 1);
  assert.equal(unwrapGlobalMemory(wrapGlobalMemory(memory)).length, 1);
  assert.equal(unwrapMcpSessions(sessions).length, 1);
  assert.equal(unwrapMcpSessions(wrapMcpSessions(sessions)).length, 1);
});

test("codec rejects unsupported schema versions", () => {
  const unsupported = { schemaVersion: 99, kind: "mission", payload: { id: "m" } };
  assert.throws(() => unwrapMission(unsupported as any), /Unsupported persistence schema version/);
});

test("codec migrates legacy schemaVersion 0 envelopes", () => {
  const legacy = {
    schemaVersion: 0,
    kind: "global_memory",
    data: [{ id: "m", ts: 1, kind: "user", text: "legacy" }]
  };
  const result = unwrapGlobalMemory(legacy as any);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "legacy");
});

test("codec migrates legacy mission and mcp envelopes", () => {
  const legacyMission = {
    schemaVersion: 0,
    kind: "mission",
    data: {
      id: "m1",
      title: "legacy",
      queue: [],
      memory: [],
      prompt: "p",
      createdAt: 1,
      updatedAt: 1,
      status: "queued",
      activeProviderId: "ollama",
      events: [],
      checkpoints: [],
      approvals: [],
      currentStep: 0,
      policy: {
        closureRequired: true,
        requireReviewerBeforeComplete: true,
        requireValidatorBeforeComplete: true,
        requireImplementerBeforeComplete: true,
        autoContinue: true,
        maxAutoRounds: 1,
        minCompletedWorkItems: 1,
        stallReplanThreshold: 1
      }
    }
  };
  const legacyMcp = { schemaVersion: 0, kind: "mcp_sessions", data: [{ name: "s", status: "ready" }] };
  assert.equal(unwrapMission(legacyMission as any).id, "m1");
  assert.equal(unwrapMcpSessions(legacyMcp as any).length, 1);
});
