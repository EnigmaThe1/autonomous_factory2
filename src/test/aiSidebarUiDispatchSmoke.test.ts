/**
 * Post–Wave 3: dispatch smoke without loading vscode-dependent modules.
 * - Executable: memory/trace + approvals handlers (no vscode import in those files).
 * - Static: protocol allowlist ↔ router cases, router case→function wiring, modal cancel return false.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AiSidebarUiDispatchHost } from "../ui/aiSidebarUiDispatchHost";
import { dispatchUi_approve } from "../ui/aiSidebarDispatchApprovalsReview";
import {
  dispatchUi_requestTraceLog,
  dispatchUi_searchGlobalMemory
} from "../ui/aiSidebarDispatchMemoryTrace";
import { dispatchUi_generateMissionReport } from "../ui/aiSidebarDispatchMissions";

const repoRoot = join(__dirname, "..", "..");

function routerSrc(): string {
  return readFileSync(join(repoRoot, "src/ui/aiSidebarUiMessageDispatch.ts"), "utf8");
}

test("UI_TO_EXT_KNOWN_TYPES matches aiSidebarUiMessageDispatch switch cases", () => {
  const knownSrc = readFileSync(join(repoRoot, "src/diagnostics/uiToExtKnownTypes.ts"), "utf8");
  const known = [...knownSrc.matchAll(/"([a-zA-Z0-9_]+)"/g)]
    .map((m) => m[1])
    .filter((t, i, a) => a.indexOf(t) === i)
    .filter((t) => t !== "traceEvent");
  const swSrc = routerSrc();
  const cases = [...swSrc.matchAll(/case "([^"]+)"/g)].map((m) => m[1]);
  const setK = new Set(known);
  const setC = new Set(cases);
  const onlyK = [...setK].filter((x) => !setC.has(x));
  const onlyC = [...setC].filter((x) => !setK.has(x));
  assert.deepEqual(onlyK, [], `known types missing from router: ${onlyK.join(", ")}`);
  assert.deepEqual(onlyC, [], `router cases not in known set: ${onlyC.join(", ")}`);
});

test("router wires representative families to expected dispatch imports", () => {
  const r = routerSrc();
  const pairs: Array<[string, RegExp]> = [
    ["ready", /case "ready":\s*\n\s*return await dispatchUi_ready/],
    ["sendChat", /case "sendChat":\s*\n\s*return await dispatchUi_sendChat/],
    ["archiveMission", /case "archiveMission":\s*\n\s*return await dispatchUi_archiveMission/],
    ["saveQuickSettings", /case "saveQuickSettings":\s*\n\s*return await dispatchUi_saveQuickSettings/],
    ["listMcpTools", /case "listMcpTools":\s*\n\s*return await dispatchUi_listMcpTools/],
    ["openMcpConfig", /case "openMcpConfig":\s*\n\s*return await dispatchUi_openMcpConfig/],
    ["openAgentCapabilitiesDoc", /case "openAgentCapabilitiesDoc":\s*\n\s*return await dispatchUi_openAgentCapabilitiesDoc/],
    ["openMissionAutonomyBlueprint", /case "openMissionAutonomyBlueprint":\s*\n\s*return await dispatchUi_openMissionAutonomyBlueprint/],
    ["approveMissionBlueprint", /case "approveMissionBlueprint":\s*\n\s*return await dispatchUi_approveMissionBlueprint/],
    ["applyLazyDiscoveryPreset", /case "applyLazyDiscoveryPreset":\s*\n\s*return await dispatchUi_applyLazyDiscoveryPreset/],
    ["revertLazyDiscoveryPreset", /case "revertLazyDiscoveryPreset":\s*\n\s*return await dispatchUi_revertLazyDiscoveryPreset/],
    ["searchGlobalMemory", /case "searchGlobalMemory":\s*\n\s*return await dispatchUi_searchGlobalMemory/],
    ["generateMissionReport", /case "generateMissionReport":\s*\n\s*return await dispatchUi_generateMissionReport/],
    ["requestTraceLog", /case "requestTraceLog":\s*\n\s*return await dispatchUi_requestTraceLog/],
    ["refreshDashboard", /case "refreshDashboard":\s*\n\s*return await dispatchUi_refreshDashboard/]
  ];
  for (const [label, re] of pairs) {
    assert.match(r, re, `router wiring for ${label}`);
  }
});

test("cancel / no-op: archive and delete modals return false when user dismisses (source static)", () => {
  const src = readFileSync(join(repoRoot, "src/ui/aiSidebarDispatchMissions.ts"), "utf8");
  assert.match(src, /pick !== "Archive"\)[\s\S]*?return false/);
  assert.match(src, /pick !== "Delete"\)[\s\S]*?return false/);
});

test("dispatchUi_searchGlobalMemory: posts memorySearchResults, returns suppress true", async () => {
  const posted: unknown[] = [];
  const host = {
    globalMemory: {
      search: () => [{ id: "1", ts: 1, kind: "note", text: "t" }]
    },
    postMessage: (m: unknown) => posted.push(m)
  } as unknown as AiSidebarUiDispatchHost;

  const suppress = await dispatchUi_searchGlobalMemory(host, { type: "searchGlobalMemory", query: "q" });
  assert.equal(suppress, true);
  const m = posted[0] as { type: string; query: string; results: unknown[] };
  assert.equal(m.type, "memorySearchResults");
  assert.equal(m.query, "q");
  assert.equal(m.results.length, 1);
});

test("dispatchUi_requestTraceLog: posts traceLogSnapshot, returns suppress true", async () => {
  const posted: unknown[] = [];
  const host = {
    traceLogger: {
      getBufferSnapshot: () => [{ id: "e1" } as never],
      getConfiguredLevel: () => "info" as const
    },
    postMessage: (m: unknown) => posted.push(m)
  } as unknown as AiSidebarUiDispatchHost;

  const suppress = await dispatchUi_requestTraceLog(host);
  assert.equal(suppress, true);
  const m = posted[0] as {
    type: string;
    entries: unknown[];
    traceLevel: string;
    totalBuffered: number;
    traceUiTruncated?: boolean;
  };
  assert.equal(m.type, "traceLogSnapshot");
  assert.equal(m.entries.length, 1);
  assert.equal(m.totalBuffered, 1);
  assert.equal(m.traceUiTruncated, false);
});

test("dispatchUi_requestTraceLog: tail-limits entries when buffer exceeds TRACE_UI_TAIL_MAX", async () => {
  const posted: unknown[] = [];
  const big = Array.from({ length: 900 }, (_, i) => ({ seq: i + 1 } as never));
  const host = {
    traceLogger: {
      getBufferSnapshot: () => big,
      getConfiguredLevel: () => "info" as const
    },
    postMessage: (m: unknown) => posted.push(m)
  } as unknown as AiSidebarUiDispatchHost;

  await dispatchUi_requestTraceLog(host);
  const m = posted[0] as {
    entries: unknown[];
    totalBuffered: number;
    traceUiTruncated?: boolean;
    traceUiTailMax?: number;
  };
  assert.equal(m.totalBuffered, 900);
  assert.equal(m.entries.length, 800);
  assert.equal(m.traceUiTruncated, true);
  assert.equal(m.traceUiTailMax, 800);
});

test("dispatchUi_generateMissionReport: posts missionReportReady for valid mission", async () => {
  const posted: unknown[] = [];
  const host = {
    missionStore: {
      get: (id: string) =>
        id === "m1"
          ? {
              id: "m1",
              title: "Test Mission",
              status: "done",
              prompt: "Fix bugs",
              queue: [
                { id: "w1", title: "Fix A", role: "implementer", status: "done", output: "done" }
              ],
              events: [],
              memory: [],
              policy: { maxAutoRounds: 5 },
              createdAt: 1000,
              updatedAt: 2000,
              filesModified: ["src/a.ts"],
              roundsCompleted: 1
            }
          : undefined
    },
    postMessage: (m: unknown) => posted.push(m)
  } as unknown as AiSidebarUiDispatchHost;

  const suppress = await dispatchUi_generateMissionReport(host, {
    type: "generateMissionReport",
    missionId: "m1"
  });
  assert.equal(suppress, true);
  const m = posted[0] as { type: string; missionId: string; markdown: string };
  assert.equal(m.type, "missionReportReady");
  assert.equal(m.missionId, "m1");
  assert.ok(m.markdown.includes("Test Mission"));
});

test("dispatchUi_generateMissionReport: posts error for missing mission", async () => {
  const posted: unknown[] = [];
  const host = {
    missionStore: { get: () => undefined },
    postMessage: (m: unknown) => posted.push(m)
  } as unknown as AiSidebarUiDispatchHost;

  const suppress = await dispatchUi_generateMissionReport(host, {
    type: "generateMissionReport",
    missionId: "nonexistent"
  });
  assert.equal(suppress, true);
  const m = posted[0] as { type: string; message: string };
  assert.equal(m.type, "error");
  assert.ok(m.message.includes("not found"));
});

test("dispatchUi_approve: resolveApproval + mission section + reconcile, returns true", async () => {
  const calls: string[] = [];
  const host = {
    orchestrator: {
      resolveApproval: async (mid: string, aid: string, ok: boolean) => {
        calls.push(`resolve:${mid}:${aid}:${ok}`);
      }
    },
    postMessage: (m: unknown) => calls.push(`post:${(m as any)?.type ?? "unknown"}`),
    postMissionDashboardSnapshotImmediate: (ix?: string) => {
      calls.push(`mission:${ix ?? "undef"}`);
    },
    scheduleBackgroundDashboardReconciliation: () => calls.push("reconcile")
  } as unknown as AiSidebarUiDispatchHost;

  const suppress = await dispatchUi_approve(host, {
    type: "approve",
    missionId: "m1",
    approvalId: "a1",
    interactionId: "ix1"
  });
  assert.equal(suppress, true);
  assert.ok(calls.includes("resolve:m1:a1:true"));
  assert.ok(calls.some((c) => c.startsWith("post:")), "posts operator-facing info message");
  assert.ok(calls.includes("mission:ix1"));
  assert.ok(calls.includes("reconcile"));
});
