import { trimSidebarChatBuffer } from "./webviewChatBuffer.js";

export function createMessageHandler(deps) {
  const {
    state,
    els,
    emitHostTrace,
    renderTraceLogSnapshot,
    applyMissionSectionSnapshot,
    applyAuxiliarySectionSnapshot,
    applyProviderChromeSectionSnapshot,
    applyGlobalMemorySectionSnapshot,
    renderSnapshot,
    renderChat,
    renderMemory,
    renderMissions,
    updateQuickDirtyBadge,
    updateProvidersDirtyBadge,
    setActiveTab
  } = deps;

  const sectionHandlers = {
    missions:       { seqKey: "lastAppliedMissionsSectionSeq",        apply: applyMissionSectionSnapshot },
    auxiliary:      { seqKey: "lastAppliedAuxiliarySectionSeq",       apply: applyAuxiliarySectionSnapshot },
    providerChrome: { seqKey: "lastAppliedProviderChromeSectionSeq",  apply: applyProviderChromeSectionSnapshot },
    globalMemory:   { seqKey: "lastAppliedGlobalMemorySectionSeq",    apply: applyGlobalMemorySectionSnapshot }
  };

  function handleSnapshotSection(msg) {
    const curPub = state.lastSnapshotPublishSeq;
    const base = msg.sectionBasePublishSeq;
    const baseOk =
      (curPub == null && base === 0) || (typeof curPub === "number" && typeof base === "number" && curPub === base);
    const seq = msg.sectionSeq;
    const handler = sectionHandlers[msg.section];
    if (!handler) return;

    const prevSeq = state[handler.seqKey];
    const seqOk = typeof seq === "number" && seq > prevSeq;
    if (!baseOk || !seqOk) {
      emitHostTrace({
        level: "info",
        category: "ui",
        event: "snapshot_section_ignored_stale",
        interactionId: msg.traceContext?.interactionId,
        data: {
          section: msg.section,
          sectionSeq: seq,
          sectionBasePublishSeq: base,
          lastSnapshotPublishSeq: curPub,
          [`${handler.seqKey}`]: prevSeq,
          baseOk,
          seqOk
        }
      });
      return;
    }
    state[handler.seqKey] = seq;
    handler.apply(msg.snapshot, msg.traceContext);
  }

  return function onWindowMessage(event) {
    const msg = event.data;
    emitHostTrace({
      level: "info",
      event: "ui_receive_message",
      messageType: msg?.type,
      interactionId: msg?.traceContext?.interactionId,
      data: {
        type: msg?.type,
        snapshotPublishSeq: msg?.traceContext?.snapshotPublishSeq,
        sourceRefreshSeq: msg?.traceContext?.sourceRefreshSeq,
        activeTab: state.activeTab,
        snapshotMissions: msg?.snapshot?.missions?.length,
        snapshotIncludeArchived: msg?.snapshot?.missionList?.includeArchived
      }
    });
    if (msg.type === "init" || msg.type === "snapshot") {
      renderSnapshot(msg.snapshot, msg.traceContext);
      if (msg.type === "init") {
        setActiveTab(msg.snapshot.settings.defaultTab || "chat");
        setTimeout(() => els.chatPrompt?.focus(), 50);
      }
    } else if (msg.type === "snapshotSection") {
      handleSnapshotSection(msg);
    } else if (msg.type === "traceLogSnapshot") {
      renderTraceLogSnapshot(msg);
    } else if (msg.type === "traceExportResult") {
      const meta = document.getElementById("traceLogMeta");
      if (meta && msg.path) {
        const prefix = meta.textContent || "";
        meta.textContent = `${prefix} Last export: ${msg.path}`;
      }
    } else if (msg.type === "chatChunk") {
      state.chatBuffer = trimSidebarChatBuffer(state.chatBuffer + (msg.text || ""));
      renderChat(state.snapshot);
    } else if (msg.type === "chatDone") {
      if (state.chatBuffer.trim()) {
        state.chatHistory.pushAssistant(state.chatBuffer.trim());
      }
      state.chatBuffer = "";
      renderChat(state.snapshot);
    } else if (msg.type === "memorySearchResults") {
      state.memorySearchResults = msg.results || [];
      if (state.snapshot) renderMemory(state.snapshot);
    } else if (msg.type === "info") {
      const statusEl = document.getElementById("panelCatalogRefreshStatus");
      if (statusEl && typeof msg.message === "string") {
        if (msg.message.startsWith("Models (")) {
          statusEl.textContent = msg.message;
        }
      }
      const missionStatusEl = document.getElementById("missionActionStatus");
      if (missionStatusEl && typeof msg.message === "string") {
        const m = msg.message;
        if (
          m.startsWith("Mission ") ||
          m.startsWith("Approval ") ||
          m.startsWith("Abort ")
        ) {
          missionStatusEl.textContent = m;
        }
      }
      console.log(msg.message);
    } else if (msg.type === "error") {
      emitHostTrace({
        level: "error",
        event: "render_error",
        data: { phase: "ext_to_ui_error", message: msg.message }
      });
      state.chatBuffer = trimSidebarChatBuffer(`${state.chatBuffer}\n\nError: ${msg.message}`);
      renderChat(state.snapshot);
    } else if (msg.type === "providerKeyCleared") {
      const inp = document.getElementById("panelApiKey");
      if (inp && msg.providerId && (!els.panelProviderSelect || els.panelProviderSelect.value === msg.providerId)) inp.value = "";
    } else if (msg.type === "formCommitted") {
      if (msg.scope === "quickSettings") state.dirty.quickSettings = false;
      if (msg.scope === "providersPanel") state.dirty.providersForm = false;
      if (msg.scope === "routingPanel") state.dirty.routingPanel = false;
      updateQuickDirtyBadge();
      updateProvidersDirtyBadge();
    } else if (msg.type === "agentStreamChunk") {
      if (!state.agentStream) state.agentStream = { missionId: msg.missionId, workItemId: msg.workItemId, role: msg.role, text: "" };
      if (state.agentStream.workItemId === msg.workItemId) {
        state.agentStream.text += msg.text;
      }
      renderChat(state.snapshot);
    } else if (msg.type === "agentStreamDone") {
      if (state.agentStream?.workItemId === msg.workItemId) {
        state.agentStream = null;
      }
      renderChat(state.snapshot);
    } else if (msg.type === "missionReportReady") {
      const mid = msg.missionId;
      const md = typeof msg.markdown === "string" ? msg.markdown : "";
      if (mid) {
        state.missionReportCache = { missionId: mid, markdown: md };
      }
      const missionStatusEl = globalThis.document?.getElementById?.("missionActionStatus");
      if (missionStatusEl) {
        missionStatusEl.textContent = mid ? "Mission report ready — see inspector preview." : "";
      }
      if (state.snapshot) {
        renderMissions(state.snapshot, msg.traceContext?.interactionId, { force: true });
      }
    }
  };
}
