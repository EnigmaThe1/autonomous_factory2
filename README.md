# Autonomous Factory

Autonomous Factory is a VS Code / Cursor extension for AI-assisted software delivery. It brings chat, provider management, autonomous missions, approvals, tools, memory, trace output and MCP integration into one unified sidebar.

The project is designed as an experimental agentic-development workspace: an operator can define a mission, route it through structured agent-style workflows, review approval-gated actions, inspect trace output and manage model providers from the same interface.

## Portfolio summary

This repository demonstrates hands-on work with:

- VS Code extension development
- TypeScript extension-host architecture
- Webview UI design
- Multi-provider AI model routing
- Agentic mission workflows
- Human-in-the-loop approvals
- MCP tool/session integration
- Workspace memory and mission persistence
- Trace, diagnostics and operator-facing status design
- Packaging and test automation for extension delivery

## What it does

Autonomous Factory adds a unified sidebar with tabs for:

- Chat
- Providers
- Missions
- Routing
- Approvals
- Bundles
- Timeline
- Agents
- Tools
- Memory
- Console
- Trace
- Settings

The extension is built around a single operator workflow rather than scattered commands and panels. It supports provider-aware chat, structured autonomous mission execution, approval-gated tool/file/terminal operations, persistent mission state and diagnostic trace views.

## Key features

### Unified AI sidebar

The sidebar acts as the main operator interface for chat, missions, providers, tools, memory and diagnostics.

### Multi-provider model support

The project supports provider-aware model selection and catalog refresh for:

- Ollama
- OpenAI
- OpenAI-compatible endpoints
- Anthropic
- Gemini
- VS Code Language Model APIs

Model handling is designed to be:

- provider-aware
- dynamically refreshable
- shortlist-first in the UI
- free-text friendly when a model is not listed
- fallback-safe when live catalogs are unavailable

### Autonomous missions

Missions are structured workflows that can include:

- planner / implementer / reviewer / validator style routing
- resumable execution
- dependency graphs
- mission policies
- validation gates
- background heartbeats and recovery
- persistent mission state in workspace files

### Human-in-the-loop approvals

Approval-gated operations can include:

- file writes and patches
- terminal commands
- MCP tool calls
- external adapter calls
- grouped approval bundles
- diff and hunk review flows

This keeps the system useful for real development work while preserving operator control over risky actions.

### Tools and MCP integration

The extension can work with:

- built-in tools
- MCP tools and sessions
- external HTTP-backed adapters
- terminal execution
- workspace-restricted file operations

### Memory

The project includes support for:

- mission memory
- global semantic memory
- configurable recall limits
- scoring thresholds
- memory views in the sidebar

### Trace and diagnostics

The trace system gives the operator visibility into host and webview behaviour with:

- output-channel visibility
- trace-level selection
- optional file persistence
- export and clear controls
- readable status messages in the UI

## Architecture overview

The extension is split between host-side TypeScript services and a modular webview runtime.

```text
VS Code / Cursor
  -> extension host
  -> sidebar provider
  -> provider/model services
  -> mission orchestration services
  -> approval/tool/memory services
  -> webview UI
  -> workspace persistence
```

### Host side

The host side is centred on `src/ui/AiSidebarProvider.ts`, with responsibilities split into focused modules for:

- refresh orchestration
- snapshot building
- poll routing and execution
- UI message dispatch
- section publishing
- fingerprints and helper logic

### Webview side

The webview runtime is centred on `media/chat/main.js`, with extracted modules for:

- message handling
- snapshot and section-apply logic
- panel rendering
- DOM wiring
- tab control
- trace and persistence helpers

This modular structure is intended to keep behaviour stable while making future changes safer and easier to review.

## Installation and development

Install dependencies:

```bash
npm install
```

Compile:

```bash
npm run compile
```

Run tests:

```bash
npm run test
```

Run the CI script:

```bash
npm run ci
```

Package the extension:

```bash
npm run package
```

The generated VSIX package is written to:

```text
.vsix/
```

Install the generated `.vsix` in VS Code or Cursor using the Extensions UI.

## Test and validation commands

```bash
npm run compile
npm run test
npm run test:webview-smoke
npm run ci
npm run package
npm run trace:summarize
```

Optional real-network HTTP integration tests are skipped by default and can be run when outbound HTTPS is available:

```bash
npm run test:http-integration
```

## Configuration

The extension contributes settings under `myAi.*`, including:

- provider defaults
- provider base URLs
- mission controls
- tool and approval controls
- memory controls
- MCP controls
- UI and trace behaviour
- workspace indexing options

Examples include:

```text
myAi.defaultProvider
myAi.defaultModel
myAi.models.openai
myAi.models.ollama
myAi.models.anthropic
myAi.models.gemini
myAi.openai.baseUrl
myAi.ollama.baseUrl
myAi.missions.maxStepsPerRun
myAi.tools.requireApprovalForWrite
myAi.tools.requireApprovalForTerminal
myAi.mcp.configPath
myAi.trace.level
```

See `package.json` for the full current configuration surface.

## Commands

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
- `Autonomous Factory: List MCP Tools`
- `Autonomous Factory: List MCP Sessions`
- `Autonomous Factory: Restart MCP Session`
- `Autonomous Factory: Edit Mission Policy`
- `Autonomous Factory: Edit Agent Routing`
- `Autonomous Factory: Edit Mission DAG`
- `Autonomous Factory: Search Global Memory`
- `Autonomous Factory: Show Trace Log`
- `Autonomous Factory: Export Trace Log`
- `Autonomous Factory: Clear Trace Log`
- `Autonomous Factory: Set Trace Level`

## Storage and persistence

Mission and workspace data are persisted under:

```text
.my-ai-extension
```

inside the active workspace, depending on configuration. This storage area can include mission records, approvals, adapters and related extension artifacts. Provider model catalogs may also be cached depending on the provider-catalog implementation and refresh path.

## Release checklist

Before treating a VSIX build as releasable:

- `npm run ci` should pass.
- `npm run package` should complete and produce a `.vsix` file.
- The extension should activate successfully in a real Extension Development Host.
- Sidebar, chat, provider refresh, mission creation, approvals, bundles, timeline, memory and trace flows should be smoke-tested manually.
- Any visible webview crash, unhandled extension-host exception or broken mission/approval flow should be treated as a release blocker.

## Current status

This is a pre-release experimental project. It is useful for demonstrating agentic workflow design, extension-host architecture, webview UI development, multi-provider model routing, MCP integration and human-in-the-loop automation. It should not be treated as a production autonomous coding system without further security review, operational hardening and end-to-end validation.

## Portfolio relevance

This project is relevant for roles involving:

- AI automation engineering
- Agentic AI systems
- LLM application development
- Developer tooling
- VS Code extension development
- AI product prototyping
- Technical operations automation
- Human-in-the-loop workflow design

## Repository

<https://github.com/EnigmaThe1/autonomous_factory2>

## License and commercial use

No open-source license is currently provided. Unless a license is added, all rights are reserved by the repository owner. Commercial use, copying, modification, redistribution, hosting, resale or deployment requires prior written permission from the repository owner.
