# My AI Sidebar

A modular VS Code AI assistant with a unified sidebar for:

- chat
- provider management
- live provider model catalogs
- autonomous missions
- approvals and bundles
- routing and DAG editing
- tools and MCP integration
- mission and global memory
- trace and console views

The extension is designed around a single sidebar workflow instead of scattered commands and panels. It supports human-in-the-loop approvals, autonomous mission execution, provider-aware model selection, and a modular host/webview runtime.

---

## What it does

### Unified sidebar

The extension adds a **My AI** activity bar view with a webview-based sidebar that includes these tabs:

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

### Missions and autonomous workflows

The extension can run structured autonomous missions with:

- planner / implementer / reviewer / validator style routing
- resumable mission execution
- dependency graphs
- closure policies
- validation gating
- background heartbeats and recovery
- persistent mission state in workspace files

### Human approval workflow

Supports approval-gated operations such as:

- file writes / patches
- terminal commands
- MCP tool calls
- external adapter calls
- grouped approval bundles
- diff / hunk review flows

### Memory

Supports both:

- **mission memory**
- **global semantic memory**

with configurable recall limits and scoring thresholds.

### Tools and MCP

The extension can use:

- built-in tools
- MCP tools and sessions
- external HTTP-backed adapters
- terminal execution
- file operations restricted to the workspace if desired

### Trace and diagnostics

Includes a unified trace system for host and webview behavior, with:

- output channel visibility
- trace level selection
- optional file persistence
- export / clear controls
- operator-friendly status messages in the UI

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

- unified chat tab
- provider/model-aware send path
- optional context from selection / active file / diagnostics
- streaming chunk handling
- provider row sync with sidebar settings

### Providers

- provider status / credentials overview
- per-provider saved model
- live catalog refresh
- shortlist-style catalog picker plus free-text input
- provider connection testing
- model refresh feedback in the UI

### Missions

- autonomous mission execution
- resume / archive / delete / bulk cleanup flows
- mission inspector
- grouped timeline
- dependency graph / DAG editing
- routing and policy editing

### Approvals and bundles

- approve / reject pending actions
- next-hunk review
- approval bundle summary review
- grouped approval handling
- diff / hunk review support

### Tools

- MCP tools
- MCP sessions
- external adapters
- terminal / file tooling
- approval-aware execution model

### Memory

- mission event memory
- global memory search
- semantic recall controls
- UI memory views

### Trace / console

- trace level control
- trace export / clear
- trace snapshot view
- console view for sidebar activity

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

### From VSIX

Package the extension:

```bash
npm run package
```

This writes the packaged extension to:

`.vsix/`

Then install the generated `.vsix` in VS Code or Cursor using the Extensions UI.

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
- extension/unit tests under `dist/test`
- webview modular smoke harness

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

The extension contributes many settings under the `My AI` namespace.

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
- `myAi.missions.heartbeatSeconds`
- `myAi.missions.diskStoreFolder`
- `myAi.missions.policyPreset`
- `myAi.missions.maxAutoRounds`
- `myAi.missions.requireValidationEvidence`

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
- `myAi.mcp.toolCacheTtlSeconds`

#### UI and trace

Examples:

- `myAi.ui.dashboardPollIntervalMs`
- `myAi.ui.autoRevealOnActivation`
- `myAi.ui.defaultTab`
- `myAi.trace.level`
- `myAi.trace.persistToFile`

See `package.json` for the full up-to-date configuration surface.

### Commands

The extension contributes commands including:

- `My AI: Open Chat`
- `My AI: Start Autonomous Mission`
- `My AI: Resume Mission`
- `My AI: List Missions`
- `My AI: Approve Pending Action`
- `My AI: Reject Pending Action`
- `My AI: Review Pending Diff`
- `My AI: Review Pending Hunks`
- `My AI: Show Mission Memory`
- `My AI: Export Mission Bundle`
- `My AI: List MCP Tools`
- `My AI: List MCP Sessions`
- `My AI: Restart MCP Session`
- `My AI: Edit Mission Policy`
- `My AI: Edit Agent Routing`
- `My AI: Edit Mission DAG`
- `My AI: Search Global Memory`
- `My AI: Archive Mission`
- `My AI: Delete Mission`
- `My AI: Show Trace Log`
- `My AI: Export Trace Log`
- `My AI: Clear Trace Log`
- `My AI: Set Trace Level`

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

**Extension Development Host — manual (7 flows, pass/fail)**

Use a real workspace with valid provider credentials for the mission you start. Each flow **fails** if the webview throws visibly, the extension host logs an unhandled exception from this extension, or the stated outcome is missing.

1. **Sidebar and webview load** — Open **My AI**; switch across **Chat**, **Missions**, **Approvals**, **Timeline**. **Pass:** panes render, no persistent blank mission/approval area. **Fail:** blank webview or repeated errors in the developer console tied to the extension.
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

License: SEE LICENSE IN LICENSE

## Commercial use and licensing

This project is proprietary and not licensed for use, copying, modification, distribution, hosting, resale, or deployment without prior written permission.

If you want to:

- use this software commercially
- evaluate it for business/internal use
- obtain a license
- discuss partnership or custom terms

please contact the copyright holder in writing for permission and licensing terms.
