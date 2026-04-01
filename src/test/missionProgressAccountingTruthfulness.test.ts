import test from "node:test";
import assert from "node:assert/strict";
import { mergeMissionListIntoSnapshotForHost } from "../ui/aiSidebarSectionMissionMerge";

function makeMission(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    prompt: "p",
    createdAt: 1,
    updatedAt: 1,
    status: "queued",
    activeProviderId: "p",
    activeModel: "m",
    queue: [],
    memory: [],
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
      maxAutoRounds: 24,
      minCompletedWorkItems: 1,
      stallReplanThreshold: 3,
      policyPreset: "balanced"
    },
    validationState: "pending",
    routing: { preset: "default" },
    ...overrides
  };
}

function makeBaseSnapshot() {
  return {
    settings: { defaultProvider: "openai" },
    tools: { builtinTools: [], mcpToolCount: 0, mcpSessionCount: 0, recentToolEvents: [] },
    providerCredentialStatus: {},
    providerBaseUrls: {},
    providerSavedModels: {},
    providers: [],
    defaultProvider: "openai",
    defaultModel: "gpt",
    resolvedDefaultModel: "gpt",
    pendingApprovals: [],
    approvalBundles: [],
    timeline: [],
    agentLive: [],
    agents: [],
    globalMemoryRecent: [],
    missionList: { includeArchived: false, totalCount: 0, archivedCount: 0 }
  } as any;
}

test("mergeMissionListIntoSnapshotForHost: visible missions and total/archive counts stay aligned", () => {
  const visible = makeMission("visible");
  const archived = makeMission("archived", { status: "completed", archivedAt: 99 });
  const all = [visible, archived];
  const host = {
    getWorkspaceConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
    missionStore: { list: () => all },
    getIncludeArchivedMissions: () => false,
    resolveFocusedMission: (missions: typeof all) => missions[0],
    buildAgentStatus: () => [],
    computeMissionDerivedSlices: () => ({ pendingApprovals: [], approvalBundles: [], timeline: [], recentToolEvents: [] }),
    buildAgentLive: () => [],
    getTraceSessionId: () => "trace-1"
  } as any;

  const merged = mergeMissionListIntoSnapshotForHost(host, makeBaseSnapshot());
  assert.deepEqual(merged.missions.map((m: any) => m.id), ["visible"]);
  assert.equal(merged.missionList.totalCount, 2);
  assert.equal(merged.missionList.archivedCount, 1);
  assert.equal(merged.focusedMission?.id, "visible");
});

test("mergeMissionListIntoSnapshotForHost: includeArchived toggles list visibility without corrupting totals", () => {
  const visible = makeMission("visible");
  const archived = makeMission("archived", { status: "completed", archivedAt: 99 });
  const all = [visible, archived];
  const host = {
    getWorkspaceConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
    missionStore: { list: () => all },
    getIncludeArchivedMissions: () => true,
    resolveFocusedMission: (missions: typeof all) => missions[1],
    buildAgentStatus: () => [],
    computeMissionDerivedSlices: () => ({ pendingApprovals: [], approvalBundles: [], timeline: [], recentToolEvents: [] }),
    buildAgentLive: () => [],
    getTraceSessionId: () => "trace-2"
  } as any;

  const merged = mergeMissionListIntoSnapshotForHost(host, makeBaseSnapshot());
  assert.deepEqual(merged.missions.map((m: any) => m.id), ["visible", "archived"]);
  assert.equal(merged.missionList.totalCount, 2);
  assert.equal(merged.missionList.archivedCount, 1);
  assert.equal(merged.missionList.includeArchived, true);
  assert.equal(merged.focusedMission?.id, "archived");
});
