import test from "node:test";
import assert from "node:assert/strict";
import { buildMissionDiagnosticSnapshot } from "../missions/missionSnapshotExport";
import type { Mission } from "../types";

test("buildMissionDiagnosticSnapshot shape", () => {
  const m: Mission = {
    id: "m",
    title: "Test",
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "blocked",
    activeProviderId: "ollama",
    blockReasonCode: "tool_failure",
    blocker: "x",
    queue: [{ id: "w", title: "I", role: "implementer", status: "failed", prompt: "p" }],
    memory: [],
    events: [{ id: "e", ts: 1, level: "info", source: "orchestrator", message: "hi", telemetryKind: "work_started" }],
    checkpoints: [],
    approvals: [],
    currentStep: 0,
    policy: {
      closureRequired: false,
      requireReviewerBeforeComplete: false,
      requireValidatorBeforeComplete: false,
      requireImplementerBeforeComplete: false,
      autoContinue: true,
      maxAutoRounds: 50,
      minCompletedWorkItems: 0,
      stallReplanThreshold: 3
    }
  };
  const s = buildMissionDiagnosticSnapshot(m);
  assert.equal(s.schema, "myAi.missionDiagnosticSnapshot/v1");
  assert.equal((s.mission as { status: string }).status, "blocked");
  assert.ok(Array.isArray(s.queue));
  assert.ok(Array.isArray(s.recentEvents));
});
