import test from "node:test";
import assert from "node:assert/strict";
import { unwrapMission, wrapMission, PERSISTENCE_SCHEMA_VERSION } from "../storage/PersistenceCodec";

test("persistence integration: legacy v0 round-trips through unwrap and canonical wrap", () => {
  const legacy = {
    schemaVersion: 0,
    kind: "mission",
    data: {
      id: "m-int",
      title: "t",
      queue: [],
      memory: [],
      prompt: "p",
      createdAt: 1,
      updatedAt: 2,
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
  const mission = unwrapMission(legacy as any);
  const wrapped = wrapMission(mission);
  assert.equal(wrapped.schemaVersion, PERSISTENCE_SCHEMA_VERSION);
  assert.equal(wrapped.kind, "mission");
  assert.equal(unwrapMission(wrapped).id, "m-int");
});
