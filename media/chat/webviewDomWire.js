import { newInteractionId } from "./webviewFormat.js";
import { normalizeMissionQuickFilter } from "./missionQuickFilters.js";
import { closeModelPicker, toggleModelPicker } from "./webviewModelPicker.js";

export function wireChatDomEvents(deps) {
  const {
    vscode,
    state,
    els,
    post,
    postWithInteractionId,
    setActiveTab,
    emitHostTrace,
    renderApprovals,
    renderBundles,
    renderTimeline,
    renderMemory,
    renderProvidersPanel,
    renderSettings,
    syncChatProviderRow,
    renderRouting,
    renderMissions,
    updateQuickDirtyBadge,
    updateProvidersDirtyBadge,
    stopTraceAutoRefresh,
    startTraceAutoRefresh,
    renderChat
  } = deps;

  els.tabs?.addEventListener('click', e => {
  const btn = e.target.closest('.tab'); if (!btn) return; setActiveTab(btn.dataset.tab);
});

/** Show archived: use `change` so clicks on the label text (not the input) still sync to the extension. */
document.body.addEventListener('change', e => {
  const t = e.target;
  if (t && t.matches && t.matches('input[data-action="toggleIncludeArchived"]')) {
    const checked = !!t.checked;
    const interactionId = newInteractionId();
    emitHostTrace({
      level: 'info',
      event: 'checkbox_change',
      interactionId,
      data: { includeArchived: checked, control: 'toggleIncludeArchived' }
    });
    post('setMissionListIncludeArchived', { includeArchived: checked, interactionId }, interactionId);
  }
});

document.body.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const missionId = btn.dataset.missionId;
  const approvalId = btn.dataset.approvalId;
  const bundleId = btn.dataset.bundleId;
  if (action === 'selectApproval') { state.selectedApproval = { missionId, approvalId }; state.selectedHunkIndex = 0; if (state.snapshot) renderApprovals(state.snapshot); return; }
  if (action === 'selectBundle') { state.selectedBundle = { id: bundleId }; if (state.snapshot) renderBundles(state.snapshot); return; }
  if (action === 'selectHunk') { state.selectedHunkIndex = Number(btn.dataset.hunkIndex || 0); if (state.snapshot) renderApprovals(state.snapshot); return; }
  if (action === "setMissionQuickFilter") {
    state.missionQuickFilter = normalizeMissionQuickFilter(btn.dataset.missionQuickFilter);
    if (state.snapshot) renderMissions(state.snapshot, newInteractionId(), { force: true });
    return;
  }
  if (action === 'focusMission') {
    if (missionId && state.missionReportCache && state.missionReportCache.missionId !== missionId) {
      state.missionReportCache = null;
    }
    return postWithInteractionId('focusMission', { missionId });
  }
  if (action === 'resumeMission') return post('resumeMission', { missionId });
  if (action === 'abortMissionLlm') return post('abortMissionLlm', { missionId });
  if (action === 'archiveMission') return postWithInteractionId('archiveMission', { missionId });
  if (action === 'unarchiveMission') return postWithInteractionId('unarchiveMission', { missionId });
  if (action === 'deleteMission') return postWithInteractionId('deleteMission', { missionId });
  if (action === "bulkArchiveVisibleCompletedMissions") {
    const ids = state.visibleBulkCandidates?.archiveCompletedIds || [];
    if (!ids.length) return;
    return postWithInteractionId("bulkArchiveVisibleCompletedMissions", { missionIds: ids });
  }
  if (action === "bulkDeleteVisibleFailedOrCancelledMissions") {
    const ids = state.visibleBulkCandidates?.deleteFailedOrCancelledIds || [];
    if (!ids.length) return;
    return postWithInteractionId("bulkDeleteVisibleFailedOrCancelledMissions", { missionIds: ids });
  }
  if (action === "bulkDeleteVisibleBlockedMissions") {
    const ids = state.visibleBulkCandidates?.deleteBlockedIds || [];
    if (!ids.length) return;
    return postWithInteractionId("bulkDeleteVisibleBlockedMissions", { missionIds: ids });
  }
  if (action === 'bulkArchiveCompletedMissions') return postWithInteractionId('bulkArchiveCompletedMissions');
  if (action === 'bulkDeleteFailedTestMissions') return postWithInteractionId('bulkDeleteFailedTestMissions');
  if (action === 'bulkDeleteBlockedTestMissions') return postWithInteractionId('bulkDeleteBlockedTestMissions');
  if (action === 'editMissionPolicy') return post('editMissionPolicy', { missionId });
  if (action === 'editAgentRouting') return post('editAgentRouting', { missionId });
  if (action === 'openRoutingTab') {
    if (missionId) postWithInteractionId('focusMission', { missionId });
    setActiveTab('routing');
    return;
  }
  if (action === 'editMissionDag') return post('editMissionDag', { missionId });
  if (action === 'generateMissionReport' && missionId) return post('generateMissionReport', { missionId });
  if (action === "approveMissionBlueprint" && missionId) return post("approveMissionBlueprint", { missionId });
  if (action === "rejectMissionBlueprint" && missionId) {
    if (!globalThis.confirm("Reject blueprint and cancel this mission?")) return;
    return post("rejectMissionBlueprint", { missionId });
  }
  if (action === "requestMissionBlueprintRevision" && missionId) {
    const note = globalThis.prompt("What should change in the blueprint?");
    if (!note || !String(note).trim()) return;
    return post("requestMissionBlueprintRevision", { missionId, note: String(note).trim() });
  }
  if (action === "submitPreBlueprintAnswers" && missionId) {
    const ta = globalThis.document.getElementById("preBlueprintAnswersField");
    const answers = ta && "value" in ta ? String(ta.value) : "";
    return post("submitPreBlueprintAnswers", { missionId, answers });
  }
  if (action === "exportMissionBlueprint" && missionId) {
    return post("exportMissionBlueprint", { missionId });
  }
  if (action === "copyMissionBlueprint" && missionId) {
    return post("copyMissionBlueprint", { missionId });
  }
  if (action === 'copyMissionReport' && missionId) {
    const c = state.missionReportCache;
    const statusEl = globalThis.document?.getElementById?.("missionActionStatus");
    if (!c || c.missionId !== missionId || !c.markdown) return;
    const clip = globalThis.navigator?.clipboard;
    if (!clip?.writeText) {
      if (statusEl) statusEl.textContent = "Clipboard API unavailable.";
      return;
    }
    void clip.writeText(c.markdown).then(
      () => {
        if (statusEl) statusEl.textContent = "Report copied to clipboard.";
      },
      () => {
        if (statusEl) statusEl.textContent = "Could not copy (clipboard blocked).";
      }
    );
    return;
  }
  if (action === 'approve') return postWithInteractionId('approve', { missionId, approvalId });
  if (action === 'reject') return postWithInteractionId('reject', { missionId, approvalId });
  if (action === 'reviewPendingDiff') return post('reviewPendingDiff', { missionId, approvalId });
  if (action === 'reviewPendingHunks') return post('reviewPendingHunks', { missionId, approvalId });
  if (action === 'reviewBundleSummary') return post('reviewBundleSummary', { missionId });
  if (action === 'approveBundle') return postWithInteractionId('approveBundle', { bundleId });
  if (action === 'rejectBundle') return postWithInteractionId('rejectBundle', { bundleId });
  if (action === 'createStarterMcpConfig') return post('createStarterMcpConfig');
  if (action === 'openSettings') {
    const q = btn.dataset.query;
    return q ? post('openSettings', { query: q }) : post('openSettings');
  }
});

function chatPostPayload() {
  return {
    providerId: els.chatProviderSelect?.value || undefined,
    model: els.chatModelInput?.value?.trim() || undefined
  };
}

els.chatModelInput?.addEventListener('input', () => { state.dirty.chatRow = true; });
els.chatModelInput?.addEventListener('change', () => { state.dirty.chatRow = true; });

els.sendChat?.addEventListener('click', () => {
  const prompt = els.chatPrompt.value.trim();
  if (!prompt) return;
  state.chatHistory.pushUser(prompt);
  state.chatBuffer = '';
  els.chatPrompt.value = '';
  renderChat(state.snapshot);
  post('sendChat', { prompt, ...chatPostPayload() });
});
els.chatPrompt?.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); els.sendChat.click(); }
});
els.startMission?.addEventListener('click', () => {
  const title = els.missionTitle.value.trim() || 'Autonomous Mission';
  const prompt = els.missionPrompt.value.trim(); if (!prompt) return;
  post('startMission', { title, prompt, ...chatPostPayload() });
});
els.openProvidersFromChat?.addEventListener('click', () => setActiveTab('providers'));
els.refreshDashboard?.addEventListener('click', () => postWithInteractionId('refreshDashboard'));
els.resumeFocusedMission?.addEventListener('click', () => state.snapshot?.focusedMissionId && post('resumeMission', { missionId: state.snapshot.focusedMissionId }));
els.abortFocusedMissionLlm?.addEventListener('click', () => state.snapshot?.focusedMissionId && post('abortMissionLlm', { missionId: state.snapshot.focusedMissionId }));
els.inspectSelectedDiff?.addEventListener('click', () => state.selectedApproval && post('reviewPendingDiff', { missionId: state.selectedApproval.missionId, approvalId: state.selectedApproval.approvalId }));
els.inspectSelectedHunks?.addEventListener('click', () => state.selectedApproval && post('reviewPendingHunks', { missionId: state.selectedApproval.missionId, approvalId: state.selectedApproval.approvalId }));
els.openTerminal?.addEventListener('click', () => post('openTerminal'));
els.listMcpTools?.addEventListener('click', () => post('listMcpTools'));
els.openMcpConfig?.addEventListener('click', () => post('openMcpConfig'));
els.listMcpSessions?.addEventListener('click', () => post('listMcpSessions'));
els.reviewFocusedDiff?.addEventListener('click', () => state.snapshot?.focusedMissionId && post('reviewPendingDiff', { missionId: state.snapshot.focusedMissionId }));
els.reviewFocusedHunks?.addEventListener('click', () => state.snapshot?.focusedMissionId && post('reviewPendingHunks', { missionId: state.snapshot.focusedMissionId }));
els.reviewFocusedBundle?.addEventListener('click', () => state.snapshot?.focusedMissionId && post('reviewBundleSummary', { missionId: state.snapshot.focusedMissionId }));
els.openBundlesTab?.addEventListener('click', () => setActiveTab('bundles'));
els.applyLazyDiscoveryPreset?.addEventListener('click', () => post('applyLazyDiscoveryPreset'));
els.revertLazyDiscoveryPreset?.addEventListener('click', () => post('revertLazyDiscoveryPreset'));
els.openSettings?.addEventListener('click', () => post('openSettings'));
els.openAgentCapabilitiesDoc?.addEventListener('click', () => post('openAgentCapabilitiesDoc'));
els.openMissionAutonomyBlueprint?.addEventListener('click', () => post('openMissionAutonomyBlueprint'));
els.focusChatInput?.addEventListener('click', () => els.chatPrompt?.focus());
els.approveFocusedBundle?.addEventListener('click', () => state.selectedBundle?.id && postWithInteractionId('approveBundle', { bundleId: state.selectedBundle.id }));
els.rejectFocusedBundle?.addEventListener('click', () => state.selectedBundle?.id && postWithInteractionId('rejectBundle', { bundleId: state.selectedBundle.id }));
els.inspectFocusedPolicy?.addEventListener('click', () => state.snapshot?.focusedMissionId && post('editMissionPolicy', { missionId: state.snapshot.focusedMissionId }));
els.inspectFocusedRouting?.addEventListener('click', () => state.snapshot?.focusedMissionId && setActiveTab('routing'));
els.inspectFocusedDag?.addEventListener('click', () => state.snapshot?.focusedMissionId && post('editMissionDag', { missionId: state.snapshot.focusedMissionId }));
document.getElementById('saveQuickSettings')?.addEventListener('click', () => {
  post('saveQuickSettings', {
    defaultProvider: document.getElementById('settingDefaultProvider')?.value || (state.snapshot?.defaultProvider || 'ollama'),
    defaultModel: document.getElementById('settingDefaultModel')?.value || (state.snapshot?.defaultModel || ''),
    heartbeatSeconds: Number(document.getElementById('settingHeartbeatSeconds')?.value || 12),
    maxStepsPerRun: Number(document.getElementById('settingMaxStepsPerRun')?.value || 128),
    unlimitedStepsPerRun: !!document.getElementById('settingUnlimitedStepsPerRun')?.checked,
    allowTerminal: !!document.getElementById('settingAllowTerminal')?.checked,
    requireWriteApproval: !!document.getElementById('settingRequireWriteApproval')?.checked,
    requireApprovalForNonImplementerMutations: !!document.getElementById(
      'settingRequireApprovalForNonImplementerMutations'
    )?.checked,
    autoApproveAllToolRequests: !!document.getElementById('settingAutoApproveAllToolRequests')?.checked,
    autoRevealOnActivation: !!document.getElementById('settingAutoRevealOnActivation')?.checked,
    defaultTab: document.getElementById('settingDefaultTab')?.value || 'chat'
  });
});
document.getElementById('openSettings2')?.addEventListener('click', () => post('openSettings'));
els.timelineFilterText?.addEventListener('input', () => { state.timelineFilterText = els.timelineFilterText.value; state.snapshot && renderTimeline(state.snapshot); });
els.timelineFilterLevel?.addEventListener('change', () => { state.timelineFilterLevel = els.timelineFilterLevel.value; state.snapshot && renderTimeline(state.snapshot); });
els.timelineFilterFocusedOnly?.addEventListener('change', () => { state.timelineFocusedOnly = els.timelineFilterFocusedOnly.checked; state.snapshot && renderTimeline(state.snapshot); });
els.clearTimelineFilters?.addEventListener('click', () => { state.timelineFilterText = ''; state.timelineFilterLevel = 'all'; state.timelineFocusedOnly = false; els.timelineFilterText.value=''; els.timelineFilterLevel.value='all'; els.timelineFilterFocusedOnly.checked=false; state.snapshot && renderTimeline(state.snapshot); });
els.memoryQuery?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const query = els.memoryQuery.value.trim(); if (query) post('searchGlobalMemory', { query }); }});
document.getElementById('searchMemory')?.addEventListener('click', () => { const query = els.memoryQuery.value.trim(); if (query) post('searchGlobalMemory', { query }); });
document.getElementById('clearMemorySearch')?.addEventListener('click', () => { els.memoryQuery.value=''; state.memorySearchResults = []; state.snapshot && renderMemory(state.snapshot); });

function wireQuickSettingsDirtyTracking() {
  const mark = () => {
    state.dirty.quickSettings = true;
    updateQuickDirtyBadge();
  };
  ['settingDefaultModel', 'settingHeartbeatSeconds', 'settingMaxStepsPerRun', 'settingDefaultTab'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', mark);
    document.getElementById(id)?.addEventListener('change', mark);
  });
  [
    'settingAllowTerminal',
    'settingRequireWriteApproval',
    'settingRequireApprovalForNonImplementerMutations',
    'settingAutoApproveAllToolRequests',
    'settingAutoRevealOnActivation',
    'settingUnlimitedStepsPerRun'
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', mark);
  });
  document.getElementById('settingDefaultProvider')?.addEventListener('change', (e) => {
    mark();
    const pid = e.target.value;
    const snap = state.snapshot;
    const inp = document.getElementById('settingDefaultModel');
    if (inp) inp.value = snap?.providerSavedModels?.[pid] || '';
    if (state.snapshot) renderSettings(state.snapshot, { force: true });
  });
}

wireQuickSettingsDirtyTracking();

document.getElementById('settingUnlimitedStepsPerRun')?.addEventListener('change', () => {
  const cb = document.getElementById('settingUnlimitedStepsPerRun');
  const inp = document.getElementById('settingMaxStepsPerRun');
  if (!cb || !inp) return;
  inp.disabled = !!cb.checked;
});

els.panelBaseUrl?.addEventListener('input', () => {
  state.dirty.providersForm = true;
  updateProvidersDirtyBadge();
});
els.panelModelInput?.addEventListener('input', () => {
  state.dirty.providersForm = true;
  updateProvidersDirtyBadge();
});

function markModelPickerScopeDirty(scope) {
  if (scope === 'providersForm') {
    state.dirty.providersForm = true;
    updateProvidersDirtyBadge();
    return;
  }
  if (scope === 'quickSettings') {
    state.dirty.quickSettings = true;
    updateQuickDirtyBadge();
    return;
  }
  if (scope === 'chatRow') {
    state.dirty.chatRow = true;
    return;
  }
  if (scope === 'routingPanel') {
    state.dirty.routingPanel = true;
    const badge = document.getElementById('routingDirtyBadge');
    if (badge) badge.hidden = false;
  }
}

document.addEventListener('click', (e) => {
  const trigger = e.target?.closest?.('[data-model-picker-trigger="true"]');
  if (trigger) {
    e.stopPropagation();
    const field = trigger.closest('.model-picker-field');
    if (field) toggleModelPicker(field);
    return;
  }
  const item = e.target?.closest?.('.model-catalog-item');
  if (item) {
    const field = item.closest('.model-picker-field');
    if (!field || !item.dataset) return;
    e.stopPropagation();
    const input = field.querySelector('input');
    if (input) input.value = item.dataset.model || '';
    markModelPickerScopeDirty(field.dataset.modelPickerScope || '');
    closeModelPicker(field);
    return;
  }
});

document.addEventListener('click', (ev) => {
  const field = ev.target && ev.target.closest && ev.target.closest('.model-picker-field');
  if (field) return;
  const openFields = document.querySelectorAll ? document.querySelectorAll('.model-picker-field') : [];
  openFields.forEach((el) => closeModelPicker(el));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const openFields = document.querySelectorAll ? document.querySelectorAll('.model-picker-field') : [];
    openFields.forEach((el) => closeModelPicker(el));
  }
});

els.panelProviderSelect?.addEventListener('change', () => {
  state.dirty.providersForm = false;
  updateProvidersDirtyBadge();
  if (state.snapshot) renderProvidersPanel(state.snapshot);
});

els.chatProviderSelect?.addEventListener('change', () => {
  state.dirty.chatRow = true;
  if (els.chatModelInput) els.chatModelInput.value = '';
  if (state.snapshot) syncChatProviderRow(state.snapshot);
});

document.getElementById('revertQuickSettings')?.addEventListener('click', () => {
  state.dirty.quickSettings = false;
  updateQuickDirtyBadge();
  if (state.snapshot) renderSettings(state.snapshot);
});

document.getElementById('revertProvidersForm')?.addEventListener('click', () => {
  state.dirty.providersForm = false;
  updateProvidersDirtyBadge();
  if (state.snapshot) renderProvidersPanel(state.snapshot);
});

document.getElementById('revertChatRow')?.addEventListener('click', () => {
  state.dirty.chatRow = false;
  if (state.snapshot) syncChatProviderRow(state.snapshot);
});

document.getElementById('btnRefreshProviderModels')?.addEventListener('click', () => {
  const id = els.panelProviderSelect?.value;
  if (!id) return;
  const statusEl = document.getElementById('panelCatalogRefreshStatus');
  if (statusEl) statusEl.textContent = `Refreshing models for ${id}…`;
  post('refreshProviderModels', { providerId: id });
});

document.getElementById('btnSaveProviderKey')?.addEventListener('click', () => {
  const id = els.panelProviderSelect?.value; const key = els.panelApiKey?.value || '';
  if (!id) return;
  post('saveProviderCredential', { providerId: id, apiKey: key });
});
document.getElementById('btnClearProviderKey')?.addEventListener('click', () => {
  const id = els.panelProviderSelect?.value; if (!id) return;
  post('clearProviderCredential', { providerId: id });
});
document.getElementById('btnSaveBaseUrl')?.addEventListener('click', () => {
  const id = els.panelProviderSelect?.value; const baseUrl = els.panelBaseUrl?.value || '';
  if (!id) return;
  post('saveProviderBaseUrl', { providerId: id, baseUrl });
});
document.getElementById('btnSaveProviderModel')?.addEventListener('click', () => {
  const id = els.panelProviderSelect?.value; const model = els.panelModelInput?.value || '';
  if (!id) return;
  post('saveProviderModelDefault', { providerId: id, model });
});
document.getElementById('btnApplyDefaults')?.addEventListener('click', () => {
  const id = els.panelProviderSelect?.value; const model = els.panelModelInput?.value || '';
  if (!id) return;
  post('applyDefaultProviderAndModel', { defaultProvider: id, defaultModel: model });
});
document.getElementById('btnTestProvider')?.addEventListener('click', () => {
  const id = els.panelProviderSelect?.value; if (!id) return;
  post('testProviderConnection', { providerId: id });
});

document.getElementById('btnTraceRefresh')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'requestTraceLog' });
});
document.getElementById('btnTraceExport')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'exportTraceLogFromUi' });
});
document.getElementById('btnTraceClear')?.addEventListener('click', () => {
  if (!confirm('Clear the trace ring buffer and the Autonomous Factory Trace output channel?')) return;
  vscode.postMessage({ type: 'clearTraceLogFromUi' });
});
document.getElementById('btnTraceOpenOutput')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'openTraceOutputChannel' });
});
document.getElementById('traceLevelSelect')?.addEventListener('change', (e) => {
  const level = e.target.value;
  if (['error', 'info', 'debug', 'trace'].includes(level)) {
    vscode.postMessage({ type: 'setTraceLevelFromUi', level });
  }
});
document.getElementById('traceAutoRefresh')?.addEventListener('change', (ev) => {
  if (ev.target.checked && state.activeTab === 'trace') startTraceAutoRefresh();
  else stopTraceAutoRefresh();
});

}
