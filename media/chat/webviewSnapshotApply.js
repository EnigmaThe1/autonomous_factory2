import { memoryPanelSig } from "./webviewSignatures.js";
import { formatMissionMemoryTextHtml } from "./missionMemoryLabels.js";
import { formatDashboardMissionSummaryText } from "./missionProgressDashboard.js";

export function createSnapshotApply(deps) {
  const {
    state,
    els,
    sigCache,
    emitHostTrace,
    trace,
    escapeHtml,
    setActiveTab,
    renderMissions,
    syncChatProviderRow,
    renderRouting,
    renderApprovals,
    renderBundles,
    renderTimeline,
    renderAgents,
    renderTools,
    renderMemory,
    renderConsole,
    renderChat,
    renderProvidersPanel,
    renderSettings
  } = deps;

/**
 * Apply authoritative mission-cluster fields only (no providers/settings/MCP full rebuild).
 * Caller must verify staleness (`sectionBasePublishSeq`, `sectionSeq`).
 */
function applyMissionSectionSnapshot(snapshot, traceContext) {
  const interactionId = traceContext && traceContext.interactionId;
  const pub = snapshot?.snapshotPublishSeq;
  emitHostTrace({
    level: 'info',
    category: 'ui',
    event: 'render_snapshot_section_apply',
    interactionId,
    data: {
      section: 'missions',
      sectionSeq: traceContext?.sectionSeq,
      sectionBasePublishSeq: traceContext?.sectionBasePublishSeq,
      snapshotPublishSeq: pub,
      activeTab: state.activeTab
    }
  });
  trace('render_snapshot_section_start', {
    missionCount: snapshot?.missions?.length || 0,
    sectionSeq: traceContext?.sectionSeq
  }, 'debug');
  state.snapshot = snapshot;
  els.summaryMissions.textContent = formatDashboardMissionSummaryText(snapshot);
  els.summaryApprovals.textContent = String(snapshot.pendingApprovals.length);
  renderMissions(snapshot, interactionId);
  const activeTab = state.activeTab;
  try {
    syncChatProviderRow(snapshot);
    renderRouting(snapshot);
    renderApprovals(snapshot);
    renderBundles(snapshot);
    renderTimeline(snapshot);
    renderAgents(snapshot);
    renderTools(snapshot);
    renderMemory(snapshot);
    renderConsole(snapshot);
    if (activeTab === 'chat') renderChat(snapshot);
  } catch (err) {
    console.error('[my-ai] applyMissionSectionSnapshot: secondary render failed', err);
    emitHostTrace({
      level: 'error',
      category: 'ui',
      event: 'render_error',
      interactionId,
      data: { phase: 'mission_section', message: err instanceof Error ? err.message : String(err) }
    });
  }
  trace('render_snapshot_section_done', { missionCount: snapshot?.missions?.length || 0 }, 'debug');
}

/** MCP/onboarding + tools counts only; caller verifies section staleness. */
function applyAuxiliarySectionSnapshot(snapshot, traceContext) {
  const interactionId = traceContext && traceContext.interactionId;
  emitHostTrace({
    level: 'info',
    category: 'ui',
    event: 'render_snapshot_section_apply',
    interactionId,
    data: {
      section: 'auxiliary',
      sectionSeq: traceContext?.sectionSeq,
      sectionBasePublishSeq: traceContext?.sectionBasePublishSeq,
      snapshotPublishSeq: snapshot?.snapshotPublishSeq,
      activeTab: state.activeTab
    }
  });
  state.snapshot = snapshot;
  try {
    renderTools(snapshot);
  } catch (err) {
    console.error('[my-ai] applyAuxiliarySectionSnapshot: renderTools failed', err);
    emitHostTrace({
      level: 'error',
      category: 'ui',
      event: 'render_error',
      interactionId,
      data: { phase: 'auxiliary_section', message: err instanceof Error ? err.message : String(err) }
    });
  }
}

/**
 * Provider/settings/credential chrome only; does not rebuild missions, chat body, routing, etc.
 * Caller verifies `sectionBasePublishSeq` and `sectionSeq`.
 */
function applyProviderChromeSectionSnapshot(snapshot, traceContext) {
  const interactionId = traceContext && traceContext.interactionId;
  emitHostTrace({
    level: 'info',
    category: 'ui',
    event: 'render_snapshot_section_apply',
    interactionId,
    data: {
      section: 'providerChrome',
      sectionSeq: traceContext?.sectionSeq,
      sectionBasePublishSeq: traceContext?.sectionBasePublishSeq,
      snapshotPublishSeq: snapshot?.snapshotPublishSeq,
      activeTab: state.activeTab
    }
  });
  state.snapshot = snapshot;
  els.summaryProvider.textContent = snapshot.defaultProvider;
  els.summaryModel.textContent = snapshot.resolvedDefaultModel || snapshot.defaultModel;
  try {
    syncChatProviderRow(snapshot);
    renderProvidersPanel(snapshot);
    renderSettings(snapshot);
  } catch (err) {
    console.error('[my-ai] applyProviderChromeSectionSnapshot: render failed', err);
    emitHostTrace({
      level: 'error',
      category: 'ui',
      event: 'render_error',
      interactionId,
      data: { phase: 'provider_chrome_section', message: err instanceof Error ? err.message : String(err) }
    });
  }
}

/** Global memory head list only; does not repaint mission memory, missions, or chat. */
function applyGlobalMemorySectionSnapshot(snapshot, traceContext) {
  const interactionId = traceContext && traceContext.interactionId;
  emitHostTrace({
    level: 'info',
    category: 'ui',
    event: 'render_snapshot_section_apply',
    interactionId,
    data: {
      section: 'globalMemory',
      sectionSeq: traceContext?.sectionSeq,
      sectionBasePublishSeq: traceContext?.sectionBasePublishSeq,
      snapshotPublishSeq: snapshot?.snapshotPublishSeq,
      activeTab: state.activeTab
    }
  });
  state.snapshot = snapshot;
  els.globalMemory.innerHTML = snapshot.globalMemoryRecent.map(m => `<div class="memory-item"><span class="meta">${new Date(m.ts).toLocaleString()} • ${escapeHtml(m.kind)}</span>${formatMissionMemoryTextHtml(m.text, escapeHtml)}</div>`).join('') || '<div class="empty">No global memory yet.</div>';
  sigCache.lastMemorySig = memoryPanelSig(snapshot, state.memorySearchResults);
}

function renderSnapshot(snapshot, traceContext) {
  const interactionId = traceContext && traceContext.interactionId;
  const incomingSid = snapshot?.traceSessionId;
  /**
   * After extension reload the host starts `snapshotPublishSeq` at 1 again, but the webview can
   * keep `retainContextWhenHidden` state with a large `lastSnapshotPublishSeq` — then every
   * snapshot is mis-classified as stale and the Missions list never updates (trace shows
   * `render_snapshot_ignored_stale` with small incomingPublishSeq vs large lastApplied).
   */
  if (incomingSid && state.traceSessionId != null && incomingSid !== state.traceSessionId) {
    state.lastSnapshotPublishSeq = null;
    state.lastIncludeArchivedApplied = null;
    state.lastMissionCountApplied = null;
    sigCache.lastMissionsHtmlSig = null;
    sigCache.lastMissionsListSig = null;
    sigCache.lastMissionInspectorSig = null;
    sigCache.lastChatSig = null;
    sigCache.lastRoutingSig = null;
    sigCache.lastApprovalsQueueSig = null;
    sigCache.lastBundlesSig = null;
    state.lastAppliedMissionsSectionSeq = 0;
    state.lastAppliedAuxiliarySectionSeq = 0;
    state.lastAppliedProviderChromeSectionSeq = 0;
    state.lastAppliedGlobalMemorySectionSeq = 0;
    emitHostTrace({
      level: 'info',
      category: 'ui',
      event: 'trace_session_changed_reset_stale_guard',
      data: { previousTraceSessionId: state.traceSessionId, nextTraceSessionId: incomingSid }
    });
  }

  const pub = snapshot?.snapshotPublishSeq;
  const srcRef = traceContext?.sourceRefreshSeq ?? snapshot?.sourceRefreshSeq;
  const prevPub = state.lastSnapshotPublishSeq;
  const nextInc = !!snapshot?.missionList?.includeArchived;
  const nextMc = snapshot?.missions?.length ?? 0;
  const prevInc = state.lastIncludeArchivedApplied;
  const prevMc = state.lastMissionCountApplied;
  const missionsPaneActive = !!document.querySelector('.pane[data-pane="missions"]')?.classList?.contains('active');

  if (typeof pub === 'number' && typeof prevPub === 'number' && pub < prevPub) {
    emitHostTrace({
      level: 'info',
      category: 'ui',
      event: 'render_snapshot_ignored_stale',
      interactionId,
      data: {
        incomingPublishSeq: pub,
        lastAppliedPublishSeq: prevPub,
        incomingMissions: nextMc,
        incomingIncludeArchived: nextInc,
        missionsPaneActive,
        sourceRefreshSeq: srcRef
      }
    });
    return;
  }

  emitHostTrace({
    level: 'info',
    category: 'ui',
    event: 'render_snapshot_apply',
    interactionId,
    data: {
      snapshotPublishSeq: pub,
      sourceRefreshSeq: srcRef,
      prevIncludeArchived: prevInc,
      nextIncludeArchived: nextInc,
      prevMissionCount: prevMc,
      nextMissionCount: nextMc,
      missionsPaneActive,
      activeTab: state.activeTab
    }
  });

  if (typeof pub === 'number') {
    state.lastSnapshotPublishSeq = pub;
  }
  state.lastAppliedMissionsSectionSeq = 0;
  state.lastAppliedAuxiliarySectionSeq = 0;
  state.lastAppliedProviderChromeSectionSeq = 0;
  state.lastAppliedGlobalMemorySectionSeq = 0;
  state.lastIncludeArchivedApplied = nextInc;
  state.lastMissionCountApplied = nextMc;

  if (snapshot && snapshot.traceSessionId) {
    state.traceSessionId = snapshot.traceSessionId;
  }
  trace('render_snapshot_start', {
    missionCount: snapshot?.missions?.length || 0,
    includeArchived: !!snapshot?.missionList?.includeArchived,
    snapshotPublishSeq: pub,
    sourceRefreshSeq: srcRef
  }, 'debug');
  state.snapshot = snapshot;
  els.summaryProvider.textContent = snapshot.defaultProvider;
  els.summaryModel.textContent = snapshot.resolvedDefaultModel || snapshot.defaultModel;
  els.summaryMissions.textContent = formatDashboardMissionSummaryText(snapshot);
  els.summaryApprovals.textContent = String(snapshot.pendingApprovals.length);
  /**
   * Mission list + inspector must run before Chat/Providers and other panels.
   * If renderChat (mdToHtml) or another renderer throws, we still paint the Missions dashboard
   * from the latest snapshot — otherwise the list stays stale until webview re-init.
   */
  renderMissions(snapshot, interactionId);
  const missionFast = snapshot?.fastRefreshKind === 'mission';
  const activeTab = state.activeTab;
  const skipped = [];
  try {
    syncChatProviderRow(snapshot);
    if (!missionFast || activeTab === 'providers') renderProvidersPanel(snapshot);
    else skipped.push('providers');
    if (!missionFast || activeTab === 'chat') renderChat(snapshot);
    else skipped.push('chat');
    renderRouting(snapshot);
    renderApprovals(snapshot);
    renderBundles(snapshot);
    renderTimeline(snapshot);
    renderAgents(snapshot);
    renderTools(snapshot);
    renderMemory(snapshot);
    renderConsole(snapshot);
    if (!missionFast || activeTab === 'settings') renderSettings(snapshot);
    else skipped.push('settings');
    if (missionFast && skipped.length) {
      emitHostTrace({
        level: 'debug',
        category: 'ui',
        event: 'render_snapshot_skipped_inactive_panels',
        interactionId,
        data: { activeTab, skipped }
      });
    }
  } catch (err) {
    console.error('[my-ai] renderSnapshot: secondary panel render failed', err);
    emitHostTrace({
      level: 'error',
      category: 'ui',
      event: 'render_error',
      interactionId,
      data: { phase: 'secondary_panels', message: err instanceof Error ? err.message : String(err) }
    });
  }
  if (!document.querySelector('.tab.active')) setActiveTab(snapshot.settings.defaultTab || 'chat');
  trace('render_snapshot_done', { missionCount: snapshot?.missions?.length || 0 }, 'debug');
}
  return {
    applyMissionSectionSnapshot,
    applyAuxiliarySectionSnapshot,
    applyProviderChromeSectionSnapshot,
    applyGlobalMemorySectionSnapshot,
    renderSnapshot
  };
}
