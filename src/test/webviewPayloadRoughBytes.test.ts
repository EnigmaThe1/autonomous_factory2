import test from "node:test";
import assert from "node:assert/strict";
import { roughWebviewSnapshotPayloadBytes } from "../ui/webviewPayloadRoughBytes";
import type { SidebarSnapshot } from "../ui/protocol";

function minimalSnapshot(overrides: Partial<SidebarSnapshot> = {}): SidebarSnapshot {
  return {
    providers: [],
    defaultProvider: "p",
    defaultModel: "m",
    resolvedDefaultModel: "m",
    providerCredentialStatus: [],
    providerModelPresets: {},
    providerLiveModelCatalog: {},
    providerHealth: {},
    providerBaseUrls: {},
    providerSavedModels: {},
    missions: [],
    globalMemoryRecent: [],
    consoleLines: [],
    agents: [],
    tools: { builtinTools: [], mcpToolCount: 0, mcpSessionCount: 0 },
    settings: {
      defaultProvider: "p",
      defaultModel: "m",
      autoResumeOnStartup: false,
      heartbeatSeconds: 60,
      allowTerminal: false,
      requireWriteApproval: false,
      useNativeChatParticipant: false,
      mcpConfigPath: "",
      autoRevealOnActivation: false,
      defaultTab: "chat",
      missionBlueprintMode: false,
      missionPreBlueprintClarification: false,
      missionRequireBlueprintApproval: true
    },
    pendingApprovals: [],
    approvalBundles: [],
    agentLive: [],
    timeline: [],
    mcpOnboarding: {
      status: "no_servers",
      configuredPath: "",
      resolvedAbsolutePath: null,
      canCreateStarter: false,
      hint: "",
      starterDestinationRelative: null
    },
    missionList: { includeArchived: false, totalCount: 0, archivedCount: 0 },
    routingPresetTemplates: {},
    traceSessionId: "t",
    snapshotPublishSeq: 1,
    sourceRefreshSeq: 1,
    ...overrides
  } as SidebarSnapshot;
}

test("roughWebviewSnapshotPayloadBytes: scales with mission memory rows", () => {
  const m = {
    id: "m1",
    title: "t",
    status: "running" as const,
    currentStep: "s",
    updatedAt: 1,
    createdAt: 1,
    queue: [],
    events: [],
    approvals: [],
    memory: Array.from({ length: 100 }, (_, i) => ({
      id: `mem-${i}`,
      ts: i,
      kind: "note",
      text: "x".repeat(200)
    })),
    checkpoints: []
  };
  const a = roughWebviewSnapshotPayloadBytes(minimalSnapshot({ missions: [m as any] }));
  const b = roughWebviewSnapshotPayloadBytes(minimalSnapshot({ missions: [{ ...m, memory: [] } as any] }));
  assert.ok(a > b + 10_000);
});
