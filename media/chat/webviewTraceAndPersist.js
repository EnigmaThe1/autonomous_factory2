/** @param {ReturnType<typeof acquireVsCodeApi>} vscode @param {() => object} getState */
export function createTraceAndPersist(vscode, getState) {
  function emitHostTrace(fields) {
    const st = getState();
    const level = fields.level || "debug";
    const category = fields.category || "ui";
    const payload = {
      level,
      category,
      event: fields.event,
      sessionId: st.traceSessionId || undefined,
      activeTab: st.activeTab,
      messageType: fields.messageType,
      ok: fields.ok,
      interactionId: fields.interactionId,
      data: fields.data
    };
    try {
      vscode.postMessage({ type: "traceEvent", payload });
    } catch (_e) {
      /* ignore */
    }
  }

  /** @param {string} event @param {Record<string, unknown>} [data] @param {'error'|'info'|'debug'|'trace'} [level] */
  function trace(event, data = {}, level = "debug") {
    emitHostTrace({ level, event, data });
  }

  function persistWebviewUiState() {
    const st = getState();
    try {
      vscode.setState({
        activeTab: st.activeTab,
        chatBuffer: st.chatBuffer,
        memorySearchResults: st.memorySearchResults,
        selectedApproval: st.selectedApproval,
        selectedBundle: st.selectedBundle,
        selectedHunkIndex: st.selectedHunkIndex,
        timelineFilterText: st.timelineFilterText,
        timelineFilterLevel: st.timelineFilterLevel,
        timelineFocusedOnly: st.timelineFocusedOnly,
        dirty: st.dirty,
        routingDraft: st.routingDraft
      });
    } catch (err) {
      console.warn("[my-ai] vscode.setState failed", err);
    }
  }

  function stopTraceAutoRefresh() {
    const st = getState();
    if (st.traceAutoRefreshTimer) {
      clearInterval(st.traceAutoRefreshTimer);
      st.traceAutoRefreshTimer = null;
    }
  }

  function startTraceAutoRefresh() {
    const st = getState();
    stopTraceAutoRefresh();
    st.traceAutoRefreshTimer = setInterval(() => {
      if (st.activeTab === "trace") {
        vscode.postMessage({ type: "requestTraceLog" });
      }
    }, 3000);
  }

  function renderTraceLogSnapshot(msg) {
    const meta = document.getElementById("traceLogMeta");
    const pre = document.getElementById("traceLogOutput");
    const lev = document.getElementById("traceLevelSelect");
    if (!pre || !meta) return;
    const st = getState();
    const entries = msg.entries || [];
    const n = entries.length;
    const total = typeof msg.totalBuffered === "number" ? msg.totalBuffered : n;
    const lastSeq = n > 0 && entries[n - 1] && typeof entries[n - 1].seq === "number" ? entries[n - 1].seq : "";
    const fp = `${total}|${msg.traceUiTruncated ? 1 : 0}|${msg.traceLevel}|${n}|${lastSeq}`;
    if (st.lastTraceLogRenderFp === fp) {
      return;
    }
    st.lastTraceLogRenderFp = fp;
    const tailHint =
      msg.traceUiTruncated && typeof msg.traceUiTailMax === "number"
        ? `Showing last ${n} of ${total} row(s) (UI tail limit ${msg.traceUiTailMax}; full buffer on host for Export).`
        : `Showing ${n} row(s) (${total} in buffer).`;
    meta.textContent = `${tailHint} Configured trace level: ${msg.traceLevel}. (New lines still respect myAi.trace.level when they are recorded.)`;
    pre.textContent = n ? entries.map((row) => JSON.stringify(row)).join("\n") : "(empty — raise level, reproduce activity, then Refresh)";
    if (lev && msg.traceLevel && ["error", "info", "debug", "trace"].includes(msg.traceLevel)) {
      lev.value = msg.traceLevel;
    }
  }

  return {
    emitHostTrace,
    trace,
    persistWebviewUiState,
    stopTraceAutoRefresh,
    startTraceAutoRefresh,
    renderTraceLogSnapshot
  };
}
