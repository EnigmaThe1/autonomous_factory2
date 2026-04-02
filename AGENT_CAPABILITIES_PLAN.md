# Agent capabilities roadmap (safe rollout)

This plan adds documentation lookup, workspace skills, optional web research, and (later) browser UI automation **without** loading heavy runtimes by default or auto-installing third-party code.

## Principles

1. **Off by default** for network-heavy or ambiguous features; operators opt in via settings.
2. **Reuse trust model**: new HTTP-backed tools use the same `http_request` policy as `httpRequest` (approval + URL validation + metadata host blocks).
3. **No silent installs**: the extension does not download or register arbitrary tools from the internet; new capabilities are **MCP servers**, **workspace files**, or **explicit config**.
4. **Lazy tool exposure**: keep `listTools` / `listMcpTools` as discovery; optional **`myAi.agents.lazyToolPrompt`** uses a short inline cheat sheet (Phase 5). Optional **capability bundles** in docs only (not auto-loaded).

---

## Phase 1 — Shipped (current `main`)

| Item | Behavior |
|------|-----------|
| **Workspace skills** | Load markdown from configurable globs (default: `.my-ai/skills/**/*.md`). Injected into agent **system** instructions (bounded total size). Command: **My AI: Open Workspace Skills Folder**. |
| **`webSearch`** | If `myAi.webResearch.enabled`, query DuckDuckGo Instant Answer API (fixed URL, no user URL). Validates query length; policy = `http_request`. |
| **`fetchWebPage`** | GET a single https URL (validated); larger response budget than generic `httpRequest`; optional HTML→text simplification; policy = `http_request`. |
| **HttpClient** | Optional `maxResponseBodyChars` for bounded reads. |

## Phase 2 — Browser / GUI

### 2a — MCP (full automation: click, console, navigate)

The extension reads **`myAi.mcp.configPath`** (default **`examples/mcp.sample.json`**): a JSON file with a **`servers`** array. Each entry has **`name`**, **`command`**, optional **`args`**, **`cwd`**, etc. (see repo **`examples/mcp.sample.json`**). Command Palette: **My AI: Open MCP Config File** opens that path when it exists.

Example (Playwright MCP; adjust package/version to what you install):

```json
{
  "servers": [
    {
      "name": "playwright",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  ]
}
```

Restart MCP sessions, run **`listMcpTools`** (or **`listTools`** for **`mcpServers`** names only), then agents use **`mcp.<server_name>.<tool>`**. Mutations still follow **MCP approval** policy.

### 2b — Shipped: `browserCapture` (CLI screenshot hook)

When **`myAi.browser.enabled`** is true and **`myAi.browser.captureCommand`** contains **`{url}`** and **`{outPath}`**, the **`browserCapture`** tool runs your command under the same policy as **`runCommand`** (terminal allow + approval). Output files go to **`<diskStoreFolder>/browser-captures/`**. No browser is bundled; you provide Playwright/Chromium/etc. on the machine.

Example command:

`npx playwright screenshot {url} {outPath}`

## Phase 3 — Web search providers (shipped)

| Item | Behavior |
|------|-----------|
| **`myAi.webSearch.provider`** | `duckduckgo` (default) — DuckDuckGo instant-answer JSON API (fair use; no key). `brave` — [Brave Search API](https://api.search.brave.com). Store the subscription token with **Command Palette → “My AI: Set Brave Search API Key”** (Secret Storage key `myAi.webSearch.braveApiKey`; never in `settings.json`). **“My AI: Clear Brave Search API Key”** removes it. |
| **`myAi.webSearch.minIntervalMs`** | Optional minimum milliseconds between **`webSearch`** HTTP calls after approval (`0` = off). Reduces accidental API hammering. |

## Phase 4 — Skills UX (shipped)

| Item | Behavior |
|------|-----------|
| **Open skills folder** | **My AI: Open Workspace Skills Folder** — creates `.my-ai/skills`, seeds `README.md` if missing. |
| **Globs / import** | Default patterns include `docs/agent-skills/**/*.md`; add paths in **myAi.skills.globPatterns** or copy skill packs into the workspace. |

## Phase 5 — “Lazy” tool catalog (shipped, opt-in)

| Item | Behavior |
|------|-----------|
| **`myAi.agents.lazyToolPrompt`** | Default **false** — full TOOL cheat sheet in the user prompt (includes **writeFile**, **applyPatch**, **runTerminal**, git, docker, db, http, web, MCP patterns). When **true**, a **short** sheet plus explicit guidance to run **`listTools`** (builtins + adapter names) and **`listMcpTools`** (MCP names) before using tools not shown. |
| **MCP / disk** | Full definitions stay in the host (`ToolRegistry`, MCP sessions); nothing new persisted. |

## Phase 6 — `listTools` hints (shipped)

| Item | Behavior |
|------|-----------|
| **`listTools` response** | Besides `builtins` (names), **`mcpServers`** (Phase 11), and `external` (adapter definitions), includes **`hints`**: `{ tool, hint }[]` with one-line argument / policy guidance for each builtin plus **git.*** / **docker.*** / **db.*** tools and **`ext.<adapter>`** rows (Phase 8; hints omit URLs). |
| **`myAi.tools.listToolsHintsMaxChars`** | Budget for serializing the hints list (default **16000**). If the budget is exceeded, rows are cut early and **`hintsTruncated`: true** is set. **0** omits **`hints`** entirely (previous behavior). |

## Phase 7 — `listMcpTools` summary budget (shipped)

| Item | Behavior |
|------|-----------|
| **`myAi.tools.listMcpToolsSummaryMaxChars`** | Default **0** — **`listMcpTools`** returns full **`McpToolDescriptor[]`** (including **`inputSchema`**). When **> 0**, each row is slimmed (no **`inputSchema`**, description trimmed), optional **`inputPropertyNames`** lists top-level JSON Schema **`properties`** keys (up to 36) when present; trailing tools are dropped until **`JSON.stringify(data)`** fits the budget; a sentinel row **`__myAi__.list_budget`** explains omissions. **`data`** stays an **array** (sidebar / command palette unchanged). |
| **Lazy prompt** | Recommended **24000–64000** with **`myAi.agents.lazyToolPrompt`** so MCP discovery does not flood the context with JSON Schema. |

## Phase 8 — External adapter hints in `listTools` (shipped)

| Item | Behavior |
|------|-----------|
| **`hints` + `external`** | When **`myAi.tools.listToolsHintsMaxChars` > 0**, after builtin and git/docker/db rows, **`hints`** includes one row per configured HTTP adapter: **`tool`:** `ext.<name>` and a **`hint`** built from description, mutating flag, and HTTP method — **no URL**, so adapter endpoints are not copied into the model context via hints. |

## Phase 9 — MCP summary `inputPropertyNames` (shipped)

| Item | Behavior |
|------|-----------|
| **Compact `listMcpTools`** | When **`listMcpToolsSummaryMaxChars` > 0**, each tool may include **`inputPropertyNames`**: top-level keys from **`inputSchema.properties`** (best-effort; no `$ref` / `allOf` expansion). Omitted when the schema has no usable **`properties`** object. |

## Phase 10 — `listTools` external URL redaction (shipped)

| Item | Behavior |
|------|-----------|
| **`myAi.tools.listToolsRedactExternalUrls`** | Default **false**. When **true**, **`listTools`** **`data.external`** is a public summary only (**`name`**, **`type`**, **`method`**, **`description`**, **`mutating`**) — no **`url`** or **`headers`**. Response includes **`externalUrlsRedacted`: true**. **`hints`** for **`ext.*`** are unchanged (they never included URLs). |

## Phase 11 — `listTools` MCP server names (shipped)

| Item | Behavior |
|------|-----------|
| **`data.mcpServers`** | String array of MCP server **`name`** values from the configured MCP JSON (**`myAi.mcp.configPath`**), read from disk only — **does not** start MCP processes. Use with **`listMcpTools`** to resolve tools per server (`mcp.<server>.<tool>`). |

## Phase 12 — MCP config command + doc alignment (shipped)

| Item | Behavior |
|------|-----------|
| **Open MCP config** | **My AI: Open MCP Config File** (`myAi.openMcpConfig`) opens the resolved MCP JSON when the file exists; otherwise a warning points at **`myAi.mcp.configPath`** and **`examples/mcp.sample.json`**. If the path is **absolute**, a workspace folder is not required; relative paths need an open workspace. Sidebar **Tools** tab: **Open MCP Config** posts the same action. **Chat & Missions** view title: same command (JSON icon), left of roadmap / blueprint / mission settings. |
| **Docs** | Phase 2a example JSON matches the **`servers`** array format the host parses (not Cursor-style **`mcpServers`** maps). |

## Phase 13 — Lazy discovery workspace preset (shipped)

| Item | Behavior |
|------|-----------|
| **Apply preset** | **My AI: Apply Lazy Discovery Preset (Workspace)** (`myAi.applyLazyDiscoveryPreset`) sets **workspace** settings: **`myAi.agents.lazyToolPrompt`** = **true**, **`myAi.tools.listMcpToolsSummaryMaxChars`** = **48000**, **`myAi.tools.listToolsRedactExternalUrls`** = **true**. Requires an open workspace folder. Operators can still tune individual keys afterward. |
| **Revert preset** | **My AI: Revert Lazy Discovery Preset (Workspace)** (`myAi.revertLazyDiscoveryPreset`) sets those three keys back to extension defaults (**false** / **0** / **false**). Same workspace-folder requirement. |
| **Activation** | **`onCommand`** activation for **`myAi.openMcpConfig`**, **`myAi.applyLazyDiscoveryPreset`**, and **`myAi.revertLazyDiscoveryPreset`** so these run without opening the sidebar first. Sidebar **Tools** tab: **Apply lazy discovery preset** / **Revert lazy discovery preset** post the same actions. |

## Phase 14 — Open roadmap from the extension (shipped)

| Item | Behavior |
|------|-----------|
| **Command** | **My AI: Open Agent Capabilities Roadmap** (`myAi.openAgentCapabilitiesDoc`) opens **`AGENT_CAPABILITIES_PLAN.md`** from the installed extension folder (bundled with the VSIX when the file is not excluded). **`onCommand`** activation included. Sidebar **Settings** tab: **Agent capabilities roadmap**. **Chat & Missions** view title: **Open MCP Config** (json) leftmost, then this command (map), mission blueprint (book), mission settings (gear). |

## Phase 15 — Mission autonomy & upfront planning (host + webview shipped)

| Item | Behavior |
|------|-----------|
| **Blueprint mode** | **`myAi.missions.blueprintMode`** — JSON blueprint pass; optional **`myAi.missions.preBlueprintClarification`**; **`myAi.missions.requireBlueprintApproval`**, **`maxBlueprintSteps`**, **`maxBlueprintRevisions`**, optional **`architectPassAfterValidator`**, **`blueprintFidelityCheck`**, **`pauseAfterEachValidator`**. Commands: **Submit Pre-Blueprint Answers**, **Approve / Reject / Request revision**, **Export / Copy Mission Blueprint**; inspector copy + export; **Open Mission Autonomy Blueprint** doc. See **`MISSION_AUTONOMY_AND_PLANNING_BLUEPRINT.md`** and **`IMPROVEMENT_PLAN.md`**. |
| **Sidebar UX (missions)** | **Chat** (start card): read-only line for workspace blueprint / pre-Q&A / approval flags, plus **Mission settings…** → VS Code Settings search **`myAi.missions`**. **Settings** tab: the same three flags as rows and **Edit mission settings in VS Code…** → same search. **Chat & Missions** view title: **Open MCP Config** (json), **Open Agent Capabilities Roadmap** (map), **Open Mission Autonomy Blueprint** (book), **Open Mission Settings** (gear); all in the Command Palette. Webview **`openSettings`** accepts an optional **`query`**; the host only forwards strings that match the **`myAi…`** settings-key pattern (otherwise falls back to **`myAi`**). |

---

## Safety checklist (every new tool)

- [ ] Input validation (length, charset, URL host rules).
- [ ] `TrustPolicyEngine` action mapped; approvals respected.
- [ ] Bounded output (trim/truncate).
- [ ] Unit tests for happy path + disabled + validation failures.
- [ ] No new `npm` dependencies for Phase 1.
