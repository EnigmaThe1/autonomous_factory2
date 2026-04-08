import { queueProgressSignatureTuple } from "./missionQueueProgressSummary.js";
import { currentNextSignatureTuple } from "./missionQueueCurrentNext.js";
import { formatMissionStatusBadgeLabel } from "./missionStatusPresentation.js";
import {
  composeMissionsForMissionList,
  focusedMissionHiddenFromComposedList,
  normalizeMissionQuickFilter
} from "./missionQuickFilters.js";

/** Compact fingerprint for `missionProgressStats` so list/inspector re-render when dashboard numbers change. */
export function progressStatsFingerprint(missionId, map) {
  const s = map && missionId ? map[missionId] : null;
  if (!s || typeof s.total !== "number") return "";
  return `${s.completionPercent}|${s.done}|${s.skipped}|${s.total}|${s.running}|${s.todo}|${s.blocked}|${s.failed}|${s.roundsCompleted}|${s.maxAutoRounds}|${Math.round((s.estimatedRemainingMs || 0) / 1000)}|${s.dryRun ? 1 : 0}`;
}

function focusedMissionOperatorActionHeadlinesSigFragment(headlines) {
  if (!headlines || typeof headlines !== "object") return "";
  return Object.keys(headlines)
    .sort()
    .map((k) => `${k}\t${headlines[k]}`)
    .join("\n");
}

/** Fingerprint for webview-cached mission markdown report (inspector must re-render when cache changes). */
export function missionReportInspectorCacheSig(focusedMissionId, cache) {
  if (!cache || !focusedMissionId || cache.missionId !== focusedMissionId) return "";
  const len = typeof cache.markdown === "string" ? cache.markdown.length : 0;
  return `${cache.missionId}:${len}`;
}

export function providersPanelSig(snapshot) {
  return JSON.stringify({
    c: snapshot.providerCredentialStatus,
    u: snapshot.providerBaseUrls,
    m: snapshot.providerSavedModels,
    p: snapshot.providers,
    d: snapshot.defaultProvider,
    l: snapshot.lastProviderTest,
    h: snapshot.providerHealth,
    /** Must change when live/fallback catalogs refresh or the panel skips re-render. */
    live: snapshot.providerLiveModelCatalog
  });
}

export function settingsPanelSig(snapshot) {
  return JSON.stringify({
    s: snapshot.settings,
    r: snapshot.resolvedDefaultModel,
    ps: snapshot.providerSavedModels,
    p: snapshot.providers,
    live: snapshot.providerLiveModelCatalog
  });
}

/** @param {unknown[]} memorySearchResults */
export function memoryPanelSig(snapshot, memorySearchResults) {
  return JSON.stringify({
    g: snapshot.globalMemoryRecent,
    mid: snapshot.focusedMissionId,
    mm: (snapshot.focusedMission?.memory || []).slice(-10),
    sr: memorySearchResults
  });
}

export function toolsPanelSig(snapshot) {
  return JSON.stringify({
    mo: snapshot.mcpOnboarding,
    mt: snapshot.tools.mcpToolCount,
    ms: snapshot.tools.mcpSessionCount,
    r: snapshot.tools.recentToolEvents,
    bi: snapshot.tools.builtinTools
  });
}

export function chatPanelSig(snapshot, chatBuffer, chatHistory, agentStream) {
  const focused = snapshot?.focusedMission;
  const recentToolResults = (focused?.memory || []).filter((item) => item.kind === "tool_result").slice(-4).reverse();
  const historyLen = chatHistory?.entries?.length ?? 0;
  const streamLen = agentStream?.text?.length ?? 0;
  const pst = progressStatsFingerprint(snapshot?.focusedMissionId, snapshot?.missionProgressStats);
  const ftitle = focused?.title ?? "";
  const fstat = focused?.status ?? "";
  const s = snapshot?.settings;
  const bpp = s
    ? `${s.missionBlueprintMode ? 1 : 0}|${s.missionPreBlueprintClarification ? 1 : 0}|${s.missionRequireBlueprintApproval ? 1 : 0}`
    : "";
  return JSON.stringify({
    buf: chatBuffer,
    mid: snapshot?.focusedMissionId,
    hl: historyLen,
    sl: streamLen,
    pst,
    ft: ftitle,
    fs: fstat,
    bpp,
    cards: recentToolResults.map((i) => ({ id: i.id, ts: i.ts, t: i.text }))
  });
}

export function routingPanelSig(snapshot) {
  const m = snapshot?.focusedMission;
  return JSON.stringify({
    providers: snapshot?.providers,
    defP: snapshot?.defaultProvider,
    mid: m?.id,
    r: m?.routing,
    ap: m?.activeProviderId,
    am: m?.activeModel,
    tmplKeys: snapshot?.routingPresetTemplates ? Object.keys(snapshot.routingPresetTemplates).sort() : [],
    live: snapshot?.providerLiveModelCatalog
  });
}

export function approvalsQueueSig(snapshot, selectedApproval, selectedHunkIndex) {
  return JSON.stringify({
    pa: snapshot.pendingApprovals,
    sel: selectedApproval,
    hunk: selectedHunkIndex
  });
}

export function bundlesPanelSig(snapshot, selectedBundle) {
  return JSON.stringify({
    ab: snapshot.approvalBundles,
    sel: selectedBundle
  });
}

/**
 * @param {object} snapshot
 * @param {string} [missionQuickFilter] Quick filter id (webview-only); affects row order/count.
 * @param {object[]|null} [orderedMissions] Precomposed list (filter+sort); must match `composeMissionsForMissionList` for same snapshot/filter.
 */
export function missionsListPanelSig(snapshot, missionQuickFilter = "all", orderedMissions = null) {
  const ml = snapshot.missionList || {};
  const focused = snapshot.focusedMissionId;
  const qf = normalizeMissionQuickFilter(missionQuickFilter);
  const ordered = orderedMissions ?? composeMissionsForMissionList(snapshot.missions || [], qf);
  const rows = ordered.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    bst: formatMissionStatusBadgeLabel(m),
    preset: m.routing?.preset || "default",
    pol: m.policy?.policyPreset || "custom",
    step: m.currentStep,
    arch: m.archivedAt || null,
    ql: m.queue.length,
    pend: m.approvals.filter((a) => a.status === "pending").length,
    cpl: m.checkpoints.length,
    ua: m.updatedAt,
    cr: m.completionReason || null,
    blk: m.blocker || null,
    qp: queueProgressSignatureTuple(m.queue),
    cn: currentNextSignatureTuple(m.queue),
    dgh: snapshot.missionDownstreamGatingCardHints?.[m.id] ?? "",
    loah: snapshot.missionListLatestOperatorActionHeadlines?.[m.id] ?? "",
    pst: progressStatsFingerprint(m.id, snapshot.missionProgressStats)
  }));
  return JSON.stringify({
    inc: !!ml.includeArchived,
    tc: ml.totalCount,
    ac: ml.archivedCount,
    foc: focused || null,
    qf,
    rwh: snapshot.focusedMissionRequiredWorkHint ?? "",
    dqh: snapshot.focusedMissionHardStopDataQualityHint ?? "",
    dgh: snapshot.focusedMissionDownstreamGatingHint ?? "",
    loa: snapshot.focusedMissionLatestOperatorActionNote ?? "",
    fls: snapshot.focusedMissionLifecycleSummary ?? "",
    rows
  });
}

/**
 * @param {object} snapshot
 * @param {string} [missionQuickFilter]
 * @param {object[]|null} [displayMissions] Same composed list as mission cards; omit to recompose from snapshot.
 */
export function missionInspectorSig(snapshot, missionQuickFilter = "all", displayMissions = null, reportCacheSig = "") {
  const m = snapshot.focusedMission;
  const foc = snapshot.focusedMissionId || null;
  const qf = normalizeMissionQuickFilter(missionQuickFilter);
  const ordered = displayMissions ?? composeMissionsForMissionList(snapshot.missions || [], qf);
  const fhl = focusedMissionHiddenFromComposedList(m, ordered);
  const frs = snapshot.focusedMissionReportSummary;
  const frsKey = frs
    ? `${frs.completionPercent}|${frs.filesModifiedCount}|${frs.errorPatternCount}|${frs.retriedItems}|${frs.deadLetterItems ?? 0}`
    : "";
  if (!m) {
    return JSON.stringify({
      empty: true,
      foc,
      qf,
      fhl: false,
      pst: progressStatsFingerprint(foc || "", snapshot.missionProgressStats),
      rwh: snapshot.focusedMissionRequiredWorkHint ?? "",
      dqh: snapshot.focusedMissionHardStopDataQualityHint ?? "",
      dgh: snapshot.focusedMissionDownstreamGatingHint ?? "",
      loa: snapshot.focusedMissionLatestOperatorActionNote ?? "",
      fls: snapshot.focusedMissionLifecycleSummary ?? "",
      oah: focusedMissionOperatorActionHeadlinesSigFragment(snapshot.focusedMissionOperatorActionHeadlines),
      frs: frsKey,
      rmc: reportCacheSig,
      bpx: ""
    });
  }
  const q = (m.queue || []).map((w) => ({
    id: w.id,
    s: w.status,
    title: w.title,
    role: w.role,
    dep: (w.dependsOn || []).length,
    out: w.output != null ? String(w.output).slice(0, 280) : "",
    ck: w.completionKind || null,
    hsc: w.hardStopClass || null
  }));
  const cps = (m.checkpoints || []).slice(-4).map((cp) => [cp.step, cp.ts, cp.summary]);
  const evs = (m.events || []).slice(-8).map((ev) => [ev.id, ev.ts, ev.level, ev.source, ev.message]);
  const rt = m.runtime || {};
  const pst = progressStatsFingerprint(m.id, snapshot.missionProgressStats);
  const fbp = snapshot.focusedMissionBlueprintProgress;
  const bpx = m.blueprint
    ? `${m.blueprint.status}|${fbp ? `${fbp.done}/${fbp.total}` : ""}|${(m.blueprint.steps || []).map((s) => `${s.id}:${s.status}`).join(",")}`
    : "";
  return JSON.stringify({
    foc: m.id,
    qf,
    fhl,
    pst,
    rwh: snapshot.focusedMissionRequiredWorkHint ?? "",
    dqh: snapshot.focusedMissionHardStopDataQualityHint ?? "",
    dgh: snapshot.focusedMissionDownstreamGatingHint ?? "",
    loa: snapshot.focusedMissionLatestOperatorActionNote ?? "",
    fls: snapshot.focusedMissionLifecycleSummary ?? "",
    oah: focusedMissionOperatorActionHeadlinesSigFragment(snapshot.focusedMissionOperatorActionHeadlines),
    frs: frsKey,
    rmc: reportCacheSig,
    ua: m.updatedAt,
    title: m.title,
    status: m.status,
    bst: formatMissionStatusBadgeLabel(m),
    cn: currentNextSignatureTuple(m.queue),
    cr: m.completionReason || null,
    blk: m.blocker || null,
    prov: m.activeProviderId,
    mod: m.activeModel || null,
    val: m.validationState,
    pend: m.approvals.filter((a) => a.status === "pending").length,
    memlen: m.memory.length,
    q,
    cps,
    evs,
    rt: {
      lp: rt.lastProgressAt,
      hb: rt.lastRunnerHeartbeatAt,
      sh: rt.stalledHeartbeats,
      ar: rt.autoReplans,
      lg: rt.loopGuardTrips
    },
    bpx
  });
}
