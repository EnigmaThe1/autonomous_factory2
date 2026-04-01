export function createTabController(deps) {
  const {
    vscode,
    state,
    trace,
    persistWebviewUiState,
    stopTraceAutoRefresh,
    startTraceAutoRefresh,
    renderProvidersPanel,
    renderSettings,
    renderMemory,
    renderTools,
    renderRouting,
    renderMissions,
    renderChat
  } = deps;

  function setActiveTab(tab) {
    const prev = state.activeTab;
    state.activeTab = tab;
    document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
    document.querySelectorAll(".pane").forEach((el) => el.classList.toggle("active", el.dataset.pane === tab));
    stopTraceAutoRefresh();
    if (tab === "trace") {
      vscode.postMessage({ type: "requestTraceLog" });
      const ar = document.getElementById("traceAutoRefresh");
      if (ar && ar.checked) startTraceAutoRefresh();
    }
    persistWebviewUiState();
    if (state.snapshot) {
      if (tab === "providers") renderProvidersPanel(state.snapshot, { force: true });
      else if (tab === "settings") renderSettings(state.snapshot, { force: true });
      else if (tab === "memory") renderMemory(state.snapshot, { force: true });
      else if (tab === "tools") renderTools(state.snapshot, { force: true });
      else if (tab === "routing") renderRouting(state.snapshot, { force: true });
      else if (tab === "missions") renderMissions(state.snapshot, undefined, { force: true });
      else if (tab === "chat") renderChat(state.snapshot, { force: true });
    }
    trace("set_active_tab", { prev, next: tab }, "debug");
  }

  return { setActiveTab };
}
