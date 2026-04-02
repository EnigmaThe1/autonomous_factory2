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

Add a Playwright (or similar) MCP server to your workspace **`.mcp.json`** (path from extension settings). Example shape (adjust server package/name to what you install):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

Restart MCP sessions, run **`listMcpTools`**, then agents use **`mcp.playwright.<tool>`** (exact names depend on the server). Mutations still follow **MCP approval** policy.

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

---

## Safety checklist (every new tool)

- [ ] Input validation (length, charset, URL host rules).
- [ ] `TrustPolicyEngine` action mapped; approvals respected.
- [ ] Bounded output (trim/truncate).
- [ ] Unit tests for happy path + disabled + validation failures.
- [ ] No new `npm` dependencies for Phase 1.
