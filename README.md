# Autonomous Factory

A modular VS Code / Cursor AI assistant centered on one **activity bar** webview (**Chat & Missions**) for:

- chat with streaming and rich context (selection, active file, diagnostics)
- multi-provider models and optional **per-role routing** (`myAi.agents.providerMap`)
- **autonomous missions** with blueprints, queues, DAG editing, templates, and disk persistence
- **human-in-the-loop** approvals: file patches, terminal, HTTP, **MCP**, external adapters, bundles, diff/hunk review
- **workspace skills** injected from configurable markdown globs
- **MCP** servers (sessions, config file) plus **external HTTP adapters** and a **workspace file index** for relevance search
- **mission memory** and optional **global semantic memory**
- **trace** and **console** views, optional **web research** and **browser capture** tools (settings-gated)
- extensive **`myAi.*`** settings; mission files and previews default under **`.my-ai-extension`**

The UI is a single sidebar workflow (not scattered panels). The host (`AiSidebarProvider` and helpers) and webview (`media/chat/*`) are split into focused modules. Activation wires **ProviderRegistry**, **MissionOrchestrator**, **BackgroundMissionRunner**, **ToolRegistry**, **McpRegistry**, **GlobalMemoryStore**, **WorkspaceIndex**, and **MissionFileTracker**. An optional **native VS Code chat participant** is available via `myAi.useNativeChatParticipant`.

---

## What it does

### Unified sidebar

The extension adds an **Autonomous Factory** activity bar view with a webview-based sidebar that includes these tabs:

- **Chat**
- **Providers**
- **Missions**
- **Routing**
- **Approvals**
- **Bundles**
- **Timeline**
- **Agents**
- **Tools**
- **Memory**
- **Console**
- **Trace**
- **Settings**

When **Chat & Missions** is active, the view header (title bar) exposes four shortcuts, same as the Command Palette: **Open MCP Config** (JSON icon), **Open Agent Capabilities Roadmap** (map), **Open Mission Autonomy Blueprint** (book), **Open Mission Settings** (gear — VS Code Settings filtered to `myAi.missions`).

### Multi-provider model support

Supports multiple model providers with per-provider defaults and live model-catalog refresh:

- **Ollama**
- **OpenAI**
- **OpenAI-compatible**
- **Anthropic**
- **Gemini**
- **VS Code LM**

Model handling is designed to be:

- provider-aware
- free-text friendly
- dynamically refreshable
- shortlist-first in the UI
- fallback-safe when live catalogs are unavailable
- optionally **routed per agent role** when `myAi.agents.providerMap` is set

### Missions and autonomous workflows

The extension can run structured autonomous missions with:

- planner / implementer / reviewer / validator style routing
- **blueprint** flow: approve / reject / request revision, pre-blueprint Q&A, export/copy blueprint markdown
- resumable mission execution and **auto-resume on startup** (configurable)
- dependency graphs / **DAG** editing in the sidebar
- closure policies, validation evidence requirements, scaling / trust-gate options (see `myAi.missions.*`)
- background **heartbeats** and a **BackgroundMissionRunner**
- portable JSON mission state under the workspace (default folder **`myAi.missions.diskStoreFolder`** → `.my-ai-extension`)
- **mission templates**: save, start from template, manage
- **Copy Mission Diagnostic Snapshot (JSON)** for support or logs
- **MissionFileTracker** to relate mutations to blueprint scope (heuristics; configurable follow-ups)

### Human approval workflow

Supports approval-gated operations such as:

- file writes / patches (optional **diff before approve**)
- terminal commands
- MCP tool calls
- external adapter calls
- generic **HTTP** when enabled by policy
- grouped **approval bundles**
- diff / **hunk** review flows

### Memory

Supports both:

- **mission memory** (recent events and mission-scoped recall)
- **global semantic memory** (optional cross-mission persistence)

with configurable recall limits and scoring thresholds (`myAi.memory.*`).

### Tools and MCP

The extension can use:

- built-in tools (files, search, diagnostics, etc.) with workspace restrictions where configured
- **MCP** tools and **sessions** (JSON config path, optional session persistence and warmup)
- **external HTTP-backed adapters** (`adapters.json` path configurable)
- optional **terminal** execution
- optional **webSearch** / **fetchWebPage** (DuckDuckGo or Brave; API key in secret storage for Brave)
- optional **browserCapture** via a user-defined shell command (e.g. Playwright); no browser bundled
- **workspace skills**: markdown from globs merged into agent system prompts (size-capped)
- **WorkspaceIndex** / **findRelevantFiles**-style relevance (index build on activation or lazy; see `myAi.index.*`)

### Trace and diagnostics

Includes a unified trace system for host and webview behavior, with:

- output channel visibility
- trace level selection
- optional file persistence
- export / clear controls
- **Trace** and **Console** tabs in the sidebar
- operator-friendly status messages in the UI
- configurable dashboard poll and trace auto-refresh intervals (`myAi.ui.*`)

---

## Current architecture

The sidebar runtime is modularized on both the host and webview sides.

### Host side

The host is centered on `src/ui/AiSidebarProvider.ts`, with major responsibilities extracted into focused modules for:

- refresh orchestration
- snapshot building
- poll routing and execution
- UI message dispatch
- section publishing
- fingerprints and helper logic

### Webview side

The webview runtime is centered on `media/chat/main.js`, with extracted modules for:

- message handling
- snapshot and snapshotSection apply logic
- panel rendering
- DOM wiring
- tab control
- signatures / no-op skips
- trace / persistence helpers

This architecture is intended to keep behavior stable while making future changes safer and easier to review.

---

## Features

### Chat

- unified **Chat** tab
- provider/model-aware send path
- optional context from selection / active file / diagnostics
- streaming chunk handling
- provider row sync with sidebar settings
- optional **native VS Code chat participant** (`myAi.useNativeChatParticipant`)

### Providers

- provider status / credentials overview
- per-provider saved model
- live catalog refresh (where supported)
- shortlist-style catalog picker plus free-text input
- provider connection testing
- model refresh feedback in the UI

### Missions

- autonomous mission execution with queue and step checkpoints
- **blueprint** governance (approve, reject, request revision, export/copy)
- resume / archive / delete / bulk cleanup flows
- mission inspector
- grouped **Timeline** tab
- dependency graph / DAG editing
- per-mission **Routing** and policy editing
- **templates**: save mission as template, start from template, manage list
- diagnostic snapshot command for clipboard-friendly JSON

### Approvals and bundles

- approve / reject pending actions
- next-hunk review and **Review Next Pending Hunk**
- approval bundle summary review
- grouped approval handling
- diff / hunk review support; optional diff-before-approve for writes

### Tools

- MCP tools and session lifecycle (restart, list, config file command)
- external adapters from workspace JSON
- built-in file / search / diagnostic tools; optional terminal
- optional web research and browser capture tools
- workspace **skills** injection for agents
- approval-aware execution model (writes, terminal, HTTP, MCP, external)

### Memory

- mission event memory
- global memory search command and **Memory** tab
- semantic recall controls
- UI memory views

### Trace / console

- trace level control
- trace export / clear
- trace snapshot view in sidebar
- **Console** tab for sidebar activity
- settings for poll intervals and webview retain-context-when-hidden

---

## Supported providers

### Ollama

- configurable local base URL
- per-provider saved model
- intended for local/self-hosted model use

### OpenAI

- configurable API base URL
- live model catalog refresh
- per-provider saved model
- shortlist-first picker plus manual model input

### OpenAI-compatible

- configurable base URL
- intended for vLLM / llama.cpp-server / similar endpoints

### Anthropic

- configurable Anthropic API root
- live model catalog support
- per-provider saved model

### Gemini

- configurable Generative Language API root
- live model catalog refresh
- per-provider saved model

### VS Code LM

- optional model/family hint
- integrates with available VS Code LM capabilities when present

---

## Installation

All **`npm`** commands below are run from **this directory** (the extension package root — **`autonomous_factory/`** in the upstream repo layout).

### From VSIX

Package the extension:

```bash
npm run package
```

This writes the packaged extension to:

`.vsix/`

The file name follows **`package.json`** `name` and `version`: **`autonomous-factory-<version>.vsix`** (for example **`autonomous-factory-2.0.3.vsix`** when `version` is `2.0.3`).

Then install that `.vsix` in VS Code or Cursor using the Extensions UI (or `code --install-extension`).

### Development setup

Install dependencies:

```bash
npm install
```

Compile:

```bash
npm run compile
```

Run the extension in an Extension Development Host from VS Code as usual.

### Development scripts

**`npm run ci`** is an alias for **`npm run test`** (TypeScript compile once, then host tests and webview smoke).

Compile:

```bash
npm run compile
```

Watch:

```bash
npm run watch
```

Test:

```bash
npm run test
```

This currently runs:

- TypeScript compile
- extension/unit tests under `dist/test` (including **HttpClient** live **httpbin.org** tests **skipped** unless `MY_AI_RUN_HTTP_INTEGRATION=1`)
- webview modular smoke harness

Live **HttpClient** integration (real **httpbin.org**, no mocks; needs outbound HTTPS):

```bash
npm run test:http-integration
```

Webview smoke only:

```bash
npm run test:webview-smoke
```

CI:

```bash
npm run ci
```

Package VSIX:

```bash
npm run package
```

Summarize trace output:

```bash
npm run trace:summarize
```

### Configuration

The extension contributes many settings under the `myAi.*` keys (shown under **Autonomous Factory** in Settings).

#### Provider defaults

Examples:

- `myAi.defaultProvider`
- `myAi.defaultModel`
- `myAi.models.openai`
- `myAi.models.ollama`
- `myAi.models.anthropic`
- `myAi.models.gemini`
- `myAi.models.openaiCompat`
- `myAi.models.vscodeLm`

#### Provider base URLs

Examples:

- `myAi.openai.baseUrl`
- `myAi.openaiCompat.baseUrl`
- `myAi.anthropic.baseUrl`
- `myAi.gemini.baseUrl`
- `myAi.ollama.baseUrl`

#### Mission controls

Examples:

- `myAi.missions.autoResumeOnStartup`
- `myAi.missions.maxStepsPerRun`
- `myAi.missions.heartbeatSeconds` (background runner tick; default 12s)
- `myAi.missions.diskStoreFolder`
- `myAi.missions.policyPreset`
- `myAi.missions.maxAutoRounds`
- `myAi.missions.requireValidationEvidence`
- `myAi.missions.scalingMode` / `myAi.missions.adaptiveMaxRounds` / `myAi.missions.adaptiveFailurePenaltyRounds` / `myAi.missions.adaptiveLoopGuardPenaltyRounds` — adaptive mode scales max rounds with queue size but **reduces** the budget when failures, dead-letter rows, or loop-guard trips indicate churn.
- `myAi.missions.claimDiscipline` — prompts agents to record `MEMORY:` lines with `claim:verified_*` vs assumptions.
- `myAi.missions.trustGates.enabled` — optional extra approvals for dependency-style shell commands and very large patches unless verified claims exist (default off).
- `myAi.context.relevantSnippetsCacheTtlMs` — reuse keyword-based file snippets across work items for a short TTL (default 30s; `0` disables).
- `myAi.tools.searchFilesMaxResults` — cap matches returned by `searchFiles` / `grepSearch`.

**Settings reference (high-signal `myAi.*` keys)** — full definitions live in `package.json` `contributes.configuration`; this table is a short operator index.

| Setting | Purpose |
| --- | --- |
| `myAi.missions.diskStoreFolder` | Workspace folder for mission JSON, approval previews, and related artifacts (default `.my-ai-extension`). |
| `myAi.missions.toolResultSpill.enabled` | When true, oversized tool event payloads spill to disk under that folder so mission state stays smaller. |
| `myAi.missions.toolResultSpill.maxInlineBytes` | UTF-8 size cap for inline `event.data` before spill (default 24000; clamped 4096–500000 at runtime). |
| `myAi.missions.autoResumeOnStartup` | Resume eligible missions after window reload. |
| `myAi.missions.maxStepsPerRun` / `myAi.missions.maxAutoRounds` | Bound work per run / auto rounds. |
| `myAi.missions.scalingMode` + adaptive keys | Adaptive scaling of round budget from queue size with penalties on failures / loop guard. |
| `myAi.missions.trustGates.enabled` | Optional stricter approvals for risky shell / large patches without verified claims. |
| `myAi.missions.claimDiscipline` | Prompt shaping for verified vs assumption memory claims. |
| `myAi.context.relevantSnippetsCacheTtlMs` | TTL for reusing keyword snippets across work items. |
| `myAi.tools.searchFilesMaxResults` | Cap for `searchFiles` / `grepSearch` matches. |
| `myAi.memory.maxRecentEvents` | Mission memory list cap. |
| `myAi.trace.level` / `myAi.trace.persistToFile` | Trace verbosity and optional file sink. |

**Blueprint, scope, and verification (short operator map)**

- **Blueprint mode:** planner emits JSON; readiness runs before approval; revision work items include readiness text. Approve / reject / request revision from mission blueprint controls.
- **Scope (B1):** sensitive paths are hard-blocked; edits outside the current step’s scope can require approval (see mission events with `scope` / `telemetryKind: scope_drift` when present).
- **Verifier mesh:** balanced/strict presets can auto-run lint/tests after implementer mutations; completion may require validation evidence when `requireValidationEvidence` is on.
- **Diagnostics:** command **Copy Mission Diagnostic Snapshot (JSON)** (`myAi.exportMissionDiagnosticSnapshot`) puts a compact mission snapshot (queue, approvals tail, events, research contradiction hints) on the clipboard for support or logs.

#### Tool and approval controls

Examples:

- `myAi.tools.allowTerminal`
- `myAi.tools.requireApprovalForWrite`
- `myAi.tools.requireApprovalForTerminal`
- `myAi.tools.requireApprovalForMcp`
- `myAi.tools.requireApprovalForExternal`
- `myAi.tools.restrictToWorkspace`

#### Memory controls

Examples:

- `myAi.memory.maxRecentEvents`
- `myAi.memory.semanticRecallLimit`
- `myAi.memory.enableGlobalSemanticMemory`
- `myAi.memory.globalRecallLimit`
- `myAi.memory.minSemanticScore`

#### MCP controls

Examples:

- `myAi.mcp.configPath`
- `myAi.mcp.persistSessions`
- `myAi.mcp.sessionWarmupOnStartup`
- `myAi.mcp.sessionWarmupStaggerMs` — optional delay between MCP server warmups when startup warmup is on (reduces simultaneous spawns).
- `myAi.mcp.toolCacheTtlSeconds`

#### UI and trace

Examples:

- `myAi.ui.dashboardPollIntervalMs` — auto-refresh interval while the sidebar is visible (default 25s; lower = more host/MCP load).
- `myAi.ui.traceAutoRefreshIntervalMs` — Trace tab auto-refresh interval when that checkbox is on (default 10s). Changing any key that feeds the sidebar **Settings** summary (defaults, heartbeat, blueprint toggles, MCP config path, etc.; see `MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS` in `aiSidebarSettingsRead.ts`) triggers an immediate full snapshot refresh while the sidebar is visible so the webview stays in sync without waiting for the poll.
- `myAi.ui.retainWebviewContextWhenHidden` — keep webview JS state when hidden (default on; off saves memory, full reload when reopening).
- `myAi.ui.autoRevealOnActivation`
- `myAi.ui.defaultTab`
- `myAi.trace.level`
- `myAi.trace.persistToFile`

#### Workspace index (`findRelevantFiles`)

- `myAi.index.buildOnActivation` — when `true`, scan the workspace at extension startup; when `false` (default), indexing runs on first tool use (faster activate).
- `myAi.index.incrementalSaveDebounceMs` — coalesce `onDidSave` re-index work (default 2000 ms).
- Other keys: `myAi.index.maxFiles`, `includeGlobs`, `excludeGlobs` (see `package.json`).

See `package.json` for the full up-to-date configuration surface.

### Commands

The extension contributes commands including:

- `Autonomous Factory: Open Chat`
- `Autonomous Factory: Start Autonomous Mission`
- `Autonomous Factory: Resume Mission`
- `Autonomous Factory: List Missions`
- `Autonomous Factory: Approve Pending Action`
- `Autonomous Factory: Reject Pending Action`
- `Autonomous Factory: Review Pending Diff`
- `Autonomous Factory: Review Pending Hunks`
- `Autonomous Factory: Show Mission Memory`
- `Autonomous Factory: Export Mission Bundle`
- `Autonomous Factory: Copy Mission Diagnostic Snapshot (JSON)`
- `Autonomous Factory: List MCP Tools`
- `Autonomous Factory: List MCP Sessions`
- `Autonomous Factory: Restart MCP Session`
- `Autonomous Factory: Edit Mission Policy`
- `Autonomous Factory: Edit Agent Routing`
- `Autonomous Factory: Edit Mission DAG`
- `Autonomous Factory: Search Global Memory`
- `Autonomous Factory: Archive Mission`
- `Autonomous Factory: Delete Mission`
- `Autonomous Factory: Show Trace Log`
- `Autonomous Factory: Export Trace Log`
- `Autonomous Factory: Clear Trace Log`
- `Autonomous Factory: Set Trace Level`

### Storage and persistence

The extension persists mission and related workspace data under:

`.my-ai-extension`

inside the workspace, depending on your configuration.

This is used for mission storage, approvals, adapters, and related extension artifacts.
Provider model catalogs may also be cached/persisted depending on the current provider-catalog implementation and refresh path.

### Stability and verification

The current codebase includes targeted proof/stabilization work for:

- host refresh/poll orchestration
- host dispatch routing
- section contract behavior
- webview ESM/module loading
- webview message/apply smoke coverage

The extension still benefits from short manual smoke checks after significant sidebar/runtime changes, especially around:

- provider refresh
- chat send/stream
- memory search
- trace tab
- tools panel
- section update paths

#### Pre-release ship gate (VSIX considered releasable)

**Automated (must be green)**

- `npm run ci` (compile + `dist/test/**` + webview modular smoke).
- `npm run package` completes and produces a `.vsix` under `.vsix/` (see extension packaging rules).
- When using GitHub: **`.github/workflows/ci.yml`** runs **`npm run ci`** on push/PR. Use **Actions → CI → Run workflow** to run the optional **`http-integration`** job (live **httpbin.org**, **`npm run test:http-integration`**).

**Optional (real network, not mocked)** — **HttpClient** integration tests call **https://httpbin.org** and DNS; they are **skipped by default** so CI and offline runs stay stable. Before a release that touches `HttpClient` or HTTP tooling, run `npm run test:http-integration` (sets `MY_AI_RUN_HTTP_INTEGRATION=1`) or `MY_AI_RUN_HTTP_INTEGRATION=1 npm test` on a machine with outbound HTTPS.

**Extension Development Host — manual (7 flows, pass/fail)**

Use a real workspace with valid provider credentials for the mission you start. Each flow **fails** if the webview throws visibly, the extension host logs an unhandled exception from this extension, or the stated outcome is missing.

1. **Sidebar and webview load** — Open **Autonomous Factory**; switch across **Chat**, **Missions**, **Approvals**, **Timeline**. **Pass:** panes render, no persistent blank mission/approval area. **Fail:** blank webview or repeated errors in the developer console tied to the extension.
2. **Start mission** — From **Chat**, start an autonomous mission with a short title/prompt. **Pass:** a new row appears on **Missions** with a sensible status badge and title. **Fail:** no row, or mission stuck with no visible state after a reasonable wait.
3. **Resume** — With a mission in a resumable state (e.g. paused after max steps or stopped), use **Resume focused** or the resume command for that mission. **Pass:** status/events update or a clear operator-visible message (e.g. still blocked). **Fail:** no UI change and no explanation when a resume was expected.
4. **Approval accept and reject** — Provoke a pending approval (e.g. write with approval required). **Pass:** item appears in **Approvals**; **Approve** clears or advances it; on a separate attempt, **Reject** is reflected in mission/approval UI. **Fail:** action does nothing or queue stays wrong.
5. **Bundle action** — With a grouped bundle available, approve or reject from **Bundles** (or aligned command). **Pass:** bundle list and mission state stay consistent with the action. **Fail:** command vs sidebar disagree on outcome.
6. **Missions list with multiple missions** — At least two non-archived missions; exercise quick filter (e.g. active vs all). **Pass:** list order and focus make sense; when the host supplies a headline, a non-focused card can show **Latest action:** for a non-terminal mission. **Fail:** wrong focus, empty list when missions exist, or obvious signature/render regression (e.g. missing rows).
7. **Timeline and blocked/gated signal** — Open **Timeline**; confirm **operator-action** rows show a compact headline (not raw-only for mapped messages). Put or observe a mission in a blocked or downstream-gated state. **Pass:** timeline readable; inspector or card shows an appropriate gating/block hint where the orchestrator sets it. **Fail:** no headlines for known operator-action messages, or no visible clue for a clearly gated mission.

**Release blockers**

- Any automated gate red.
- Any manual flow above **Fail**.
- Install/load: cannot activate the extension or open the sidebar after installing the candidate `.vsix`.

Pre-release product: no obligation to support old ad-hoc test missions; gate against current behavior only.

### Current limitations

- Some native webview controls remain partly dependent on Electron / platform behavior.
- Provider model catalogs are dynamic, but the displayed picker intentionally favors a bounded shortlist over an unbounded raw list.
- Free-text model entry remains supported even when a provider catalog is available.
- Full end-to-end host↔webview runtime proof still benefits from manual smoke in a real Extension Host environment.

### Repository

Repository:

<https://github.com/EnigmaThe1/autonomous_factory.git>

License: [Apache-2.0](LICENSE) (Copyright 2026 Enigma The).

## License

Copyright 2026 Enigma The.

Licensed under the Apache License, Version 2.0 (the “License”); you may not use this project except in compliance with the License. A copy of the License is in the [LICENSE](LICENSE) file in this repository.

Apache 2.0 allows commercial use, modification, and distribution under its terms. It does not grant trademark rights in names, logos, or branding. For partnership or custom engagements, contact the copyright holder separately.
