import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StartMissionResult } from "../missions/MissionOrchestrator";
import { dispatchUi_startMission } from "../ui/aiSidebarDispatchChatRefresh";

const repoRoot = join(__dirname, "..", "..");

function startedMissionResult(overrides: Partial<StartMissionResult> = {}): StartMissionResult {
  const mission = {
    id: "mission-1",
    title: "Visible start mission",
    prompt: "Investigate the start path",
    status: "queued",
    currentStep: "starting",
    createdAt: 1,
    updatedAt: 1,
    activeProviderId: "openai",
    activeModel: "gpt-4.1",
    roundsCompleted: 0,
    events: [],
    queue: []
  } as unknown as StartMissionResult["mission"];
  return {
    mission,
    pass: {
      kind: "scheduled_pass",
      missionId: mission.id
    },
    ...overrides
  } as StartMissionResult;
}

test("dispatchUi_startMission: valid UI start keeps interaction id, posts outcome, and allows handler-tail refresh", async () => {
  const posted: Array<{ message: unknown; opts?: { interactionId?: string } }> = [];
  const focused: Array<{ missionId: string; interactionId?: string }> = [];
  const traces: Array<{ event?: string; interactionId?: string; data?: unknown }> = [];
  const events: Array<{ missionId: string; message: string }> = [];
  const startCalls: Array<{ title: string; prompt: string; providerId: string; model?: string }> = [];
  const mission = {
    id: "mission-1",
    title: "Visible start mission",
    prompt: "Investigate the start path",
    status: "queued",
    currentStep: "starting",
    createdAt: 1,
    updatedAt: 1,
    activeProviderId: "openai",
    activeModel: "gpt-4.1",
    roundsCompleted: 0,
    events: [] as Array<unknown>
  };

  const host = {
    traceLogger: { log: (entry: { event?: string; interactionId?: string; data?: unknown }) => traces.push(entry) },
    orchestrator: {
      startMission: async (title: string, prompt: string, providerId: string, model?: string) => {
        startCalls.push({ title, prompt, providerId, model });
        return startedMissionResult({ mission: mission as unknown as StartMissionResult["mission"] });
      }
    },
    missionStore: {
      get: (missionId: string) => (missionId === mission.id ? mission : undefined),
      saveEvent: async (missionId: string, event: { message: string }) => {
        events.push({ missionId, message: event.message });
      }
    },
    focusMission: (missionId: string, interactionId?: string) => {
      focused.push({ missionId, interactionId });
    },
    postMessage: (message: unknown, opts?: { interactionId?: string }) => {
      posted.push({ message, opts });
    }
  };

  const suppress = await dispatchUi_startMission(host as any, {
    type: "startMission",
    title: "  Visible start mission  ",
    prompt: "  Investigate the button path  ",
    providerId: "openai",
    model: "gpt-4.1",
    interactionId: "ix-start-1"
  });

  assert.equal(suppress, false, "startMission should allow the guaranteed handler-tail refresh");
  assert.deepEqual(startCalls, [
    {
      title: "Visible start mission",
      prompt: "Investigate the button path",
      providerId: "openai",
      model: "gpt-4.1"
    }
  ]);
  assert.deepEqual(focused, [{ missionId: "mission-1", interactionId: "ix-start-1" }]);
  assert.deepEqual(posted, [
    {
      message: { type: "info", message: "Mission started; execution has been scheduled." },
      opts: { interactionId: "ix-start-1" }
    }
  ]);
  assert.ok(traces.some((entry) => entry.event === "ui_start_mission_dispatch_begin" && entry.interactionId === "ix-start-1"));
  assert.ok(traces.some((entry) => entry.event === "ui_start_mission_dispatch_outcome" && entry.interactionId === "ix-start-1"));
  assert.deepEqual(events, [
    {
      missionId: "mission-1",
      message: "Mission start requested; execution was scheduled."
    }
  ]);
});

test("dispatchUi_startMission: blank prompt becomes visible error instead of silent no-op", async () => {
  const posted: Array<{ message: unknown; opts?: { interactionId?: string } }> = [];
  const traces: Array<{ event?: string; interactionId?: string; data?: unknown }> = [];
  let startCalled = false;

  const host = {
    traceLogger: { log: (entry: { event?: string; interactionId?: string; data?: unknown }) => traces.push(entry) },
    orchestrator: {
      startMission: async () => {
        startCalled = true;
        return startedMissionResult();
      }
    },
    missionStore: {
      get: () => undefined,
      saveEvent: async () => undefined
    },
    focusMission: () => undefined,
    postMessage: (message: unknown, opts?: { interactionId?: string }) => {
      posted.push({ message, opts });
    }
  };

  const suppress = await dispatchUi_startMission(host as any, {
    type: "startMission",
    title: "",
    prompt: "   ",
    providerId: "openai",
    model: "gpt-4.1",
    interactionId: "ix-start-blank"
  });

  assert.equal(suppress, true, "invalid payload should surface an error without attempting a mission refresh path");
  assert.equal(startCalled, false);
  assert.deepEqual(posted, [
    {
      message: { type: "error", message: "Mission start requires a prompt." },
      opts: { interactionId: "ix-start-blank" }
    }
  ]);
  assert.ok(traces.some((entry) => entry.event === "ui_start_mission_dispatch_begin" && entry.interactionId === "ix-start-blank"));
  assert.ok(traces.some((entry) => entry.event === "ui_start_mission_dispatch_rejected" && entry.interactionId === "ix-start-blank"));
});

test("command path contract: command-palette start still uses orchestrator.startMission plus visible sidebar focus", () => {
  const src = readFileSync(join(repoRoot, "src/commands/registerMissionCommands.ts"), "utf8");
  assert.match(
    src,
    /registerCommand\("myAi\.startMission", async \(\) => \{[\s\S]*?orchestrator\.startMission\(title, prompt, providerId, model\)[\s\S]*?sidebar\.reveal\(\)[\s\S]*?sidebar\.focusMission\(mission\.id\)[\s\S]*?presentStartMissionOutcome\(started\)/,
    "command-palette start should share the same mission creation engine and a visible sidebar outcome"
  );
});
