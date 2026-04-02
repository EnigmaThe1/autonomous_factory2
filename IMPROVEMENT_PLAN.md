# Autonomous Factory Extension v2 — Improvement Plan

## Status Legend
- [ ] Not started
- [~] In progress
- [x] Completed

---

## Phase 1 — Terminal Output Capture (THE critical unlock)

- [x] **Step 1.1** — New `CommandRunner` (`src/tools/CommandRunner.ts`)
  - `child_process.spawn` with stdout/stderr pipe capture
  - Args: `command`, `cwd`, `timeoutMs`, `stdin`
  - Returns: `{ exitCode, stdout, stderr, timedOut }`
  - Truncation to configurable max (8 KB default)
  - Kill on timeout via AbortSignal (process group kill for shell children)
  - Trust policy integration (`run_command` action in TrustPolicyEngine)

- [x] **Step 1.2** — Register `runCommand` in `ToolRegistry`
  - Added to `BUILTIN_TOOL_NAMES` and `builtinDispatch`
  - Legacy `runTerminal` preserved
  - Config: `myAi.tools.commandOutputMaxBytes` (8192), `myAi.tools.commandTimeoutMs` (30000)

- [x] **Step 1.3** — Update agent instructions in `BaseAgent.askModel`
  - Added `runCommand` with description to instruction block
  - Added guidance to prefer `runCommand` over `runTerminal` for output capture

- [x] **Step 1.4** — Unit tests for `CommandRunner` (9 tests)
  - stdout capture, stderr capture, exit code, timeout, abort, cwd, stdin, truncation, env vars

---

## Phase 2 — Enhanced Search & File Discovery

- [x] **Step 2.1** — `ripgrepSearch` tool (`src/tools/RipgrepSearch.ts`)
  - Shell out to `rg --json` via `CommandRunner`
  - Proper shell quoting, 64KB output buffer, explicit `.` search path
  - Structured matches: `{ file, line, col, matchText, contextBefore, contextAfter }`

- [x] **Step 2.2** — `fileTree` tool (in `RipgrepSearch.ts`)
  - `find`-based directory tree with configurable depth/max files
  - Default excludes: .git, node_modules, dist, etc.

- [x] **Step 2.3** — Upgrade `searchFiles` → delegates to `ripgrepSearch` with VS Code fallback

- [x] **Step 2.4** — Registered `grepSearch` + `fileTree` tools, updated agent instructions

---

## Phase 3 — Rich Context Collection

- [x] **Step 3.1** — `EnhancedContextCollector` (`src/context/EnhancedContextCollector.ts`)
  - `collectProjectOverview()`, `collectDiagnosticsSummary()`, `collectGitStatus()`, `collectRelevantSnippets()`

- [x] **Step 3.2** — Expanded `ChatContext` with `projectOverview`, `relevantFileSnippets`, `allDiagnosticsSummary`, `gitStatus`

- [x] **Step 3.3** — Wired into `MissionOrchestrator` — first work item gets project overview, all get relevant files

---

## Phase 4 — Git Integration Tools

- [x] **Step 4.1** — `GitToolProvider` (`src/tools/GitToolProvider.ts`)
  - `gitStatus`, `gitDiff`, `gitLog`, `gitBlame`, `gitStashPush`, `gitStashPop`, `gitCheckoutFile`, `gitCommit`, `gitShow`

- [x] **Step 4.2** — Registered as `git.*` tool family; read-only ops auto-approved, mutating ops require approval

- [x] **Step 4.3** — Automatic git checkpoint/rollback (opt-in: `myAi.missions.gitCheckpointBeforeImpl`)

---

## Phase 5 — Test & Lint Runner Integration

- [x] **Step 5.1** — `runTests` tool (`src/tools/TestRunner.ts`) — auto-detect, parse TAP/Jest/pytest/Go output
- [x] **Step 5.2** — `runLinter` tool — parse ESLint JSON + generic fallback
- [x] **Step 5.3** — Registered in ToolRegistry, added to agent instructions

---

## Phase 6 — Hierarchical Work Decomposition

- [x] **Step 6.1** — Extended `WorkItem` with `subItems`, `parentWorkItemId`
- [x] **Step 6.2** — `DECOMPOSE:` parser in `agentOutputParser.ts`, planner creates sub-item DAGs
- [x] **Step 6.3** — Dynamic ceiling: `myAi.missions.scalingMode` (fixed/adaptive), capped at `adaptiveMaxRounds`
- [x] **Step 6.4** — `flattenSubItems()` in orchestrator for nested execution

---

## Phase 7 — HTTP Client & API Testing

- [x] **Step 7.1** — `httpRequest` tool (`src/tools/HttpClient.ts`) using native `fetch`
- [x] **Step 7.2** — `http_request` policy action, `requireApprovalForHttp` config, registered and instructed

---

## Phase 8 — Container & Infrastructure Awareness

- [x] **Step 8.1** — Docker tools: `docker.ps`, `docker.logs`, `docker.exec`, `docker.compose_status`
- [x] **Step 8.2** — Database tools: `db.query` (postgres/mysql/sqlite), `db.schema`
- [x] **Step 8.3** — Mutating infra tools require approval

---

## Phase 9 — Codebase-Wide Semantic Indexing

- [x] **Step 9.1** — `WorkspaceIndex` (`src/memory/WorkspaceIndex.ts`) — indexes exports, classes, functions
- [x] **Step 9.2** — `findRelevantFiles` tool registered in ToolRegistry
- [x] **Step 9.3** — Incremental updates via `onDidSaveTextDocument`

---

## Phase 10 — Mission Intelligence & UX

- [x] **Step 10.1** — Smart prompt budget management — priority-based progressive trimming, `maxPromptChars` config
- [x] **Step 10.3** — Mission dry-run mode — `mission.dryRun` skips mutating tools, logs intended actions
- [x] **Step 10.2** — Mission progress dashboard
  - `MissionProgressStats` interface in `protocol.ts` with per-mission stats
  - `computeMissionProgressStats` / `computeAllMissionProgressStats` pure functions in `missionProgressStats.ts`
  - Wired into snapshot builder → `missionProgressStats` field on `SidebarSnapshot`
  - Stats: total/done/running/todo/blocked/failed/skipped, completionPercent, rounds, elapsed, avgStepMs, estimatedRemaining, dryRun
- [x] **Step 10.4** — Mission resume with context reload
  - On `resumeMission`, collects fresh git status + diagnostics via `EnhancedContextCollector`
  - Stores a `checkpoint` memory item with the resume context summary
  - Enables agents to see workspace changes that occurred while mission was paused

---

## Implementation Order

```
Phase 1 (Terminal Capture)          ← no dependencies, MUST be first
  ↓
Phase 2 (Enhanced Search)           ← uses CommandRunner from Phase 1
  ↓
Phase 3 (Rich Context)              ← uses ripgrep from Phase 2
  ↓
Phase 4 (Git Tools)                 ← uses CommandRunner from Phase 1
  ↓
Phase 5 (Test/Lint Runner)          ← uses CommandRunner from Phase 1
  ↓
Phase 6 (Hierarchical Decomposition)← pure orchestrator work, can parallel with 4-5
  ↓
Phase 7 (HTTP Client)               ← lightweight, standalone
  ↓
Phase 8 (Container/DB)              ← uses CommandRunner from Phase 1
  ↓
Phase 9 (Semantic Indexing)          ← uses embedding infrastructure already in place
  ↓
Phase 10 (Intelligence/UX)          ← uses everything above
```

Phases 4, 5, 6, 7 can proceed in parallel once Phase 1 is done.
Phases 8 and 9 can also be parallelized.
Phase 10 is the capstone.

---

## Post-Plan Hardening (all completed)

- [x] **Tool Retry** — `withRetry` utility with exponential backoff for transient network errors
- [x] **Input Validation** — `inputValidation` module for command injection, SQL injection, unsafe URLs, invalid paths
- [x] **Auto-Retry Failed Work Items** — Orchestrator re-enqueues failed items with error context injection
- [x] **Mission File Tracking** — `MissionFileTracker` records all mutated files per mission
- [x] **Mission Report Generator** — `generateMissionReport()` with stats, error patterns, timeline, markdown output
- [x] **Event Compaction** — `compactEvents()` digests older events to manage context window size
- [x] **Agent Self-Correction Protocol** — 6-step instructions in agent prompts for error diagnosis/fix
- [x] **Mission Report Command** — `myAi.viewMissionReport` and `myAi.exportMissionReport` VS Code commands
- [x] **Webview Report Protocol** — `generateMissionReport` UI→Ext message type with `missionReportReady` response
- [x] **Focused Mission Report Summary** — `focusedMissionReportSummary` on sidebar snapshot (files, errors, %, retries)
- [x] **File Tracker Flush on Terminal** — `onMissionTerminal` callback flushes tracked files to mission store
- [x] **Webview mission report UI** — Missions tab: Report button on cards; inspector shows host `focusedMissionReportSummary`, Generate/Regenerate + markdown preview; `missionReportReady` handler updates cache and re-renders inspector (`missionReportInspectorCacheSig` in inspector signature)
- [x] **Mission progress dashboard in webview** — `missionProgressDashboard.js` formats `missionProgressStats` per mission on cards + inspector; `progressStatsFingerprint` in list/inspector sigs; clear `missionReportCache` when focusing a different mission
- [x] **Chat tab focused mission strip** — title, status badge, progress line; `chatPanelSig` includes `pst`, `ft`, `fs` so chat re-renders when focused mission or stats change
- [x] **Dashboard header missions summary** — `#summaryMissions` shows total plus running / queued / awaiting counts (`formatDashboardMissionSummaryText`)
- [x] **Copy mission report** — inspector **Copy report** uses Clipboard API with status line feedback
- [x] **691 tests** (613 host + 78 webview smoke), 0 failures, 0 lint errors

---

## Agent capabilities (skills + web research)

See **`AGENT_CAPABILITIES_PLAN.md`** for the full roadmap (browser via MCP, future providers).

- [x] **Phase 1** — Workspace skills (globs, cache, system prompt injection); `webSearch` + `fetchWebPage` gated by `myAi.webResearch.enabled`; `HttpClient.maxResponseBodyChars`; command **Open Workspace Skills Folder**
- [x] **Phase 2** — MCP Playwright recipe in `AGENT_CAPABILITIES_PLAN.md`; optional **`browserCapture`** CLI hook (`myAi.browser.*`)
- [x] **Phase 3** — `myAi.webSearch.provider` (duckduckgo \| brave + `myAi.webSearch.braveApiKey` secret); `myAi.webSearch.minIntervalMs` cooldown
- [ ] **Phase 4+** — Skills UX polish, lazy tool catalog, etc. (see `AGENT_CAPABILITIES_PLAN.md`)
