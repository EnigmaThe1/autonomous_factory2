import { missionsListPanelSig, missionInspectorSig, missionReportInspectorCacheSig } from "./webviewSignatures.js";
import {
  formatMissionCompletionReason,
  formatNonTerminalMissionNotesHtml,
  formatWorkItemCompletionKind
} from "./missionCompletionLabels.js";
import { formatMissionEventRowHtml } from "./missionEventLabels.js";
import {
  computeQueueProgressStats,
  formatInspectorQueueProgressHtml,
  formatMissionCardQueueProgressHtml
} from "./missionQueueProgressSummary.js";
import {
  describeMissionCurrentNext,
  formatInspectorCurrentNextHtml,
  formatMissionCardCurrentNextHtml
} from "./missionQueueCurrentNext.js";
import { formatMissionStatusBadgeLabel, getMissionResumeUiState } from "./missionStatusPresentation.js";
import {
  composeMissionsForMissionList,
  focusedMissionHiddenFromComposedList,
  getMissionQuickFilterLabel,
  MISSION_QUICK_FILTER_OPTIONS,
  normalizeMissionQuickFilter
} from "./missionQuickFilters.js";
import { computeVisibleBulkMissionCandidates } from "./missionBulkVisibleCandidates.js";
import { formatMissionProgressStatsLineHtml } from "./missionProgressDashboard.js";

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {object} deps.sigCache
 * @param {Function} deps.emitHostTrace
 * @param {Function} deps.trace
 * @param {Function} deps.escapeHtml
 * @param {Function} deps.relTime
 * @param {Function} deps.mdToHtml
 * @param {Function} deps.htmlSig
 */
export function createMissionRenderer(deps) {
  const { state, sigCache, emitHostTrace, trace, escapeHtml, relTime, mdToHtml, htmlSig } = deps;

  function renderMissions(snapshot, interactionId, opts = {}) {
    const pub = snapshot?.snapshotPublishSeq;
    const missionCountArg = snapshot?.missions?.length ?? 0;
    const qf = normalizeMissionQuickFilter(state.missionQuickFilter);
    trace(
      "render_missions_start",
      {
        missionCount: missionCountArg,
        includeArchived: !!snapshot?.missionList?.includeArchived,
        missionQuickFilter: qf,
        snapshotPublishSeq: pub,
        activeTab: state.activeTab
      },
      "debug"
    );
    const missionsEl = document.getElementById("missions");
    const inspectorEl = document.getElementById("missionInspector");
    if (!missionsEl || !inspectorEl) {
      trace("render_missions_missing_dom", { hasMissionsEl: !!missionsEl, hasInspectorEl: !!inspectorEl });
      return;
    }

    const displayMissions = composeMissionsForMissionList(snapshot.missions || [], qf);
    const bulkVis = computeVisibleBulkMissionCandidates(displayMissions);
    state.visibleBulkCandidates = {
      archiveCompletedIds: bulkVis.archiveCompletedIds,
      deleteFailedOrCancelledIds: bulkVis.deleteFailedOrCancelledIds,
      deleteBlockedIds: bulkVis.deleteBlockedIds,
      counts: bulkVis.counts
    };

    const listSig = missionsListPanelSig(snapshot, qf, displayMissions);
    const skipList = !opts.force && listSig === sigCache.lastMissionsListSig;
    const reportCacheSig = missionReportInspectorCacheSig(snapshot.focusedMissionId, state.missionReportCache);
    const insSig = missionInspectorSig(snapshot, qf, displayMissions, reportCacheSig);
    const skipInspector = !opts.force && insSig === sigCache.lastMissionInspectorSig;
    const focusedResumeBtn = document.getElementById("resumeFocusedMission");
    const focusedResumeUi = getMissionResumeUiState(snapshot.focusedMission);
    if (focusedResumeBtn) {
      focusedResumeBtn.textContent = snapshot.focusedMission ? `${focusedResumeUi.label} focused` : "Resume focused";
      focusedResumeBtn.disabled = !focusedResumeUi.enabled;
      focusedResumeBtn.title = focusedResumeUi.title;
    }

    let beforeSig = null;
    let afterSig = null;
    let missionCardRows = 0;
    if (!skipList) {
      sigCache.lastMissionsListSig = listSig;
      const beforeChildren = missionsEl.childElementCount;
      beforeSig = htmlSig(missionsEl.innerHTML);

      const focused = snapshot.focusedMissionId;
      const rwHint = snapshot.focusedMissionRequiredWorkHint;
      const dgHint = snapshot.focusedMissionDownstreamGatingHint;
      const dqHint = snapshot.focusedMissionHardStopDataQualityHint;
      const oaNote = snapshot.focusedMissionLatestOperatorActionNote;
      const lifecycleSummary = snapshot.focusedMissionLifecycleSummary;
      const cardGateHints = snapshot.missionDownstreamGatingCardHints || {};
      const cardRwHint =
        rwHint && focused
          ? `<div class="meta mission-required-work-hint">${escapeHtml(rwHint)}</div>`
          : "";
      const cardDgHint =
        dgHint && focused
          ? `<div class="meta mission-downstream-gating-hint">${escapeHtml(dgHint)}</div>`
          : "";
      const cardDqHint =
        dqHint && focused
          ? `<div class="meta mission-hard-stop-data-quality-hint">${escapeHtml(dqHint)}</div>`
          : "";
      const cardOaNote =
        oaNote && focused
          ? `<div class="meta mission-operator-action-note">${escapeHtml(oaNote)}</div>`
          : "";
      const cardLifecycle =
        lifecycleSummary && focused
          ? `<div class="mission-lifecycle-summary" role="status">${escapeHtml(lifecycleSummary)}</div>`
          : "";
      const cardProgress = (m) => formatMissionCardQueueProgressHtml(computeQueueProgressStats(m.queue), escapeHtml);
      const cardCurrentNext = (m) => formatMissionCardCurrentNextHtml(describeMissionCurrentNext(m.queue), escapeHtml);
      const cardMps = (m) => formatMissionProgressStatsLineHtml(snapshot.missionProgressStats?.[m.id], escapeHtml);
      const cardResumeButton = (m) => {
        const ui = getMissionResumeUiState(m);
        const disabled = ui.enabled ? "" : " disabled";
        return `<button data-action="resumeMission" data-mission-id="${m.id}" class="ghost"${disabled} title="${escapeHtml(ui.title)}">${escapeHtml(ui.label)}</button>`;
      };
      const cardGateHint = (m) =>
        cardGateHints && typeof cardGateHints[m.id] === "string" && cardGateHints[m.id].length
          ? `<div class="meta mission-downstream-gating-card-hint">${escapeHtml(cardGateHints[m.id])}</div>`
          : "";
      const oaHeadlinesByMission = snapshot.missionListLatestOperatorActionHeadlines || {};
      const cardNonFocusedLatestOa = (m) => {
        if (m.id === focused) return "";
        const h = oaHeadlinesByMission[m.id];
        if (!h) return "";
        return `<div class="meta mission-card-latest-operator-action" role="status"><span class="mission-card-latest-operator-action-label">Latest action:</span> ${escapeHtml(h)}</div>`;
      };
      const filterBar = `<div class="tabs mission-quick-filters" role="toolbar" aria-label="Mission quick filters">${MISSION_QUICK_FILTER_OPTIONS.map(
        (o) =>
          `<button type="button" class="tab${qf === o.id ? " active" : ""}" data-action="setMissionQuickFilter" data-mission-quick-filter="${escapeHtml(o.id)}">${escapeHtml(o.label)}</button>`
      ).join("")}</div>`;
      const { counts: bc } = bulkVis;
      const bulkDisabled = (n) => (n > 0 ? "" : " disabled");
      const visibleBulkRow = `<div class="row compact wrap" style="margin-bottom:8px;">
      <button type="button" class="ghost"${bulkDisabled(bc.archiveCompleted)} data-action="bulkArchiveVisibleCompletedMissions">Archive visible completed (${bc.archiveCompleted})</button>
      <button type="button" class="ghost"${bulkDisabled(bc.deleteFailedOrCancelled)} data-action="bulkDeleteVisibleFailedOrCancelledMissions">Delete visible failed/cancelled (${bc.deleteFailedOrCancelled})</button>
      <button type="button" class="ghost"${bulkDisabled(bc.deleteBlocked)} data-action="bulkDeleteVisibleBlockedMissions">Delete visible blocked (${bc.deleteBlocked})</button>
    </div>`;
      const missionTools = `
    ${filterBar}
    ${visibleBulkRow}
    <div class="row compact wrap" style="margin-bottom:10px;">
      <label class="toggle inline-toggle"><input data-action="toggleIncludeArchived" type="checkbox" ${snapshot.missionList?.includeArchived ? "checked" : ""} /><span>Show archived</span></label>
      <button data-action="bulkArchiveCompletedMissions" class="ghost">Archive completed</button>
      <button data-action="bulkDeleteFailedTestMissions" class="ghost">Delete failed tests</button>
      <button data-action="bulkDeleteBlockedTestMissions" class="ghost">Delete blocked tests</button>
      <span class="meta">total ${snapshot.missionList?.totalCount ?? snapshot.missions.length} • archived ${snapshot.missionList?.archivedCount ?? 0}</span>
    </div>`;
      missionsEl.innerHTML =
        missionTools +
        (displayMissions
          .map(
            (m) => `
    <div class="mission-card ${m.id === focused ? "focused" : ""}">
      <div class="row split"><strong>${escapeHtml(m.title)}</strong><span class="badge ${m.status}">${escapeHtml(formatMissionStatusBadgeLabel(m))}</span></div>
      ${m.id === focused ? cardLifecycle : ""}
      ${cardNonFocusedLatestOa(m)}
      ${cardGateHint(m)}
      <div class="meta">${escapeHtml(m.routing?.preset || "default")} • ${escapeHtml(m.policy?.policyPreset || "custom")} • step ${m.currentStep}${m.archivedAt ? " • archived" : ""}</div>
      <div class="meta">queue ${m.queue.length} • approvals ${m.approvals.filter((a) => a.status === "pending").length} • checkpoints ${m.checkpoints.length}</div>
      ${cardProgress(m)}
      ${cardCurrentNext(m)}
      ${cardMps(m)}
      ${m.id === focused ? cardRwHint : ""}
      ${m.id === focused ? cardDqHint : ""}
      ${m.id === focused ? cardDgHint : ""}
      ${m.id === focused ? cardOaNote : ""}
      ${
        m.status === "completed" && m.completionReason
          ? `<div class="meta mission-completion-note">${escapeHtml(formatMissionCompletionReason(m.completionReason))}</div>`
          : formatNonTerminalMissionNotesHtml(m, escapeHtml)
      }
      <div class="row compact wrap">
        <button data-action="focusMission" data-mission-id="${m.id}">Focus</button>
        ${cardResumeButton(m)}
        ${m.status === "running" ? `<button data-action="abortMissionLlm" data-mission-id="${m.id}" class="danger-ghost" title="Stop the running LLM stream for this mission">Stop</button>` : ""}
        <button data-action="editMissionPolicy" data-mission-id="${m.id}" class="ghost">Policy</button>
        <button data-action="openRoutingTab" data-mission-id="${m.id}" class="ghost">Routing</button>
        <button data-action="editMissionDag" data-mission-id="${m.id}" class="ghost">DAG</button>
        <button data-action="generateMissionReport" data-mission-id="${m.id}" class="ghost" title="Build markdown report in inspector">Report</button>
        ${
          m.archivedAt
            ? `<button data-action="unarchiveMission" data-mission-id="${m.id}" class="ghost">Unarchive</button>`
            : `<button data-action="archiveMission" data-mission-id="${m.id}" class="ghost">Archive</button>`
        }
        <button data-action="deleteMission" data-mission-id="${m.id}" class="ghost">Delete</button>
      </div>
    </div>`
          )
          .join("") || '<div class="empty">No missions yet.</div>');
      void missionsEl.offsetHeight;
      const afterChildren = missionsEl.childElementCount;
      afterSig = htmlSig(missionsEl.innerHTML);
      const pane = document.querySelector('.pane[data-pane="missions"]');
      const isVisible = !!(pane && pane.classList.contains("active"));
      missionCardRows = missionsEl.querySelectorAll(".mission-card").length;
      emitHostTrace({
        level: "debug",
        event: "render_missions_dom_update",
        interactionId,
        data: {
          snapshotPublishSeq: pub,
          missionsListSkipped: false,
          missionsInspectorSkipped: skipInspector,
          beforeChildren,
          afterChildren,
          missionCardRows,
          beforeSig,
          afterSig,
          changed: beforeSig !== afterSig,
          visible: isVisible,
          wasSameAsLastSig: sigCache.lastMissionsHtmlSig === afterSig,
          missionCountFromSnapshot: snapshot.missions?.length ?? 0,
          missionQuickFilter: qf,
          missionListDisplayedRows: displayMissions.length,
          includeArchived: !!snapshot.missionList?.includeArchived,
          activeTab: state.activeTab,
          signatureUnchanged: beforeSig === afterSig,
          rowCountMismatch: missionCardRows !== displayMissions.length ? true : undefined
        }
      });
      sigCache.lastMissionsHtmlSig = afterSig;
    }

    if (!skipInspector) {
      sigCache.lastMissionInspectorSig = insSig;
      const m = snapshot.focusedMission;
      if (!m) {
        inspectorEl.innerHTML = '<div class="empty">Focus a mission to inspect queue, runtime, checkpoints, and recent events.</div>';
      } else {
        const queue =
          m.queue
            .map(
              (work) =>
                `<div class="work-item ${work.status}"><div class="row split"><strong>${escapeHtml(work.title)}</strong><span class="badge ${work.status}">${escapeHtml(work.status)}</span></div><div class="meta">${escapeHtml(work.role)}${
                  work.completionKind ? ` • ${escapeHtml(formatWorkItemCompletionKind(work.completionKind))}` : ""
                }${work.dependsOn?.length ? ` • depends on ${work.dependsOn.length}` : ""}</div>${work.output ? `<div class="small-pre">${escapeHtml(String(work.output).slice(0, 280))}</div>` : ""}</div>`
            )
            .join("") || '<div class="empty">No work items.</div>';
        const checkpoints =
          (m.checkpoints || [])
            .slice(-4)
            .reverse()
            .map(
              (cp) =>
                `<div class="checkpoint-item"><div class="row split"><strong>Step ${cp.step}</strong><span class="meta">${new Date(cp.ts).toLocaleString()}</span></div><div>${escapeHtml(cp.summary)}</div></div>`
            )
            .join("") || '<div class="empty">No checkpoints yet.</div>';
        const oaHeadlines = snapshot.focusedMissionOperatorActionHeadlines;
        const events =
          (m.events || [])
            .slice(-8)
            .reverse()
            .map(
              (ev) =>
                `<div class="timeline-item level-${ev.level}"><span class="meta">${new Date(ev.ts).toLocaleTimeString()} • ${escapeHtml(ev.source)}</span>${formatMissionEventRowHtml(ev, oaHeadlines, escapeHtml)}</div>`
            )
            .join("") || '<div class="empty">No recent events.</div>';
        const rt = m.runtime || { stalledHeartbeats: 0, autoReplans: 0, loopGuardTrips: 0 };
        const queueProgressInspector = formatInspectorQueueProgressHtml(computeQueueProgressStats(m.queue), escapeHtml);
        const currentNextInspector = formatInspectorCurrentNextHtml(describeMissionCurrentNext(m.queue), escapeHtml);
        const inspectorMps = formatMissionProgressStatsLineHtml(snapshot.missionProgressStats?.[m.id], escapeHtml);
        const frs = snapshot.focusedMissionReportSummary;
        const reportSummaryHtml =
          frs && typeof frs === "object"
            ? `<div class="mission-report-summary-bar meta" style="margin:8px 0;padding:8px 10px;border-radius:8px;border:1px solid var(--vscode-widget-border, rgba(255,255,255,.12));background:var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,.12));"><div class="section-title small" style="margin-bottom:4px;">Report snapshot</div>${frs.completionPercent}% complete • ${frs.filesModifiedCount} file(s) touched • ${frs.errorPatternCount} error pattern(s) • ${frs.retriedItems} retried item(s)</div>`
            : "";
        const cache = state.missionReportCache;
        const hasPreview = !!(cache && cache.missionId === m.id && cache.markdown && cache.markdown.length > 0);
        const reportActions = `<div class="row compact wrap" style="margin:8px 0;"><button type="button" class="ghost" data-action="generateMissionReport" data-mission-id="${m.id}">${hasPreview ? "Regenerate report" : "Generate report"}</button>${
          hasPreview
            ? `<button type="button" class="ghost" data-action="copyMissionReport" data-mission-id="${m.id}" title="Copy markdown to clipboard">Copy report</button>`
            : ""
        }</div>`;
        const reportPreviewHtml = hasPreview
          ? `<details class="mission-report-preview" style="margin-bottom:12px;"><summary>Markdown report preview</summary><pre class="small-pre" style="max-height:280px;overflow:auto;white-space:pre-wrap;word-break:break-word;">${escapeHtml(String(cache.markdown).slice(0, 16000))}</pre></details>`
          : "";
        const filterLabel = getMissionQuickFilterLabel(qf);
        const focusHiddenFromList = focusedMissionHiddenFromComposedList(m, displayMissions);
        const filterHintHtml = focusHiddenFromList
          ? `<div class="meta mission-inspector-filter-hint" style="margin-bottom:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--vscode-widget-border, rgba(255,255,255,.12));background:var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,.15));">${
              qf === "all"
                ? `${escapeHtml("Focused mission is not shown in the current mission list.")} <span class="meta">${escapeHtml(`Current quick filter: ${filterLabel}.`)}</span>`
                : `${escapeHtml("Focused mission is hidden by the current quick filter.")} <span class="meta">${escapeHtml(`Filter: ${filterLabel}.`)}</span> ${escapeHtml("Change the filter (for example to All) to see this mission in the list beside the inspector.")}`
            }</div>`
          : "";
        const inspectorRwHint = snapshot.focusedMissionRequiredWorkHint
          ? `<div class="meta mission-required-work-hint" style="margin:8px 0;">${escapeHtml(snapshot.focusedMissionRequiredWorkHint)}</div>`
          : "";
        const inspectorDqHint = snapshot.focusedMissionHardStopDataQualityHint
          ? `<div class="meta mission-hard-stop-data-quality-hint" style="margin:8px 0;">${escapeHtml(snapshot.focusedMissionHardStopDataQualityHint)}</div>`
          : "";
        const inspectorDgHint = snapshot.focusedMissionDownstreamGatingHint
          ? `<div class="meta mission-downstream-gating-hint" style="margin:8px 0;">${escapeHtml(snapshot.focusedMissionDownstreamGatingHint)}</div>`
          : "";
        const inspectorOaNote = snapshot.focusedMissionLatestOperatorActionNote
          ? `<div class="meta mission-operator-action-note" style="margin:8px 0;">${escapeHtml(snapshot.focusedMissionLatestOperatorActionNote)}</div>`
          : "";
        const inspectorLifecycle = snapshot.focusedMissionLifecycleSummary
          ? `<div class="mission-lifecycle-summary" role="status">${escapeHtml(snapshot.focusedMissionLifecycleSummary)}</div>`
          : "";
        const bpProg = snapshot.focusedMissionBlueprintProgress;
        const preBpQs = m.preBlueprintClarification?.questions;
        const inspectorPreBlueprint =
          m.blockReasonCode === "awaiting_pre_blueprint_answers" && preBpQs && preBpQs.length
            ? `<div class="inspector-section"><div class="section-title small">Pre-blueprint clarification</div>
      <ol style="margin:8px 0;padding-left:1.25rem;">${preBpQs
              .map((q) => `<li style="margin:4px 0;">${escapeHtml(q)}</li>`)
              .join("")}</ol>
      <label class="meta" for="preBlueprintAnswersField">Your answers</label>
      <textarea id="preBlueprintAnswersField" rows="7" style="width:100%;box-sizing:border-box;margin:6px 0;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);" placeholder="Answer the questions above (free form, multi-line OK)."></textarea>
      <div class="row" style="margin-top:6px;"><button type="button" class="ghost" data-action="submitPreBlueprintAnswers" data-mission-id="${escapeHtml(
              m.id
            )}">Submit answers — generate blueprint</button></div>
    </div>`
            : "";
        const inspectorBlueprint = m.blueprint
          ? `<div class="inspector-section"><div class="section-title small">Mission blueprint</div>
      <div class="meta">Status: ${escapeHtml(m.blueprint.status)}${
              bpProg && m.blueprint.status === "approved"
                ? ` • Steps ${bpProg.done}/${bpProg.total} (${bpProg.percent}%)`
                : ""
            }</div>${
              m.blueprint.status === "awaiting_approval"
                ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px;">
              <button type="button" class="ghost" data-action="approveMissionBlueprint" data-mission-id="${escapeHtml(m.id)}">Approve blueprint</button>
              <button type="button" class="ghost" data-action="rejectMissionBlueprint" data-mission-id="${escapeHtml(m.id)}">Reject</button>
              <button type="button" class="ghost" data-action="requestMissionBlueprintRevision" data-mission-id="${escapeHtml(m.id)}">Request revision…</button>
            </div>`
                : ""
            }
      <details style="margin-top:8px;"><summary>Requirements / architecture</summary>
        <pre class="small-pre" style="max-height:200px;overflow:auto;white-space:pre-wrap;">${escapeHtml(
              (m.blueprint.requirementsSummary + "\n\n" + m.blueprint.architectureSummary).slice(0, 8000)
            )}</pre>
      </details>
    </div>`
          : "";
        inspectorEl.innerHTML = `
    <div class="detail-block mission-inspector-block">
      ${filterHintHtml}
      <div class="row split"><strong>${escapeHtml(m.title)}</strong><span class="badge ${m.status}">${escapeHtml(formatMissionStatusBadgeLabel(m))}</span></div>
      ${inspectorLifecycle}
      ${
        m.status === "completed" && m.completionReason
          ? `<div class="meta mission-completion-note">${escapeHtml(formatMissionCompletionReason(m.completionReason))}</div>`
          : formatNonTerminalMissionNotesHtml(m, escapeHtml)
      }
      ${inspectorRwHint}
      ${inspectorDqHint}
      ${inspectorDgHint}
      ${inspectorOaNote}
      <div class="meta">provider ${escapeHtml(m.activeProviderId)} • model ${escapeHtml(m.activeModel || snapshot.defaultModel)}</div>
      <div class="mini-stats">
        <div class="mini-stat"><span class="meta">Queue</span><strong>${m.queue.length}</strong></div>
        <div class="mini-stat"><span class="meta">Pending approvals</span><strong>${m.approvals.filter((a) => a.status === "pending").length}</strong></div>
        <div class="mini-stat"><span class="meta">Memory</span><strong>${m.memory.length}</strong></div>
        <div class="mini-stat"><span class="meta">Replans</span><strong>${rt.autoReplans || 0}</strong></div>
      </div>
      ${queueProgressInspector}
      ${currentNextInspector}
      ${inspectorMps}
      ${inspectorPreBlueprint}
      ${inspectorBlueprint}
      ${reportSummaryHtml}
      ${reportActions}
      ${reportPreviewHtml}
      <div class="inspector-section"><div class="section-title small">Runtime</div><div class="meta-block"><div class="meta">last progress: ${rt.lastProgressAt ? new Date(rt.lastProgressAt).toLocaleString() : "n/a"} (${relTime(rt.lastProgressAt)})</div><div class="meta">last heartbeat: ${rt.lastRunnerHeartbeatAt ? new Date(rt.lastRunnerHeartbeatAt).toLocaleString() : "n/a"} (${relTime(rt.lastRunnerHeartbeatAt)})</div><div class="meta">stalled heartbeats: ${rt.stalledHeartbeats || 0}</div><div class="meta">loop guard trips: ${rt.loopGuardTrips || 0}</div><div class="meta">validation: ${escapeHtml(m.validationState || "pending")}</div></div></div>
      <div class="inspector-section"><div class="section-title small">Work queue</div>${queue}</div>
      <div class="inspector-section"><div class="section-title small">Recent checkpoints</div>${checkpoints}</div>
      <div class="inspector-section"><div class="section-title small">Recent mission events</div>${events}</div>
    </div>`;
      }
    }

    if (skipList) {
      const pane = document.querySelector('.pane[data-pane="missions"]');
      emitHostTrace({
        level: "debug",
        event: "render_missions_dom_update",
        interactionId,
        data: {
          snapshotPublishSeq: pub,
          missionsListSkipped: true,
          missionsInspectorSkipped: skipInspector,
          visible: !!(pane && pane.classList.contains("active")),
          missionCountFromSnapshot: snapshot.missions?.length ?? 0,
          missionQuickFilter: qf,
          activeTab: state.activeTab
        }
      });
    }
  }

  return { renderMissions };
}
