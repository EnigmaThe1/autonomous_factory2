import * as vscode from "vscode";

/** Native `<select>` / UA widget popups follow `color-scheme`; align with VS Code's active theme. */
function webviewColorScheme(): "dark" | "light" {
  const k = vscode.window.activeColorTheme.kind;
  if (k === vscode.ColorThemeKind.Light || k === vscode.ColorThemeKind.HighContrastLight) {
    return "light";
  }
  return "dark";
}

/** Webview bootstrap HTML for the My AI sidebar (CSP, shell markup, script/style URIs). */
export function buildAiSidebarWebviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "chat", "main.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "chat", "styles.css"));
  const nonce = String(Date.now());
  const colorScheme = webviewColorScheme();
  return `<!DOCTYPE html>
<html lang="en" style="color-scheme: ${colorScheme};">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>My AI V18</title>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div>
        <div class="brand">My AI V18</div>
        <div class="sub">Unified sidebar • providers • chat • missions • per-agent routing • approvals • tools • memory • settings</div>
      </div>
      <button id="refreshDashboard" class="ghost">Refresh</button>
    </header>

    <section class="summary-grid">
      <div class="summary-card"><div class="label">Provider</div><div id="summaryProvider" class="value">-</div></div>
      <div class="summary-card"><div class="label">Model</div><div id="summaryModel" class="value">-</div></div>
      <div class="summary-card"><div class="label">Missions</div><div id="summaryMissions" class="value">0</div></div>
      <div class="summary-card"><div class="label">Pending approvals</div><div id="summaryApprovals" class="value">0</div></div>
    </section>

    <nav class="tabs" id="tabs">
      <button class="tab active" data-tab="chat">Chat</button>
      <button class="tab" data-tab="providers">Providers</button>
      <button class="tab" data-tab="missions">Missions</button>
      <button class="tab" data-tab="routing">Routing</button>
      <button class="tab" data-tab="approvals">Approvals</button>
      <button class="tab" data-tab="bundles">Bundles</button>
      <button class="tab" data-tab="timeline">Timeline</button>
      <button class="tab" data-tab="agents">Agents</button>
      <button class="tab" data-tab="tools">Tools</button>
      <button class="tab" data-tab="memory">Memory</button>
      <button class="tab" data-tab="console">Console</button>
      <button class="tab" data-tab="trace">Trace</button>
      <button class="tab" data-tab="settings">Settings</button>
    </nav>

    <main class="panes">
      <section class="pane active" data-pane="chat">
        <div class="card">
          <div class="row split header-row">
            <div class="section-title">Start autonomous mission</div>
            <button id="startMission" class="primary-inline">Start Mission</button>
          </div>
          <input id="missionTitle" placeholder="Mission title" />
          <textarea id="missionPrompt" placeholder="Describe an autonomous mission"></textarea>
          <div class="meta" style="margin-top:8px;">Mission default provider/model come from the Chat row above. Per-role overrides live in the <strong>Routing</strong> tab after you start or focus a mission.</div>
        </div>
        <div class="card">
          <div class="row split header-row">
            <div class="section-title">Chat</div>
            <div class="row compact">
              <button id="focusChatInput" class="ghost">Focus</button>
              <button id="openProvidersFromChat" class="ghost">Providers</button>
              <button id="openSettings" class="ghost">Settings</button>
            </div>
          </div>
          <div class="chat-provider-row">
            <label class="field-inline"><span>Provider</span><select id="chatProviderSelect"></select></label>
            <label class="field-inline"><span>Model</span>
              <div class="model-picker-field" data-model-picker-scope="chatRow">
                <div class="model-input-with-trigger">
                  <input id="chatModelInput" type="text" autocomplete="off" placeholder="Per-provider default if empty" />
                  <button type="button" id="btnChatModelCatalog" class="ghost model-catalog-trigger" data-model-picker-trigger="true" aria-expanded="false" aria-controls="chatModelCatalogPopover" title="Open list of models from this provider’s catalog">Catalog ▾</button>
                </div>
                <div id="chatModelCatalogPopover" class="model-catalog-popover" data-model-picker-popover="true" hidden>
                  <div id="chatModelCatalogEmpty" class="model-catalog-empty meta" hidden>No models in catalog for this provider.</div>
                  <ul id="chatModelCatalogUl" class="model-catalog-ul" data-model-picker-list="true" role="listbox" aria-label="Chat models from provider catalog"></ul>
                </div>
              </div>
            </label>
          </div>
          <div class="row compact" style="margin-bottom:6px;">
            <button id="revertChatRow" type="button" class="ghost">Reset chat row to saved defaults</button>
          </div>
          <textarea id="chatPrompt" placeholder="Ask about the workspace, current file, or mission"></textarea>
          <div class="row split">
            <button id="sendChat">Send</button>
            <span class="meta">Ctrl/Cmd + Enter to send</span>
          </div>
          <div id="chatOutput" class="chat-output markdown-output"></div>
        </div>
      </section>

      <section class="pane" data-pane="providers">
        <div class="card">
          <div class="row split header-row">
            <div class="section-title">Providers &amp; credentials</div>
            <div class="row compact wrap">
              <span id="providersDirtyBadge" class="dirty-badge" hidden>Unsaved</span>
              <span class="meta">Keys: secure storage</span>
            </div>
          </div>
          <div id="providerCredentialSummary" class="credential-summary"></div>
          <div class="providers-grid">
            <label><span>Provider</span><select id="panelProviderSelect"></select></label>
            <label class="providers-model-stack" style="grid-column:1/-1;"><span>Model (saved per provider)</span>
              <div class="model-picker-field" data-model-picker-scope="providersForm">
                <div class="model-input-with-trigger">
                  <input id="panelModelInput" type="text" autocomplete="off" placeholder="Type a model id or pick from catalog" />
                  <button type="button" id="btnPanelModelCatalog" class="ghost model-catalog-trigger" data-model-picker-trigger="true" aria-expanded="false" aria-controls="panelModelCatalogPopover" title="Open list of models from this provider’s catalog">Catalog ▾</button>
                </div>
                <div id="panelModelCatalogPopover" class="model-catalog-popover" data-model-picker-popover="true" hidden>
                  <div id="panelModelCatalogEmpty" class="model-catalog-empty meta" hidden>No models in catalog for this provider — use Refresh models or type a custom id.</div>
                  <ul id="panelModelCatalogUl" class="model-catalog-ul" data-model-picker-list="true" role="listbox" aria-label="Models from provider catalog"></ul>
                </div>
              </div>
            </label>
            <div id="panelModelSourceLine" class="meta" style="grid-column:1/-1;"></div>
            <div id="panelCatalogRefreshStatus" class="meta" style="grid-column:1/-1;" aria-live="polite"></div>
            <label><span>Base URL</span><input id="panelBaseUrl" placeholder="Endpoint root" /></label>
            <label><span>API key</span><input id="panelApiKey" type="password" autocomplete="off" placeholder="Paste key — never stored in settings JSON" /></label>
          </div>
          <div class="row wrap compact" style="margin-top:10px;">
            <button id="btnSaveProviderKey" class="primary-inline">Save API key</button>
            <button id="btnClearProviderKey" class="ghost">Clear API key</button>
            <button id="btnSaveBaseUrl" class="ghost">Save base URL</button>
            <button id="btnSaveProviderModel" class="ghost">Save model default</button>
            <button id="btnApplyDefaults" class="ghost">Set as global default</button>
            <button id="btnTestProvider" class="ghost">Test connection</button>
            <button id="btnRefreshProviderModels" class="ghost">Refresh models</button>
            <button id="revertProvidersForm" type="button" class="ghost">Revert</button>
          </div>
          <div id="panelConnectionResult" class="meta-block" style="margin-top:10px;"></div>
        </div>
      </section>

      <section class="pane" data-pane="missions">
        <div class="mission-layout">
          <div class="card">
            <div class="row split header-row">
              <div class="section-title">Mission Dashboard</div>
              <div class="row compact">
                <button id="resumeFocusedMission" class="ghost">Resume focused</button>
                <button id="abortFocusedMissionLlm" class="ghost">Stop LLM</button>
              </div>
            </div>
            <div id="missionActionStatus" class="meta" style="margin:6px 0 10px;" aria-live="polite"></div>
            <div id="missions"></div>
          </div>
          <div class="card inspector-card">
            <div class="row split header-row">
              <div class="section-title">Mission Inspector</div>
              <div class="row compact">
                <button id="inspectFocusedPolicy" class="ghost">Policy</button>
                <button id="inspectFocusedRouting" class="ghost">Routing</button>
                <button id="inspectFocusedDag" class="ghost">DAG</button>
              </div>
            </div>
            <div id="missionInspector"></div>
          </div>
        </div>
      </section>

      <section class="pane" data-pane="routing">
        <div class="card">
          <div class="row split header-row">
            <div class="section-title">Per-agent routing</div>
            <span class="meta">Saved on the focused mission</span>
          </div>
          <div class="meta" style="margin-bottom:10px;"><strong>Chat</strong> uses the Chat tab provider/model. Below configures <strong>autonomous mission</strong> agents only. Blank role fields inherit the mission-wide default.</div>
          <div id="routingPanelMount"></div>
        </div>
      </section>

      <section class="pane" data-pane="approvals">
        <div class="approval-layout">
          <div class="card">
            <div class="row split header-row">
              <div class="section-title">Approval Queue</div>
              <span id="approvalQueueCount" class="badge">0</span>
            </div>
            <div id="approvalQueue"></div>
          </div>
          <div class="card inspector-card">
            <div class="row split header-row">
              <div class="section-title">Approval Inspector</div>
              <div class="row compact">
                <button id="inspectSelectedDiff" class="ghost">Open Diff</button>
                <button id="inspectSelectedHunks" class="ghost">Open Hunks</button>
              </div>
            </div>
            <div id="approvalInspector"></div>
          </div>
        </div>
      </section>

      <section class="pane" data-pane="bundles">
        <div class="card">
          <div class="row split header-row">
            <div class="section-title">Approval Bundles</div>
            <span class="meta">Grouped by target and action</span>
          </div>
          <div class="row compact" style="margin-bottom:8px;"><button id="approveFocusedBundle" class="ghost">Approve selected bundle</button><button id="rejectFocusedBundle" class="ghost">Reject selected bundle</button></div>
          <div id="approvalBundles"></div>
        </div>
      </section>

      <section class="pane" data-pane="timeline">
        <div class="card">
          <div class="row split header-row">
            <div class="section-title">Mission Timeline</div>
            <button id="clearTimelineFilters" class="ghost">Clear Filters</button>
          </div>
          <div class="timeline-filters">
            <input id="timelineFilterText" placeholder="Filter message/source/mission" />
            <select id="timelineFilterLevel">
              <option value="all">all levels</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
            <label class="toggle inline-toggle"><input id="timelineFilterFocusedOnly" type="checkbox" /><span>Focused mission only</span></label>
          </div>
          <div id="timeline"></div>
        </div>
      </section>

      <section class="pane" data-pane="agents">
        <div class="card">
          <div class="section-title">Agent Activity</div>
          <div id="agents"></div>
          <div class="section-title" style="margin-top:10px;">Live Agent Stream</div>
          <div id="agentLive"></div>
        </div>
      </section>

      <section class="pane" data-pane="tools">
        <div class="card">
          <div class="section-title">Tool Console</div>
          <div class="tool-grid">
            <button id="openTerminal">Open Terminal</button>
            <button id="listMcpTools">List MCP Tools</button>
            <button id="listMcpSessions">List MCP Sessions</button>
            <button id="reviewFocusedDiff">Review Pending Diff</button>
            <button id="reviewFocusedHunks">Review Pending Hunks</button>
            <button id="reviewFocusedBundle">Bundle Summary</button>
            <button id="openBundlesTab" class="ghost">Open Bundles</button>
          </div>
          <div id="toolSummary" class="meta-block"></div>
        </div>
      </section>

      <section class="pane" data-pane="memory">
        <div class="card">
          <div class="row split header-row">
            <div class="section-title">Memory</div>
            <button id="searchMemory">Search</button>
          </div>
          <div class="row split">
            <input id="memoryQuery" placeholder="Search persistent memory" />
            <button id="clearMemorySearch" class="ghost">Clear</button>
          </div>
          <div id="memorySearchResults"></div>
          <div class="section-title">Recent Global Memory</div>
          <div id="globalMemory"></div>
          <div class="section-title">Focused Mission Memory</div>
          <div id="missionMemory"></div>
        </div>
      </section>

      <section class="pane" data-pane="console">
        <div class="card">
          <div class="section-title">Mission Console</div>
          <pre id="consoleOutput" class="console-output"></pre>
        </div>
      </section>

      <section class="pane" data-pane="trace">
        <div class="card">
          <div class="row split header-row">
            <div class="section-title">Diagnostic trace</div>
            <span class="meta">Host + webview (JSONL)</span>
          </div>
          <p class="meta" style="margin:0 0 8px;">Same ring buffer as the <strong>My AI Trace</strong> output channel. Use Refresh after activity; optional auto-refresh below.</p>
          <div class="row wrap compact trace-toolbar" style="margin-bottom:8px;">
            <button type="button" id="btnTraceRefresh" class="primary-inline">Refresh</button>
            <button type="button" id="btnTraceExport" class="ghost">Export to file</button>
            <button type="button" id="btnTraceClear" class="ghost">Clear</button>
            <button type="button" id="btnTraceOpenOutput" class="ghost">Open output panel</button>
            <label class="field-inline trace-level-field"><span>Level</span>
              <select id="traceLevelSelect">
                <option value="error">error</option>
                <option value="info">info</option>
                <option value="debug">debug</option>
                <option value="trace">trace</option>
              </select>
            </label>
            <label class="toggle inline-toggle"><input id="traceAutoRefresh" type="checkbox" /><span>Auto-refresh (3s)</span></label>
          </div>
          <div id="traceLogMeta" class="meta" style="margin-bottom:6px;">No data yet — open this tab or press Refresh.</div>
          <pre id="traceLogOutput" class="trace-log-panel"></pre>
        </div>
      </section>

      <section class="pane" data-pane="settings">
        <div class="card">
          <div class="row split header-row">
            <div class="section-title">Quick Settings</div>
            <div class="row compact">
              <span id="quickSettingsDirtyBadge" class="dirty-badge" hidden>Unsaved</span>
              <button id="revertQuickSettings" type="button" class="ghost">Revert</button>
              <button id="saveQuickSettings">Save</button>
            </div>
          </div>
          <div class="settings-grid">
            <label><span>Default provider</span><select id="settingDefaultProvider"></select></label>
            <label><span>Default model</span>
              <div class="model-picker-field" data-model-picker-scope="quickSettings">
                <div class="model-input-with-trigger">
                  <input id="settingDefaultModel" placeholder="Per-provider default when clean" />
                  <button type="button" id="btnSettingDefaultModelCatalog" class="ghost model-catalog-trigger" data-model-picker-trigger="true" aria-expanded="false" aria-controls="settingDefaultModelCatalogPopover" title="Open list of models from this provider’s catalog">Catalog ▾</button>
                </div>
                <div id="settingDefaultModelCatalogPopover" class="model-catalog-popover" data-model-picker-popover="true" hidden>
                  <div id="settingDefaultModelCatalogEmpty" class="model-catalog-empty meta" hidden>No models in catalog for this provider.</div>
                  <ul id="settingDefaultModelCatalogUl" class="model-catalog-ul" data-model-picker-list="true" role="listbox" aria-label="Default models from provider catalog"></ul>
                </div>
              </div>
            </label>
            <label><span>Heartbeat seconds</span><input id="settingHeartbeatSeconds" type="number" min="1" step="1" /></label>
            <label><span>Default tab</span><select id="settingDefaultTab">
              <option value="chat">chat</option>
              <option value="providers">providers</option>
              <option value="missions">missions</option>
              <option value="routing">routing</option>
              <option value="approvals">approvals</option>
              <option value="bundles">bundles</option>
              <option value="timeline">timeline</option>
              <option value="agents">agents</option>
              <option value="tools">tools</option>
              <option value="memory">memory</option>
              <option value="console">console</option>
              <option value="trace">trace</option>
              <option value="settings">settings</option>
            </select></label>
          </div>
          <div class="toggle-grid">
            <label class="toggle"><input id="settingAllowTerminal" type="checkbox" /><span>Allow terminal tool</span></label>
            <label class="toggle"><input id="settingRequireWriteApproval" type="checkbox" /><span>Require write approval</span></label>
            <label class="toggle"><input id="settingAutoRevealOnActivation" type="checkbox" /><span>Auto-reveal on activation</span></label>
          </div>
          <div class="row split">
            <button id="openSettings2" class="ghost">Open VS Code Settings</button>
            <span class="meta">For full settings, use the standard VS Code settings page.</span>
          </div>
          <div id="settingsPanel"></div>
        </div>
      </section>
    </main>
  </div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
