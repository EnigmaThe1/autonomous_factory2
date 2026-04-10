/**
 * Post–Wave 4: section-contract proof for modular `snapshotSection` publishers.
 * Mock host + real `*ForHost` modules + postMessage capture (no VS Code webview).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import type { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import type { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import type { MissionStore } from "../missions/MissionStore";
import type { ProgramDirectory } from "../missions/ProgramDirectory";
import type { Mission } from "../types";
import type { ExtToUiMessage, SidebarSnapshot, SnapshotSectionId } from "../ui/protocol";
import type { AiSidebarSectionPublishHost } from "../ui/aiSidebarSectionPublishHost";
import { postAuxiliarySectionImmediateForHost } from "../ui/aiSidebarSectionPublishAuxiliary";
import { postGlobalMemorySectionImmediateForHost } from "../ui/aiSidebarSectionPublishGlobalMemory";
import { postMissionDashboardSnapshotImmediateForHost } from "../ui/aiSidebarSectionMissionMerge";
import { postProviderSettingsChromeSectionImmediateForHost } from "../ui/aiSidebarSectionPublishProviderChrome";
import {
  runSidebarPollWarmExecution,
  type SidebarPollWarmExecutionHost
} from "../ui/aiSidebarPollWarmExecution";

function traceRecorder(): { traceLogger: ExtensionTraceLogger } {
  const traceLogger = {
    log() {}
  } as unknown as ExtensionTraceLogger;
  return { traceLogger };
}

function minimalMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    title: "t",
    status: "running",
    currentStep: "s",
    updatedAt: 1,
    createdAt: 1,
    queue: [],
    events: [],
    approvals: [],
    ...overrides
  } as Mission;
}

/** Minimal `SidebarSnapshot` for section merge tests; includes `snapshotPublishSeq` for base-seq contract. */
function sectionContractBaseSnapshot(): SidebarSnapshot {
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
      maxStepsPerRun: 128,
      unlimitedStepsPerRun: false,
      allowTerminal: false,
      requireWriteApproval: false,
      requireApprovalForNonImplementerMutations: true,
      autoApproveAllToolRequests: false,
      useNativeChatParticipant: false,
      mcpConfigPath: "",
      autoRevealOnActivation: false,
      defaultTab: "chat",
      missionBlueprintMode: false,
      missionPreBlueprintClarification: false,
      missionRequireBlueprintApproval: true,
      traceAutoRefreshIntervalMs: 10000
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
    traceSessionId: "test",
    routingPresetTemplates: {},
    snapshotPublishSeq: 100,
    sourceRefreshSeq: 1
  };
}

function mockWorkspaceConfiguration(): vscode.WorkspaceConfiguration {
  return {
    get: (_section: string, defaultValue?: unknown) => defaultValue
  } as vscode.WorkspaceConfiguration;
}

type HarnessOptions = {
  /** When true (default), auxiliary resolve bumps tool count so publish path runs; when false, slice matches → noop. */
  auxiliaryPublishDrift?: boolean;
};

function createSectionPublishHarness(opts: HarnessOptions = {}) {
  const auxiliaryPublishDrift = opts.auxiliaryPublishDrift !== false;
  const snapshotSectionPosts: Extract<ExtToUiMessage, { type: "snapshotSection" }>[] = [];

  let lastPosted: SidebarSnapshot | undefined = sectionContractBaseSnapshot();
  let missionsSeq = 0;
  let auxiliarySeq = 0;
  let globalMemorySeq = 0;
  let providerChromeSeq = 0;

  const missions: Mission[] = [minimalMission()];
  const missionStore = { list: () => missions } as unknown as MissionStore;

  const globalMemoryItems = [{ id: "g1", ts: 10, kind: "note", text: "gm" }];
  const globalMemory = {
    list: () => globalMemoryItems
  } as unknown as GlobalMemoryStore;

  const webviewView = { webview: {} } as unknown as vscode.WebviewView;

  const programDirectory = {
    list: () => [],
    get: () => undefined
  } as unknown as ProgramDirectory;

  const host: AiSidebarSectionPublishHost = {
    traceLogger: traceRecorder().traceLogger,
    getWebviewView: () => webviewView,
    getLastPostedSnapshot: () => lastPosted,
    missionStore,
    programDirectory,
    getIncludeArchivedMissions: () => false,
    resolveFocusedMission: (ms) => ms[0],
    buildAgentStatus: () => [],
    buildAgentLive: () => [],
    computeMissionDerivedSlices: () => ({
      pendingApprovals: [],
      approvalBundles: [],
      timeline: [],
      recentToolEvents: []
    }),
    getWorkspaceConfiguration: () => mockWorkspaceConfiguration(),
    getTraceSessionId: () => "trace-sess",
    bumpMissionsSectionSeq: () => {
      missionsSeq += 1;
      return missionsSeq;
    },
    bumpAuxiliarySectionSeq: () => {
      auxiliarySeq += 1;
      return auxiliarySeq;
    },
    bumpGlobalMemorySectionSeq: () => {
      globalMemorySeq += 1;
      return globalMemorySeq;
    },
    bumpProviderChromeSectionSeq: () => {
      providerChromeSeq += 1;
      return providerChromeSeq;
    },
    globalMemory,
    globalMemoryHeadFingerprintFromStoreHead: () =>
      globalMemoryItems.map((i) => `${i.id}:${i.ts}`).join(","),
    readMcpAuxiliaryWarmCaches: () => undefined,
    tryAuxiliaryFingerprintFromStableWarmPollCache: () => ({ fingerprint: undefined }),
    resolveMcpAuxiliarySlice: async () => {
      const last = lastPosted;
      if (!last) throw new Error("no last");
      const bump = auxiliaryPublishDrift ? 1 : 0;
      const slice = {
        mcpOnboarding: last.mcpOnboarding,
        mcpToolCount: last.tools.mcpToolCount + bump,
        mcpSessionCount: last.tools.mcpSessionCount
      };
      return { slice, usedWarmCaches: true };
    },
    resolveProviderSettingsChromeHostSlice: async () => ({
      slice: { defaultProvider: "from_chrome_slice", resolvedDefaultModel: "rm-chrome" },
      usedWarmCredentialCache: false
    }),
    postMessage: (msg) => {
      if (msg.type === "snapshotSection") {
        snapshotSectionPosts.push(msg);
        lastPosted = msg.snapshot;
      }
    }
  };

  return {
    host,
    get lastPosted() {
      return lastPosted;
    },
    setLastSnapshot(s: SidebarSnapshot | undefined) {
      lastPosted = s;
    },
    snapshotSectionPosts,
    get seq() {
      return { missionsSeq, auxiliarySeq, globalMemorySeq, providerChromeSeq };
    }
  };
}

function isSnapshotSection(m: ExtToUiMessage): m is Extract<ExtToUiMessage, { type: "snapshotSection" }> {
  return m.type === "snapshotSection";
}

// --- Per-section shape + seq (direct module / host) ---

test("section contract: mission snapshotSection shape, base seq, and representative payload", () => {
  const h = createSectionPublishHarness();
  postMissionDashboardSnapshotImmediateForHost(h.host, "ix-m1");
  assert.equal(h.snapshotSectionPosts.length, 1);
  const msg = h.snapshotSectionPosts[0];
  assert.ok(isSnapshotSection(msg));
  assert.equal(msg.type, "snapshotSection");
  assert.equal(msg.section, "missions");
  assert.equal(msg.sectionBasePublishSeq, 100);
  assert.equal(msg.sectionSeq, 1);
  assert.equal(msg.snapshot.snapshotPublishSeq, 100);
  assert.equal(msg.snapshot.fastRefreshKind, "mission");
  assert.equal(msg.snapshot.missions.length, 1);
  assert.equal(msg.snapshot.missions[0]?.id, "m1");
});

test("section contract: providerChrome snapshotSection shape and slice merge marker", async () => {
  const h = createSectionPublishHarness();
  await postProviderSettingsChromeSectionImmediateForHost(h.host, undefined, "test_chrome_event", {
    reason: "unit"
  });
  assert.equal(h.snapshotSectionPosts.length, 1);
  const msg = h.snapshotSectionPosts[0];
  assert.equal(msg.section, "providerChrome");
  assert.equal(msg.sectionBasePublishSeq, 100);
  assert.equal(msg.sectionSeq, 1);
  assert.equal(msg.snapshot.defaultProvider, "from_chrome_slice");
  assert.equal(msg.snapshot.resolvedDefaultModel, "rm-chrome");
});

test("section contract: globalMemory snapshotSection shape and head slice", () => {
  const h = createSectionPublishHarness();
  postGlobalMemorySectionImmediateForHost(h.host);
  assert.equal(h.snapshotSectionPosts.length, 1);
  const msg = h.snapshotSectionPosts[0];
  assert.equal(msg.section, "globalMemory");
  assert.equal(msg.sectionBasePublishSeq, 100);
  assert.equal(msg.sectionSeq, 1);
  assert.equal(msg.snapshot.globalMemoryRecent.length, 1);
  assert.equal(msg.snapshot.globalMemoryRecent[0]?.id, "g1");
});

test("section contract: auxiliary snapshotSection when MCP slice fingerprint changes", async () => {
  const h = createSectionPublishHarness({ auxiliaryPublishDrift: true });
  const res = await postAuxiliarySectionImmediateForHost(h.host);
  assert.equal(res.published, true);
  assert.equal(h.snapshotSectionPosts.length, 1);
  const msg = h.snapshotSectionPosts[0];
  assert.equal(msg.section, "auxiliary");
  assert.equal(msg.sectionBasePublishSeq, 100);
  assert.equal(msg.sectionSeq, 1);
  assert.equal(msg.snapshot.tools.mcpToolCount, 1);
  assert.equal(msg.snapshot.tools.mcpSessionCount, 0);
});

test("section contract: auxiliary noop does not post or bump auxiliary seq", async () => {
  const h = createSectionPublishHarness({ auxiliaryPublishDrift: false });
  const before = h.seq.auxiliarySeq;
  const res = await postAuxiliarySectionImmediateForHost(h.host);
  assert.equal(res.published, false);
  assert.equal(h.snapshotSectionPosts.length, 0);
  assert.equal(h.seq.auxiliarySeq, before);
});

test("section contract: mission sectionSeq increments monotonically; base seq unchanged", () => {
  const h = createSectionPublishHarness();
  postMissionDashboardSnapshotImmediateForHost(h.host, undefined);
  postMissionDashboardSnapshotImmediateForHost(h.host, undefined);
  assert.equal(h.snapshotSectionPosts.length, 2);
  assert.equal(h.snapshotSectionPosts[0]?.sectionSeq, 1);
  assert.equal(h.snapshotSectionPosts[1]?.sectionSeq, 2);
  assert.equal(h.snapshotSectionPosts[0]?.sectionBasePublishSeq, 100);
  assert.equal(h.snapshotSectionPosts[1]?.sectionBasePublishSeq, 100);
});

test("section contract: postMessage path centralizes lastPostedSnapshot updates between multi posts", () => {
  const h = createSectionPublishHarness();
  postMissionDashboardSnapshotImmediateForHost(h.host, undefined);
  postGlobalMemorySectionImmediateForHost(h.host);
  assert.equal(h.snapshotSectionPosts.length, 2);
  assert.equal(h.lastPosted?.missions.length, 1);
  assert.equal(h.lastPosted?.globalMemoryRecent.length, 1);
  assert.equal(h.lastPosted?.snapshotPublishSeq, 100);
});

// --- Warm poll: ordered snapshotSection identifiers via real section publishers ---

function makePollHostUsingSectionHarness(
  baseline: { missionFp: string; globalMemFp: string; providerChromeFp: string },
  live: { missionFp: string; memFp: string; providerFp: string },
  harness: ReturnType<typeof createSectionPublishHarness>
): SidebarPollWarmExecutionHost {
  const { traceLogger } = traceRecorder();
  return {
    traceLogger,
    computeMissionFingerprintForPollRoute: () => ({
      missionFp: live.missionFp,
      usedPollMissionFingerprintCache: false
    }),
    computeGlobalMemoryHeadFingerprintForPollRoute: () => ({
      memFp: live.memFp,
      usedPollGlobalMemoryHeadCache: false
    }),
    computeProviderChromeFingerprintLive: async () => ({
      fingerprint: live.providerFp,
      usedWarmCredentialPath: false
    }),
    postAuxiliarySectionImmediate: () => postAuxiliarySectionImmediateForHost(harness.host),
    postGlobalMemorySectionImmediate: () => postGlobalMemorySectionImmediateForHost(harness.host),
    postMissionDashboardSnapshotImmediate: () => postMissionDashboardSnapshotImmediateForHost(harness.host, undefined),
    postProviderSettingsChromeSectionImmediate: (id, ev, ex) =>
      postProviderSettingsChromeSectionImmediateForHost(harness.host, id, ev, ex),
    refreshDashboard: async () => {}
  };
}

test("poll warm (section posts): auxiliary-only route emits snapshotSection auxiliary when slice drifts", async () => {
  const baseline = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const live = { missionFp: "m", memFp: "g", providerFp: "p" };
  const harness = createSectionPublishHarness({ auxiliaryPublishDrift: true });
  const host = makePollHostUsingSectionHarness(baseline, live, harness);
  await runSidebarPollWarmExecution(host, "interval", baseline);
  const sections = harness.snapshotSectionPosts.map((m) => m.section);
  assert.deepEqual(sections, ["auxiliary" as SnapshotSectionId]);
});

test("poll warm (section posts): mission + globalMemory drift → missions then globalMemory", async () => {
  const baseline = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const live = { missionFp: "M", memFp: "G", providerFp: "p" };
  const harness = createSectionPublishHarness({ auxiliaryPublishDrift: true });
  const host = makePollHostUsingSectionHarness(baseline, live, harness);
  await runSidebarPollWarmExecution(host, "interval", baseline);
  const sections = harness.snapshotSectionPosts.map((m) => m.section);
  assert.deepEqual(sections, ["missions", "globalMemory"] as SnapshotSectionId[]);
});

test("poll warm (section posts): globalMemory + provider drift → globalMemory then providerChrome", async () => {
  const baseline = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const live = { missionFp: "m", memFp: "G", providerFp: "P" };
  const harness = createSectionPublishHarness({ auxiliaryPublishDrift: true });
  const host = makePollHostUsingSectionHarness(baseline, live, harness);
  await runSidebarPollWarmExecution(host, "interval", baseline);
  const sections = harness.snapshotSectionPosts.map((m) => m.section);
  assert.deepEqual(sections, ["globalMemory", "providerChrome"] as SnapshotSectionId[]);
});

test("poll warm (section posts): triple-axis drift → providerChrome then missions then globalMemory", async () => {
  const baseline = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const live = { missionFp: "M", memFp: "G", providerFp: "P" };
  const harness = createSectionPublishHarness({ auxiliaryPublishDrift: true });
  const host = makePollHostUsingSectionHarness(baseline, live, harness);
  await runSidebarPollWarmExecution(host, "reveal", baseline);
  const sections = harness.snapshotSectionPosts.map((m) => m.section);
  assert.deepEqual(sections, ["providerChrome", "missions", "globalMemory"] as SnapshotSectionId[]);
});

test("poll warm (section posts): mission + provider drift → providerChrome then missions", async () => {
  const baseline = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const live = { missionFp: "M", memFp: "g", providerFp: "P" };
  const harness = createSectionPublishHarness({ auxiliaryPublishDrift: true });
  const host = makePollHostUsingSectionHarness(baseline, live, harness);
  await runSidebarPollWarmExecution(host, "interval", baseline);
  const sections = harness.snapshotSectionPosts.map((m) => m.section);
  assert.deepEqual(sections, ["providerChrome", "missions"] as SnapshotSectionId[]);
});
