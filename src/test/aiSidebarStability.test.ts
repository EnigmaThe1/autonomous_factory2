/**
 * Pre–Wave 3 stabilization: high-risk surfaces from sidebar modular refactor
 * (poll routing, fingerprints, refresh queue/coalesce/supersede/stale, poll-warm call order).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionTraceLogger } from "../diagnostics/ExtensionTraceLogger";
import type { SidebarSnapshot } from "../ui/protocol";
import { decidePollDashboardRoute, type PollDashboardRoutePlan } from "../ui/aiSidebarPollDecision";
import {
  enqueueSidebarRefreshDashboard,
  runSidebarRefreshDashboardCycle,
  type SidebarRefreshOrchestrationHost
} from "../ui/aiSidebarRefreshOrchestration";
import { runSidebarPollWarmExecution, type SidebarPollWarmExecutionHost } from "../ui/aiSidebarPollWarmExecution";
import type { Mission } from "../types";
import {
  globalMemoryHeadFingerprint,
  materialFingerprintCombined,
  missionVisibleListFingerprint,
  mcpAuxiliaryFingerprintFromSlice,
  stableSortedJson
} from "../ui/aiSidebarFingerprints";

function traceRecorder(): { traceLogger: ExtensionTraceLogger; events: string[] } {
  const events: string[] = [];
  const traceLogger = {
    log(input: { event?: string }) {
      if (typeof input.event === "string") events.push(input.event);
    }
  } as unknown as ExtensionTraceLogger;
  return { traceLogger, events };
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

function emptySnapshot(): SidebarSnapshot {
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
    routingPresetTemplates: {}
  };
}

// --- Pure: poll routing ---

test("decidePollDashboardRoute covers all 8 axis combinations deterministically", () => {
  const cases: Array<[boolean, boolean, boolean, PollDashboardRoutePlan]> = [
    [true, true, true, { kind: "auxiliary_section" }],
    [true, true, false, { kind: "provider_chrome_section", reason: "poll_baseline_provider_only_drift" }],
    [true, false, true, { kind: "global_memory_section" }],
    [true, false, false, { kind: "multi_section", reason: "global_memory_and_provider_drift", sections: ["globalMemory", "providerChrome"] }],
    [false, true, true, { kind: "missions_section", reason: "mission_baseline_only_drift" }],
    [false, true, false, { kind: "multi_section", reason: "mission_and_provider_drift", sections: ["providerChrome", "missions"] }],
    [false, false, true, { kind: "multi_section", reason: "mission_and_global_memory_drift", sections: ["missions", "globalMemory"] }],
    [
      false,
      false,
      false,
      {
        kind: "multi_section",
        reason: "mission_global_memory_and_provider_drift",
        sections: ["providerChrome", "missions", "globalMemory"]
      }
    ]
  ];
  for (const [missionOk, memOk, providerOk, expected] of cases) {
    assert.deepEqual(decidePollDashboardRoute(missionOk, memOk, providerOk), expected);
  }
});

// --- Pure: fingerprints ---

test("missionVisibleListFingerprint prefixes includeArchived and counts archived missions", () => {
  const active = minimalMission({ id: "a", archivedAt: undefined });
  const archived = minimalMission({ id: "z", archivedAt: 99 });
  const fpExclude = missionVisibleListFingerprint([active], [active, archived], false);
  const fpInclude = missionVisibleListFingerprint([active, archived], [active, archived], true);
  assert.ok(fpExclude.startsWith("0|"), "exclude-archived mode");
  assert.ok(fpInclude.startsWith("1|"), "include-archived mode");
  assert.ok(fpExclude.includes("|1|"), "archivedCount=1 in fingerprint");
});

test("globalMemoryHeadFingerprint is stable id:ts join", () => {
  assert.equal(globalMemoryHeadFingerprint([]), "");
  assert.equal(
    globalMemoryHeadFingerprint([
      { id: "x", ts: 1, kind: "k", text: "t" },
      { id: "y", ts: 2, kind: "k", text: "t2" }
    ]),
    "x:1,y:2"
  );
});

test("materialFingerprintCombined uses fixed axis delimiter", () => {
  assert.equal(materialFingerprintCombined("a", "b", "c", "d"), "a§b§c§d");
});

test("mcpAuxiliaryFingerprintFromSlice joins tool counts and onboarding fields", () => {
  const fp = mcpAuxiliaryFingerprintFromSlice({
    mcpToolCount: 3,
    mcpSessionCount: 1,
    mcpOnboarding: {
      status: "ready",
      configuredPath: "/p",
      resolvedAbsolutePath: "/abs",
      canCreateStarter: false,
      hint: "h",
      starterDestinationRelative: null
    }
  });
  assert.equal(fp, "3|1|ready|/p|/abs|h");
});

test("stableSortedJson orders keys lexicographically", () => {
  assert.equal(stableSortedJson({ b: "2", a: "1" }), '{"a":"1","b":"2"}');
});

// --- Refresh orchestration (mock host) ---

test("enqueueSidebarRefreshDashboard coalesces second background enqueue while tail flag set", async () => {
  const { traceLogger, events } = traceRecorder();
  let tailCoalesced = false;
  let queue: Promise<void> = Promise.resolve();
  let bgGen = 0;
  const host: SidebarRefreshOrchestrationHost = {
    traceLogger,
    getBackgroundRefreshTailCoalesced: () => tailCoalesced,
    setBackgroundRefreshTailCoalesced: (v) => {
      tailCoalesced = v;
    },
    getBackgroundRefreshRequestGen: () => bgGen,
    nextBackgroundRefreshRequestGen: () => {
      bgGen += 1;
      return bgGen;
    },
    getRefreshQueue: () => queue,
    setRefreshQueue: (p) => {
      queue = p;
    },
    getIncludeArchivedMissions: () => false,
    nextDashboardRefreshSeq: () => 1,
    getDashboardRefreshSeq: () => 1,
    buildSnapshot: async () => emptySnapshot(),
    materialFingerprintFromSnapshot: () => "fp",
    getLastPublishedFullMaterialFp: () => undefined,
    setLastPublishedFullMaterialFp: () => {},
    getLastFullRefreshCycleMeta: () => undefined,
    setLastFullRefreshCycleMeta: () => {},
    scheduleDashboardFlush: () => {},
    sealSnapshotForPost: (s, seq) => ({ ...s, snapshotPublishSeq: 1, sourceRefreshSeq: seq }),
    postSnapshotForFullRefresh: () => {}
  };

  const p1 = enqueueSidebarRefreshDashboard(host, undefined, { source: "unspecified_background" });
  const p2 = enqueueSidebarRefreshDashboard(host, undefined, { source: "unspecified_background" });
  assert.ok(events.includes("refresh_dashboard_background_coalesced_skip"), "second call should coalesce");
  await p1;
  await p2;
});

test("runSidebarRefreshDashboardCycle superseded before cycle skips build and seq bump side effects", async () => {
  const { traceLogger } = traceRecorder();
  let builds = 0;
  let posts = 0;
  let seqBumps = 0;
  const host: SidebarRefreshOrchestrationHost = {
    traceLogger,
    getBackgroundRefreshTailCoalesced: () => false,
    setBackgroundRefreshTailCoalesced: () => {},
    getBackgroundRefreshRequestGen: () => 2,
    nextBackgroundRefreshRequestGen: () => 1,
    getRefreshQueue: () => Promise.resolve(),
    setRefreshQueue: () => {},
    getIncludeArchivedMissions: () => false,
    nextDashboardRefreshSeq: () => {
      seqBumps += 1;
      return 1;
    },
    getDashboardRefreshSeq: () => 1,
    buildSnapshot: async () => {
      builds += 1;
      return emptySnapshot();
    },
    materialFingerprintFromSnapshot: () => "fp",
    getLastPublishedFullMaterialFp: () => undefined,
    setLastPublishedFullMaterialFp: () => {},
    getLastFullRefreshCycleMeta: () => undefined,
    setLastFullRefreshCycleMeta: () => {},
    scheduleDashboardFlush: () => {},
    sealSnapshotForPost: (s) => s,
    postSnapshotForFullRefresh: () => {
      posts += 1;
    }
  };

  await runSidebarRefreshDashboardCycle(host, undefined, 0, 1, "poll_fallback_full");
  assert.equal(builds, 0, "superseded cycle must not build");
  assert.equal(posts, 0);
  assert.equal(seqBumps, 0, "superseded cycle must not bump dashboard seq");
});

test("runSidebarRefreshDashboardCycle stale seq after build schedules flush and skips post", async () => {
  const { traceLogger } = traceRecorder();
  let posts = 0;
  let flushes = 0;
  let latestSeq = 1;
  const host: SidebarRefreshOrchestrationHost = {
    traceLogger,
    getBackgroundRefreshTailCoalesced: () => false,
    setBackgroundRefreshTailCoalesced: () => {},
    getBackgroundRefreshRequestGen: () => 0,
    nextBackgroundRefreshRequestGen: () => 1,
    getRefreshQueue: () => Promise.resolve(),
    setRefreshQueue: () => {},
    getIncludeArchivedMissions: () => false,
    nextDashboardRefreshSeq: () => 1,
    getDashboardRefreshSeq: () => latestSeq,
    buildSnapshot: async () => {
      await Promise.resolve();
      latestSeq = 2;
      return emptySnapshot();
    },
    materialFingerprintFromSnapshot: () => "fp",
    getLastPublishedFullMaterialFp: () => undefined,
    setLastPublishedFullMaterialFp: () => {},
    getLastFullRefreshCycleMeta: () => undefined,
    setLastFullRefreshCycleMeta: () => {},
    scheduleDashboardFlush: () => {
      flushes += 1;
    },
    sealSnapshotForPost: (s) => s,
    postSnapshotForFullRefresh: () => {
      posts += 1;
    }
  };

  await runSidebarRefreshDashboardCycle(host, "ix-1", 0, undefined, "manual_refresh");
  assert.equal(flushes, 1);
  assert.equal(posts, 0);
});

test("runSidebarRefreshDashboardCycle happy path posts sealed snapshot and records material fp", async () => {
  const { traceLogger } = traceRecorder();
  let posts = 0;
  let lastFp: string | undefined;
  const snap = emptySnapshot();
  const host: SidebarRefreshOrchestrationHost = {
    traceLogger,
    getBackgroundRefreshTailCoalesced: () => false,
    setBackgroundRefreshTailCoalesced: () => {},
    getBackgroundRefreshRequestGen: () => 0,
    nextBackgroundRefreshRequestGen: () => 1,
    getRefreshQueue: () => Promise.resolve(),
    setRefreshQueue: () => {},
    getIncludeArchivedMissions: () => false,
    nextDashboardRefreshSeq: () => 1,
    getDashboardRefreshSeq: () => 1,
    buildSnapshot: async () => snap,
    materialFingerprintFromSnapshot: () => "mat",
    getLastPublishedFullMaterialFp: () => undefined,
    setLastPublishedFullMaterialFp: (v) => {
      lastFp = v;
    },
    getLastFullRefreshCycleMeta: () => undefined,
    setLastFullRefreshCycleMeta: () => {},
    scheduleDashboardFlush: () => {},
    sealSnapshotForPost: (s, seq) => ({ ...s, snapshotPublishSeq: 9, sourceRefreshSeq: seq }),
    postSnapshotForFullRefresh: () => {
      posts += 1;
    }
  };

  await runSidebarRefreshDashboardCycle(host, undefined, 0, undefined, "handler_tail");
  assert.equal(posts, 1);
  assert.equal(lastFp, "mat");
});

// --- Poll warm execution (mock host): call order / sequence ---

function makePollHost(
  baseline: { missionFp: string; globalMemFp: string; providerChromeFp: string },
  live: { missionFp: string; memFp: string; providerFp: string }
): { host: SidebarPollWarmExecutionHost; calls: string[] } {
  const calls: string[] = [];
  const { traceLogger } = traceRecorder();
  const host: SidebarPollWarmExecutionHost = {
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
    postAuxiliarySectionImmediate: async () => {
      calls.push("aux");
      return { published: true, usedWarmAuxiliaryCache: true };
    },
    postGlobalMemorySectionImmediate: () => {
      calls.push("globalMemory");
    },
    postMissionDashboardSnapshotImmediate: () => {
      calls.push("missions");
    },
    postProviderSettingsChromeSectionImmediate: async (_id, _ev, extra) => {
      calls.push(`provider:${String((extra as { reason?: string } | undefined)?.reason ?? "")}`);
    },
    refreshDashboard: async () => {
      calls.push("fullRefresh");
    }
  };
  return { host, calls };
}

test("runSidebarPollWarmExecution all axes match → auxiliary only", async () => {
  const baseline = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const live = { missionFp: "m", memFp: "g", providerFp: "p" };
  const { host, calls } = makePollHost(baseline, live);
  await runSidebarPollWarmExecution(host, "interval", baseline);
  assert.deepEqual(calls, ["aux"]);
});

test("runSidebarPollWarmExecution mission-only drift → missions section only", async () => {
  const b = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const { host, calls } = makePollHost(b, { missionFp: "M", memFp: "g", providerFp: "p" });
  await runSidebarPollWarmExecution(host, "visibility", b);
  assert.deepEqual(calls, ["missions"]);
});

test("runSidebarPollWarmExecution triple-axis drift → provider then missions then globalMemory", async () => {
  const b = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const { host, calls } = makePollHost(b, { missionFp: "M", memFp: "G", providerFp: "P" });
  await runSidebarPollWarmExecution(host, "reveal", b);
  assert.deepEqual(calls, [
    "provider:poll_multiaxis_all_three_provider_first",
    "missions",
    "globalMemory"
  ]);
});

test("runSidebarPollWarmExecution mission+memory drift → missions then globalMemory", async () => {
  const b = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const { host, calls } = makePollHost(b, { missionFp: "M", memFp: "G", providerFp: "p" });
  await runSidebarPollWarmExecution(host, "interval", b);
  assert.deepEqual(calls, ["missions", "globalMemory"]);
});

test("runSidebarPollWarmExecution memory+provider drift → globalMemory then provider", async () => {
  const b = { missionFp: "m", globalMemFp: "g", providerChromeFp: "p" };
  const { host, calls } = makePollHost(b, { missionFp: "m", memFp: "G", providerFp: "P" });
  await runSidebarPollWarmExecution(host, "interval", b);
  assert.deepEqual(calls, ["globalMemory", "provider:poll_multiaxis_memory_then_provider"]);
});
