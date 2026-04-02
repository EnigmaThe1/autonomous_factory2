import {
  approvalsQueueSig,
  bundlesPanelSig,
  memoryPanelSig,
  chatPanelSig,
  providersPanelSig,
  settingsPanelSig,
  toolsPanelSig
} from "./webviewSignatures.js";
import { formatMissionEventMessageHtml, formatMissionEventRowHtml } from "./missionEventLabels.js";
import { formatMissionMemoryTextHtml } from "./missionMemoryLabels.js";
import { syncProviderAwareModelPicker } from "./webviewModelPicker.js";
import { createRoutingRenderer } from "./webviewRenderRouting.js";
import { formatMissionProgressStatsLineHtml } from "./missionProgressDashboard.js";

function formatHealthAge(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export function createPanelRenderers(deps) {
  const {
    state,
    els,
    sigCache,
    escapeHtml,
    relTime,
    mdToHtml,
    post,
    mergeModelLists,
    fillProviderModelCatalogList
  } = deps;

function selectedApproval(snapshot) {
  return snapshot.pendingApprovals.find(a => a.approvalId === state.selectedApproval?.approvalId) || snapshot.pendingApprovals[0] || null;
}

function selectedBundle(snapshot) {
  return snapshot.approvalBundles.find(b => b.id === state.selectedBundle?.id) || snapshot.approvalBundles[0] || null;
}

/**
 * Signature-gate: returns true if the render should proceed, false if
 * the computed signature matches the cached one (meaning nothing changed).
 * Automatically updates the cache when the render proceeds.
 */
function withSig(cacheKey, sig, force) {
  if (!force && sig === sigCache[cacheKey]) return false;
  sigCache[cacheKey] = sig;
  return true;
}

const { routingDraftFromMission, syncRoutingDraftFromSnapshot, renderRouting, renderHunkTabs } = createRoutingRenderer(deps, withSig);

function modelPlaceholderForProvider(snapshot, providerId) {
  const pid = providerId || snapshot.defaultProvider;
  return (snapshot.providerSavedModels && snapshot.providerSavedModels[pid]) || (pid === snapshot.defaultProvider ? snapshot.resolvedDefaultModel || '' : '');
}

/** One-line hint for how the next mission will plan (reads workspace mission settings from snapshot). */
function missionStartBlueprintHintText(settings) {
  if (!settings) return "";
  if (!settings.missionBlueprintMode) {
    return "Plan: legacy WORK: queue. Enable myAi.missions.blueprintMode for upfront JSON blueprint.";
  }
  const bits = ["Plan: JSON blueprint"];
  bits.push(settings.missionPreBlueprintClarification ? "pre-Q&A on" : "pre-Q&A off");
  bits.push(settings.missionRequireBlueprintApproval ? "blueprint approval required" : "blueprint auto-approved");
  return bits.join(" · ");
}

function renderChat(snapshot, opts = {}) {
  const sig = chatPanelSig(snapshot, state.chatBuffer, state.chatHistory, state.agentStream);
  if (!withSig("lastChatSig", sig, opts.force)) return;
  const focused = snapshot?.focusedMission;
  const cards = [];
  if (focused) {
    const recentToolResults = (focused.memory || []).filter(item => item.kind === 'tool_result').slice(-4).reverse();
    for (const item of recentToolResults) {
      cards.push(`<div class="result-card"><div class="row split"><strong>Tool result</strong><span class="meta">${relTime(item.ts)}</span></div>${formatMissionMemoryTextHtml(item.text, escapeHtml)}</div>`);
    }
  }

  const agentStreamHtml = state.agentStream?.text
    ? `<div class="agent-stream-bubble"><div class="agent-stream-header">${escapeHtml(state.agentStream.role)} streaming\u2026</div><pre class="agent-stream-output">${escapeHtml(state.agentStream.text.slice(-2000))}</pre></div>`
    : '';

  const history = state.chatHistory?.entries || [];
  const historyHtml = history.map(entry => {
    if (entry.role === "user") {
      return `<div class="user-bubble">${escapeHtml(entry.content)}</div>`;
    }
    return `<div class="assistant-bubble">${mdToHtml(entry.content)}</div>`;
  }).join('');

  const streamingHtml = state.chatBuffer
    ? `<div class="assistant-bubble streaming">${mdToHtml(state.chatBuffer)}</div>`
    : '';

  const conversationHtml = historyHtml + streamingHtml;
  const body = conversationHtml || (agentStreamHtml ? '' : '<div class="empty">No chat output yet. Type a message below to start.</div>');

  const clearBtn = history.length
    ? '<button type="button" id="btnClearChatHistory" class="ghost compact" style="margin-bottom:8px;" title="Clear conversation">New chat</button>'
    : '';

  const focusedStrip = focused
    ? `<div class="chat-focused-mission" style="margin-bottom:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--vscode-widget-border, rgba(255,255,255,.12));background:var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,.1));">
         <div class="row split"><strong>${escapeHtml(focused.title)}</strong><span class="badge ${escapeHtml(focused.status)}">${escapeHtml(focused.status)}</span></div>
         ${formatMissionProgressStatsLineHtml(snapshot.missionProgressStats?.[focused.id], escapeHtml)}
       </div>`
    : "";

  els.chatOutput.innerHTML = clearBtn + focusedStrip + body + agentStreamHtml + (cards.length ? `<div class="section-title small" style="margin-top:10px;">Recent tool/result cards</div>${cards.join('')}` : '');

  if (els.missionStartBlueprintHint) {
    els.missionStartBlueprintHint.textContent = missionStartBlueprintHintText(snapshot.settings);
  }

  const clearEl = document.getElementById('btnClearChatHistory');
  if (clearEl) {
    clearEl.addEventListener('click', () => {
      state.chatHistory.clear();
      state.chatBuffer = '';
      post('clearChatHistory', {});
      renderChat(snapshot, { force: true });
    });
  }
}

function renderApprovals(snapshot, opts = {}) {
  const sig = approvalsQueueSig(snapshot, state.selectedApproval, state.selectedHunkIndex);
  if (!withSig("lastApprovalsQueueSig", sig, opts.force)) return;
  els.approvalQueueCount.textContent = String(snapshot.pendingApprovals.length);
  els.approvalQueue.innerHTML = snapshot.pendingApprovals.map(a => `
    <div class="approval-card ${state.selectedApproval?.approvalId === a.approvalId ? 'selected' : ''}" data-action="selectApproval" data-mission-id="${a.missionId}" data-approval-id="${a.approvalId}">
      <div class="row split"><strong>${escapeHtml(a.title)}</strong><span class="badge">${escapeHtml(a.kind)}</span></div>
      <div class="meta">${escapeHtml(a.missionTitle)}${a.targetPath ? ` • ${escapeHtml(a.targetPath)}` : ''}</div>
      <div class="meta">${a.hunkCount || 0} hunk(s)</div>
      <div class="row compact wrap">
        <button data-action="approve" data-mission-id="${a.missionId}" data-approval-id="${a.approvalId}">Approve</button>
        <button data-action="reject" data-mission-id="${a.missionId}" data-approval-id="${a.approvalId}" class="ghost">Reject</button>
        <button data-action="reviewPendingDiff" data-mission-id="${a.missionId}" data-approval-id="${a.approvalId}" class="ghost">Open Diff</button>
        <button data-action="reviewPendingHunks" data-mission-id="${a.missionId}" data-approval-id="${a.approvalId}" class="ghost">Open Hunks</button>
      </div>
    </div>`).join('') || '<div class="empty">No pending approvals.</div>';
  const selected = selectedApproval(snapshot);
  if (selected) state.selectedApproval = { missionId: selected.missionId, approvalId: selected.approvalId };
  state.selectedHunkIndex = Math.max(0, Math.min(state.selectedHunkIndex, Math.max(0, (selected?.hunks?.length || 1) - 1)));
  els.approvalInspector.innerHTML = selected ? `
    <div class="detail-block approval-inspector-block">
      <div class="row split"><strong>${escapeHtml(selected.title)}</strong><span class="badge">${escapeHtml(selected.kind)}</span></div>
      <div class="meta">${escapeHtml(selected.missionTitle)}${selected.targetPath ? ` • ${escapeHtml(selected.targetPath)}` : ''} • ${relTime(selected.createdAt)}</div>
      <p>${escapeHtml(selected.details)}</p>
      ${selected.beforeText !== undefined || selected.afterText !== undefined ? `
        <div class="section-title small">Side-by-side preview</div>
        <div class="diff-grid two-col whole-file">
          <div class="diff-panel before"><div class="diff-head">Before</div><pre>${escapeHtml(selected.beforeText || '')}</pre></div>
          <div class="diff-panel after"><div class="diff-head">After</div><pre>${escapeHtml(selected.afterText || '')}</pre></div>
        </div>` : '<div class="empty">No full-file diff preview available.</div>'}
      ${renderHunkTabs(selected)}
    </div>` : '<div class="empty">Select an approval to inspect it.</div>';
}

function renderBundles(snapshot, opts = {}) {
  const sig = bundlesPanelSig(snapshot, state.selectedBundle);
  if (!withSig("lastBundlesSig", sig, opts.force)) return;
  const selected = selectedBundle(snapshot);
  if (selected) state.selectedBundle = { id: selected.id };
  els.approvalBundles.innerHTML = snapshot.approvalBundles.map(b => `
    <div class="bundle-card ${selected?.id === b.id ? 'selected' : ''}" data-action="selectBundle" data-bundle-id="${b.id}">
      <div class="row split"><strong>${escapeHtml(b.title)}</strong><span class="badge">${b.approvalCount}</span></div>
      <div class="meta">${escapeHtml(b.missionTitle)} • ${escapeHtml(b.kinds.join(', '))}</div>
      <div class="meta">${escapeHtml((b.targetPaths || []).join(' • ') || 'No target path')}</div>
      <div class="row compact wrap">
        <button data-action="reviewBundleSummary" data-mission-id="${b.missionId}">Summary</button>
        <button data-action="focusMission" data-mission-id="${b.missionId}" class="ghost">Focus mission</button>
        <button data-action="approveBundle" data-bundle-id="${b.id}">Approve bundle</button>
        <button data-action="rejectBundle" data-bundle-id="${b.id}" class="ghost">Reject bundle</button>
      </div>
    </div>`).join('') || '<div class="empty">No approval bundles.</div>';
}

function formatTimelineEventBody(item, escapeHtml) {
  if (item.operatorActionHeadline) {
    return `<div class="timeline-operator-action"><div class="timeline-operator-action-headline">${escapeHtml(item.operatorActionHeadline)}</div><div class="meta timeline-operator-action-raw">${escapeHtml(item.message)}</div></div>`;
  }
  return formatMissionEventMessageHtml(item.message, escapeHtml);
}

function renderTimeline(snapshot) {
  const focusedId = snapshot.focusedMissionId;
  const q = state.timelineFilterText.toLowerCase();
  const filtered = snapshot.timeline.filter(item => {
    if (state.timelineFilterLevel !== 'all' && item.level !== state.timelineFilterLevel) return false;
    if (state.timelineFocusedOnly && focusedId && item.missionId !== focusedId) return false;
    if (q && !(`${item.message} ${item.source} ${item.missionTitle}`.toLowerCase().includes(q))) return false;
    return true;
  });
  const groups = new Map();
  for (const item of filtered) {
    const arr = groups.get(item.missionId) || { title: item.missionTitle, items: [] };
    arr.items.push(item);
    groups.set(item.missionId, arr);
  }
  els.timeline.innerHTML = Array.from(groups.entries()).map(([missionId, group]) => `
    <div class="timeline-group ${missionId === focusedId ? 'focused' : ''}">
      <div class="row split"><strong>${escapeHtml(group.title)}</strong><span class="badge">${group.items.length}</span></div>
      ${group.items.map(item => `<div class="timeline-item level-${item.level}"><span class="meta">${new Date(item.ts).toLocaleTimeString()} • ${escapeHtml(item.source)} • ${relTime(item.ts)}</span>${formatTimelineEventBody(item, escapeHtml)}</div>`).join('')}
    </div>`).join('') || '<div class="empty">No timeline events for the current filters.</div>';
}

function renderAgents(snapshot) {
  els.agents.innerHTML = snapshot.agents.map(a => `
    <div class="agent-card"><div class="row split"><strong>${escapeHtml(a.role)}</strong><span class="meta">${escapeHtml(a.provider || '')} • ${escapeHtml(a.model || '')}</span></div><div class="meta">todo ${a.todo} • running ${a.running} • done ${a.done} • skipped ${a.skipped ?? 0} • blocked ${a.blocked}</div></div>`).join('');
  els.agentLive.innerHTML = snapshot.agentLive.map(a => `
    <div class="agent-live-card">
      <div class="row split"><strong>${escapeHtml(a.role)}</strong><span class="badge ${a.status}">${escapeHtml(a.status)}</span></div>
      <div class="meta">${escapeHtml(a.currentWork || 'No current work item')}</div>
      <div class="section-title small">Role events</div>
      ${(a.recentEvents || []).map(e => `<div class="timeline-item level-${e.level}"><span class="meta">${new Date(e.ts).toLocaleTimeString()} • ${escapeHtml(e.source || a.role)} • ${relTime(e.ts)}</span>${formatMissionEventMessageHtml(e.message, escapeHtml)}</div>`).join('') || '<div class="empty">No recent role events.</div>'}
      <div class="section-title small" style="margin-top:8px;">Tool/result cards</div>
      ${(a.recentToolEvents || []).map(e => `<div class="result-card compact-card"><div class="row split"><strong>${escapeHtml(e.source)}</strong><span class="meta">${relTime(e.ts)}</span></div>${formatMissionMemoryTextHtml(e.message, escapeHtml)}</div>`).join('') || '<div class="empty">No recent tool calls.</div>'}
    </div>`).join('') || '<div class="empty">No agent activity yet.</div>';
}

function renderMemory(snapshot, opts = {}) {
  const sig = memoryPanelSig(snapshot, state.memorySearchResults);
  if (!withSig("lastMemorySig", sig, opts.force)) return;
  const focused = snapshot.focusedMission;
  els.globalMemory.innerHTML = snapshot.globalMemoryRecent.map(m => `<div class="memory-item"><span class="meta">${new Date(m.ts).toLocaleString()} • ${escapeHtml(m.kind)}</span>${formatMissionMemoryTextHtml(m.text, escapeHtml)}</div>`).join('') || '<div class="empty">No global memory yet.</div>';
  els.missionMemory.innerHTML = (focused?.memory || []).slice(-10).reverse().map(m => `<div class="memory-item"><span class="meta">${new Date(m.ts).toLocaleString()} • ${escapeHtml(m.kind)}</span>${formatMissionMemoryTextHtml(m.text, escapeHtml)}</div>`).join('') || '<div class="empty">No mission memory for focused mission.</div>';
  els.memorySearchResults.innerHTML = state.memorySearchResults.map(m => `<div class="memory-item"><span class="meta">${new Date(m.ts).toLocaleString()} • ${escapeHtml(m.kind)}</span>${formatMissionMemoryTextHtml(m.text, escapeHtml)}</div>`).join('') || '<div class="empty">No search results.</div>';
}

function renderConsole(snapshot) {
  const focused = snapshot.focusedMission;
  const oaHeadlines = snapshot.focusedMissionOperatorActionHeadlines;
  const recentEvents = (focused?.events || []).slice(-20).reverse();
  els.consoleOutput.innerHTML = recentEvents.length ? recentEvents.map(ev => {
    const isTool = String(ev.source || '').startsWith('tool:');
    return `<div class="${isTool ? 'result-card' : 'timeline-item'} level-${ev.level}"><span class="meta">${new Date(ev.ts).toLocaleTimeString()} • ${escapeHtml(ev.source)} • ${relTime(ev.ts)}</span>${isTool ? `<div>${escapeHtml(ev.message)}</div>` : formatMissionEventRowHtml(ev, oaHeadlines, escapeHtml)}${ev.data !== undefined ? `<pre class="json-block">${escapeHtml(JSON.stringify(ev.data, null, 2).slice(0, 1200))}</pre>` : ''}</div>`;
  }).join('') : '<div class="empty">No console output yet.</div>';
}

function mcpOnboardingStatusLabel(status) {
  const map = {
    no_workspace: 'No workspace folder open',
    file_missing: 'MCP config file missing',
    invalid_json: 'MCP config is not valid JSON',
    no_servers: 'MCP config has no servers',
    ready: 'MCP config loaded',
    bundled_sample_missing: 'Bundled sample missing (extension install issue)'
  };
  return map[status] || status;
}

function renderTools(snapshot, opts = {}) {
  const sig = toolsPanelSig(snapshot);
  if (!withSig("lastToolsSig", sig, opts.force)) return;
  const recentCards = (snapshot.tools.recentToolEvents || []).map(ev => `<div class="result-card compact-card"><div class="row split"><strong>${escapeHtml(ev.source)}</strong><span class="meta">${escapeHtml(ev.missionTitle)} • ${relTime(ev.ts)}</span></div>${formatMissionMemoryTextHtml(ev.message, escapeHtml)}</div>`).join('') || '<div class="empty">No recent tool events.</div>';
  const m = snapshot.mcpOnboarding || {};
  const starterBtn = m.canCreateStarter
    ? `<div style="margin-top:8px;"><button type="button" data-action="createStarterMcpConfig" class="primary">Create starter MCP config</button></div>`
    : '';
  const destLine = m.starterDestinationRelative
    ? `<div class="meta">Starter writes to: <code class="inline-code">${escapeHtml(m.starterDestinationRelative)}</code> (editable in your workspace)</div>`
    : '';
  const resolvedLine = m.resolvedAbsolutePath
    ? `<div class="meta">Resolved file: <code class="inline-code">${escapeHtml(m.resolvedAbsolutePath)}</code></div>`
    : '';
  els.toolSummary.innerHTML = `
    <div class="section-title small">MCP configuration</div>
    <div class="meta"><strong>Status:</strong> ${escapeHtml(mcpOnboardingStatusLabel(m.status))}</div>
    <div class="meta">${escapeHtml(m.hint || '')}</div>
    <div class="meta">Setting <code class="inline-code">myAi.mcp.configPath</code>: <code class="inline-code">${escapeHtml(m.configuredPath || '')}</code></div>
    ${resolvedLine}
    ${destLine}
    ${starterBtn}
    <div class="section-title small" style="margin-top:12px;">Tool activity</div>
    <div class="meta">Built-in tools: ${snapshot.tools.builtinTools.join(', ')}</div>
    <div class="meta">MCP tools: ${snapshot.tools.mcpToolCount}</div>
    <div class="meta">MCP sessions: ${snapshot.tools.mcpSessionCount}</div>
    <div class="section-title small" style="margin-top:8px;">Recent tool/result cards</div>
    ${recentCards}`;
}

function updateQuickDirtyBadge() {
  const b = document.getElementById('quickSettingsDirtyBadge');
  if (b) b.hidden = !state.dirty.quickSettings;
}

function updateProvidersDirtyBadge() {
  const b = document.getElementById('providersDirtyBadge');
  if (b) b.hidden = !state.dirty.providersForm;
}

function syncChatProviderRow(snapshot) {
  const provSel = els.chatProviderSelect;
  const modelInp = els.chatModelInput;
  const modelBtn = document.getElementById('btnChatModelCatalog');
  const modelPop = document.getElementById('chatModelCatalogPopover');
  const modelEmpty = document.getElementById('chatModelCatalogEmpty');
  const modelList = document.getElementById('chatModelCatalogUl');
  if (!provSel || !snapshot) return;
  const ids = snapshot.providers || [];
  if (!state.dirty.chatRow) {
    const cur = provSel.value;
    provSel.innerHTML = ids.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    provSel.value = ids.includes(cur) ? cur : (snapshot.defaultProvider || ids[0] || '');
    if (modelInp) {
      modelInp.value = '';
      modelInp.placeholder = modelPlaceholderForProvider(snapshot, provSel.value);
      delete modelInp.dataset.userEdited;
    }
  } else {
    const seen = new Set(Array.from(provSel.options).map(o => o.value));
    ids.forEach(p => {
      if (!seen.has(p)) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        provSel.appendChild(opt);
        seen.add(p);
      }
    });
  }
  syncProviderAwareModelPicker({
    snapshot,
    providerId: provSel.value || snapshot.defaultProvider,
    inputEl: modelInp,
    buttonEl: modelBtn,
    popoverEl: modelPop,
    listEl: modelList,
    emptyEl: modelEmpty,
    mergeModelLists,
    fillProviderModelCatalogList
  });
}

function renderProvidersPanel(snapshot, opts = {}) {
  const sig = providersPanelSig(snapshot);
  if (!withSig("lastProvidersPanelSig", sig, opts.force)) return;
  const sum = els.providerCredentialSummary;
  const psel = els.panelProviderSelect;
  if (!sum || !psel || !snapshot) return;
  const healthMap = snapshot.providerHealth || {};
  sum.innerHTML = (snapshot.providerCredentialStatus || []).map(s => {
    const health = healthMap[s.id];
    const credCls = s.needsApiKey ? (s.configured ? 'ok' : 'warn') : 'ok';
    const healthCls = health ? (health.ok ? 'health-ok' : 'health-err') : '';
    const cls = `cred-pill ${credCls} ${healthCls}`.trim();
    const label = s.needsApiKey ? (s.configured ? 'key saved' : 'needs key') : 'no key';
    const dot = health ? (health.ok ? '\u2705' : '\u274C') : '\u2B55';
    const latency = health?.latencyMs != null ? ` ${health.latencyMs}ms` : '';
    const age = health ? formatHealthAge(health.checkedAt) : '';
    const title = health ? `${health.ok ? 'Healthy' : 'Unreachable'}${latency} — ${age}` : 'Not tested';
    return `<span class="${cls}" title="${escapeHtml(title)}">${dot} <strong>${escapeHtml(s.id)}</strong> ${escapeHtml(label)}</span>`;
  }).join('') || '<span class="meta">No provider data.</span>';

  const ids = snapshot.providers || [];
  const curP = psel.value;
  psel.innerHTML = ids.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if (!state.dirty.providersForm) {
    psel.value = ids.includes(curP) ? curP : (snapshot.defaultProvider || ids[0] || '');
    const pid = psel.value;
    const urls = snapshot.providerBaseUrls || {};
    const models = snapshot.providerSavedModels || {};
    if (els.panelBaseUrl) els.panelBaseUrl.value = urls[pid] || '';
    if (els.panelModelInput) els.panelModelInput.value = models[pid] || '';
  } else {
    psel.value = ids.includes(curP) ? curP : (snapshot.defaultProvider || ids[0] || '');
  }

  const pid = psel.value;
  const { merged, sourceLabel, hint, at, catalogTotal, pickerShortlistLen } = syncProviderAwareModelPicker({
    snapshot,
    providerId: pid,
    inputEl: els.panelModelInput,
    buttonEl: els.btnPanelModelCatalog,
    popoverEl: els.panelModelCatalogPopover,
    listEl: els.panelModelCatalogUl,
    emptyEl: els.panelModelCatalogEmpty,
    mergeModelLists,
    fillProviderModelCatalogList
  });
  const srcEl = document.getElementById('panelModelSourceLine');
  if (srcEl) {
    const time = at ? ` @ ${new Date(at).toLocaleTimeString()}` : '';
    const countHint =
      catalogTotal > 0 && pickerShortlistLen > 0
        ? `${catalogTotal} fetched, ${pickerShortlistLen} latest-first in picker (${merged.length} options with presets)`
        : merged.length
          ? `${merged.length} option(s)`
          : 'no catalog entries yet — use Refresh models';
    srcEl.textContent = hint
      ? `Models: ${sourceLabel} — ${countHint} — ${hint}`
      : `Models: ${sourceLabel} — ${countHint}${time}`;
  }

  const conn = snapshot.lastProviderTest;
  if (els.panelConnectionResult) {
    if (conn) {
      const latencyStr = conn.latencyMs != null ? ` (${conn.latencyMs}ms)` : '';
      els.panelConnectionResult.innerHTML = `<div class="meta"><strong>${escapeHtml(conn.providerId)}</strong> @ ${new Date(conn.at).toLocaleString()} — ${conn.ok ? 'OK' : 'failed'}${latencyStr}</div><div>${escapeHtml(conn.message)}</div>`;
    } else {
      els.panelConnectionResult.innerHTML = '<div class="meta">Run Test connection to see results here.</div>';
    }
  }
  updateProvidersDirtyBadge();
}

function renderSettings(snapshot, opts = {}) {
  const sig = settingsPanelSig(snapshot);
  if (!withSig("lastSettingsPanelSig", sig, opts.force)) return;
  const s = snapshot.settings;
  const coherentModel =
    (snapshot.providerSavedModels && snapshot.providerSavedModels[s.defaultProvider]) ||
    snapshot.resolvedDefaultModel ||
    s.defaultModel ||
    '';
  els.settingsPanel.innerHTML = `
    <div class="setting-row"><span>Default provider</span><strong>${escapeHtml(s.defaultProvider)}</strong></div>
    <div class="setting-row"><span>Default model (saved)</span><strong>${escapeHtml(s.defaultModel)}</strong></div>
    <div class="setting-row"><span>Effective for provider</span><strong>${escapeHtml(snapshot.resolvedDefaultModel || '')}</strong></div>
    <div class="setting-row"><span>Heartbeat seconds</span><strong>${escapeHtml(String(s.heartbeatSeconds))}</strong></div>
    <div class="setting-row"><span>Allow terminal</span><strong>${s.allowTerminal ? 'yes' : 'no'}</strong></div>
    <div class="setting-row"><span>Require write approval</span><strong>${s.requireWriteApproval ? 'yes' : 'no'}</strong></div>
    <div class="setting-row"><span>Auto reveal on activation</span><strong>${s.autoRevealOnActivation ? 'yes' : 'no'}</strong></div>
    <div class="setting-row"><span>Default tab</span><strong>${escapeHtml(s.defaultTab)}</strong></div>`;

  const providerSelect = document.getElementById('settingDefaultProvider');
  if (providerSelect) {
    const seen = new Set(Array.from(providerSelect.options).map(o => o.value));
    snapshot.providers.forEach(p => {
      if (!seen.has(p)) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        providerSelect.appendChild(opt);
        seen.add(p);
      }
    });
    if (!state.dirty.quickSettings) {
      providerSelect.value = s.defaultProvider;
    }
  }
  const modelInput = document.getElementById('settingDefaultModel');
  const modelBtn = document.getElementById('btnSettingDefaultModelCatalog');
  const modelPop = document.getElementById('settingDefaultModelCatalogPopover');
  const modelEmpty = document.getElementById('settingDefaultModelCatalogEmpty');
  const modelList = document.getElementById('settingDefaultModelCatalogUl');
  const heartbeatInput = document.getElementById('settingHeartbeatSeconds');
  const allowTerminal = document.getElementById('settingAllowTerminal');
  const requireWrite = document.getElementById('settingRequireWriteApproval');
  const autoReveal = document.getElementById('settingAutoRevealOnActivation');
  const defaultTab = document.getElementById('settingDefaultTab');
  if (!state.dirty.quickSettings) {
    if (modelInput) modelInput.value = coherentModel;
    if (heartbeatInput) heartbeatInput.value = String(s.heartbeatSeconds || 8);
    if (allowTerminal) allowTerminal.checked = !!s.allowTerminal;
    if (requireWrite) requireWrite.checked = !!s.requireWriteApproval;
    if (autoReveal) autoReveal.checked = !!s.autoRevealOnActivation;
    if (defaultTab) defaultTab.value = s.defaultTab || 'chat';
  }
  if (modelInput) modelInput.placeholder = 'Per-provider default when clean';
  syncProviderAwareModelPicker({
    snapshot,
    providerId: providerSelect?.value || s.defaultProvider,
    inputEl: modelInput,
    buttonEl: modelBtn,
    popoverEl: modelPop,
    listEl: modelList,
    emptyEl: modelEmpty,
    mergeModelLists,
    fillProviderModelCatalogList
  });
  updateQuickDirtyBadge();
}
  return {
    selectedApproval,
    selectedBundle,
    renderChat,
    routingDraftFromMission,
    syncRoutingDraftFromSnapshot,
    renderRouting,
    renderHunkTabs,
    renderApprovals,
    renderBundles,
    renderTimeline,
    renderAgents,
    renderMemory,
    renderConsole,
    mcpOnboardingStatusLabel,
    renderTools,
    syncChatProviderRow,
    updateQuickDirtyBadge,
    updateProvidersDirtyBadge,
    renderProvidersPanel,
    renderSettings
  };
}