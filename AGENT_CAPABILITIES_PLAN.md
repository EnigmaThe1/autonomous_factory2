# Agent capabilities roadmap (safe rollout)

This plan adds documentation lookup, workspace skills, optional web research, and (later) browser UI automation **without** loading heavy runtimes by default or auto-installing third-party code.

## Principles

1. **Off by default** for network-heavy or ambiguous features; operators opt in via settings.
2. **Reuse trust model**: new HTTP-backed tools use the same `http_request` policy as `httpRequest` (approval + URL validation + metadata host blocks).
3. **No silent installs**: the extension does not download or register arbitrary tools from the internet; new capabilities are **MCP servers**, **workspace files**, or **explicit config**.
4. **Lazy tool exposure**: keep `listTools` / `listMcpTools` as discovery; prompt templates stay concise; optional **capability bundles** in docs only (not auto-loaded).

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

## Phase 3 — Web search providers

| Step | Detail |
|------|--------|
| Configurable backend | Add `myAi.webSearch.provider`: `duckduckgo` (default) \| future: `brave` (API key in SecretStore). |
| Rate limits | Document DDG fair-use; add cooldown config if abuse appears. |

## Phase 4 — Skills UX

| Step | Detail |
|------|--------|
| Command | `My AI: Open workspace skills folder` (create `.my-ai/skills` + sample). |
| Import | Copy-pack from repo; glob patterns in settings. |

## Phase 5 — “Lazy” tool catalog (design)

- Host keeps **full** tool list on disk or in MCP only.
- Orchestrator may pass **short** builtin list + “call `listMcpTools` for servers X”.
- Not changing model APIs in Phase 1; revisit when context limits bite.

---

## Safety checklist (every new tool)

- [ ] Input validation (length, charset, URL host rules).
- [ ] `TrustPolicyEngine` action mapped; approvals respected.
- [ ] Bounded output (trim/truncate).
- [ ] Unit tests for happy path + disabled + validation failures.
- [ ] No new `npm` dependencies for Phase 1.
