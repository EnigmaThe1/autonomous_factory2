# Mission autonomy & upfront planning — implementation blueprint

**Status (2026-04)**: Core host + webview behavior through **Phase 10** and **cross-cutting** items is **implemented** in extension **v0.18.40+** (see checklist below). **Blueprint markdown export** to the workspace is **shipped** (includes pre-blueprint Q&A when present). **Optional** hardening (e.g. formal module globs for plan-fidelity v2) and polish remain future work.

This document is the **full engineering plan** for the behaviors discussed in product conversations:

- **Upfront blueprint**: after the user states the mission goal, the system produces a **complete, structured plan** (requirements, architecture intent, ordered work packages) — not only “first step then react.”
- **Agreement gate**: **questions and plan approval happen early** (right after mission input). After approval, the mission runs **as autonomously as possible** until the blueprint is satisfied or a real blocker appears.
- **Progress truth**: the UI and store expose **what was planned**, **what is done**, and **what remains** so operators know distance-to-goal.
- **High-level oversight**: a **non-implementer** role (architect / mission director) can **review the whole** against the agreed blueprint and enqueue follow-up work — without turning the mission into chat-after-chat.

**Related docs**: execution history and shipped tooling live in **`IMPROVEMENT_PLAN.md`**; optional tools and MCP live in **`AGENT_CAPABILITIES_PLAN.md`**. This blueprint **adds mission semantics and UX** on top of those layers.

---

## Guiding principles

1. **Plan is a first-class artifact** — persisted, versioned, referenced by work items; not only free-form memory.
2. **Parseable outputs** — the model proposes structure; the host **parses and validates** so the UI and orchestrator can rely on it.
3. **Autonomy by default after approval** — block only on trust/approval policy, explicit `BLOCKER:`, or configurable breakpoints — not on every step.
4. **Replanning is explicit** — surprises mid-flight produce **amendments** to the blueprint (audit trail), not silent drift.
5. **Model-swappable** — workflow quality must not depend on a single vendor; prompts and schemas are **host-owned**.

---

## Target outcomes (acceptance at project end)

| # | Outcome |
|---|--------|
| O1 | User can start a mission with a **high-level goal**; system generates a **multi-step blueprint** before bulk execution. |
| O2 | User can **approve, reject, or request revision** of the blueprint **once** (or a bounded number of rounds) from the sidebar. |
| O3 | After approval, **work items are derived from the blueprint** with stable **traceability** (each queue item maps to a blueprint step or sub-step). |
| O4 | Sidebar shows **blueprint progress** (e.g. N/M steps done, or weighted completion), not only raw queue counts. |
| O5 | Optional **architect pass** runs after defined milestones (e.g. validator passed) and can **enqueue gap work** without a conversational loop. |
| O6 | **Researcher** instructions (and optional blueprint section) use **`webSearch` / `fetchWebPage`** when `myAi.webResearch.enabled` is true. |
| O7 | **Coding defaults** (modular layout, bounded file size, layering) live in **shared instruction fragments** used by planner + implementer, not repeated in every user mission. |
| O8 | **Replanning**: new discoveries append **blueprint amendments** + linked work items; operator sees **what changed and why**. |

---

## Conceptual architecture (host-level)

```
User goal
   → [Planning phase] full blueprint (requirements + architecture + ordered steps)
   → [Agreement gate] approve / revise (bounded)
   → [Synthesis] WorkItem queue + blueprintStepId links
   → [Execution loop] existing MissionOrchestrator (researcher / implementer / reviewer / validator)
   → [Optional] Architect / gap pass → new work items + blueprint amendment
   → Terminal when blueprint complete + validator closure satisfied
```

**Important**: This does **not** replace `MissionOrchestrator`; it **front-loads planning** and **binds** the queue to a **persisted blueprint**.

---

## Phase 1 — Blueprint data model & persistence

**Goal**: Store a machine-usable plan on the mission.

**Deliverables**

- New types (e.g. in `src/types.ts` or `src/missions/blueprintTypes.ts`):
  - **`MissionBlueprint`**: `version`, `createdAt`, `approvedAt?`, `status` (`draft` | `awaiting_approval` | `approved` | `superseded`).
  - **`BlueprintStep`**: `id`, `title`, `summary`, `roleHint` (planner | researcher | implementer | …), `dependsOn?: string[]`, `acceptanceCriteria: string[]`, `status` (`pending` | `in_progress` | `done` | `skipped` | `blocked`), `optional?: boolean`.
  - **`BlueprintAmendment`**: `at`, `reason`, `addedSteps` / `modifiedStepIds` (minimal schema).
- **`Mission` extension**: `blueprint?: MissionBlueprint` (and migration: absent → legacy “no blueprint” missions behave as today).
- **Persistence**: `MissionStore` + disk unwrap/wrap + version bump in persistence tests.
- **Hydration rules**: old missions load with `blueprint` undefined; orchestrator uses **legacy path** (current planner-first enqueue).

**Acceptance**

- Unit tests: serialize / deserialize mission with blueprint; round-trip disk persistence.
- No behavior change for missions without blueprint (regression tests pass).

**Key files (expected)**

- `src/types.ts`, `src/missions/MissionStore.ts`, `src/storage/*` (mission persistence), `src/test/persistenceIntegration.test.ts`

---

## Phase 2 — Parseable blueprint generation (planner contract)

**Goal**: One (or two) model calls produce a **validated structured blueprint**, not only `WORK:` lines.

**Deliverables**

- **Output format** (choose one primary; host can accept the other as optional):
  - **Preferred**: JSON block in model output with schema validated by Zod or hand-rolled validator (strict field limits, max steps, max string lengths).
  - **Fallback**: strict markdown sections with a deterministic line grammar (harder to validate; use only if JSON reliability is poor on small models).
- **`BlueprintParser`**: `parseBlueprintModelOutput(text) → { blueprint, errors[] }`.
- **`BlueprintPlannerAgent`** (or `PlannerAgent` mode): instructions to:
  - Infer **implicit requirements** from the mission goal (capabilities, constraints, quality bar).
  - Propose **technical approach** (stack, major modules) at **architecture-summary** level — not line-by-line code.
  - Emit **ordered steps** with **acceptance criteria** and **dependencies**.
  - Respect **workspace context** (reuse `EnhancedContextCollector` output in the planning prompt).
- **Caps**: `myAi.missions.maxBlueprintSteps` (default e.g. 40), max chars per field — reject overflow with planner retry or user-visible error.

**Acceptance**

- Parser unit tests: golden good outputs, malformed recovery.
- Planner integration test (mocked LLM): blueprint attaches to mission in `draft` / `awaiting_approval`.

**Key files**

- `src/agents/PlannerAgent.ts` or new `src/agents/BlueprintPlannerAgent.ts`
- `src/missions/blueprintParser.ts`, `src/test/blueprintParser.test.ts`

---

## Phase 3 — Agreement gate & mission lifecycle

**Goal**: After blueprint generation, **pause** until user approves (or revises); no autonomous implementer runs until then (configurable).

**Deliverables**

- **Mission runtime flags** (e.g. on `Mission` or `MissionRuntime`):
  - `blueprintStatus`, `planRevisionCount`, `maxPlanRevisions` (settings).
- **Orchestrator behavior**:
  - Path **A** (blueprint mode ON): `startMission` → enqueue **single** work item `role: planner` with prompt “generate full blueprint” → on success → set `awaiting_approval` → **stop auto-run** until host receives approval.
  - Path **B** (legacy): existing behavior when setting `myAi.missions.blueprintMode` is false or mission is old.
- **Commands / protocol**:
  - `myAi.approveMissionBlueprint` / `myAi.rejectMissionBlueprint` / `myAi.requestMissionPlanRevision` (or webview messages → same).
- **Revision**: re-enqueue planner with prior blueprint + user comment; increment revision counter; cap revisions.

**Settings (initial)**

- `myAi.missions.blueprintMode` (default `false` until stable — then default `true`).
- `myAi.missions.requireBlueprintApproval` (default `true` when blueprint mode on).
- `myAi.missions.maxBlueprintRevisions` (default e.g. 3).

**Acceptance**

- Integration test: blueprint generated → orchestrator idle → approve → queue synthesized (Phase 4) → execution proceeds.

**Key files**

- `src/missions/MissionOrchestrator.ts`, `src/missions/MissionStore.ts`, `package.json` commands, `src/ui/protocol.ts`

---

## Phase 4 — Queue synthesis from blueprint

**Goal**: Deterministic mapping **blueprint steps → `WorkItem[]`** with **stable IDs** for progress and traceability.

**Deliverables**

- **`synthesizeWorkItemsFromBlueprint(blueprint): WorkItem[]`**:
  - Map each step to one or more work items (policy: default 1:1 for implementer-heavy steps; researcher steps explicit when blueprint says “research”).
  - Set **`blueprintStepId`** on `WorkItem` (new optional field).
  - Respect `dependsOn` → `WorkItem.dependsOn` graph (already supported for decomposed items).
- **Progress aggregation**: pure function `computeBlueprintProgress(mission) → { done, total, percent, blockedStepIds }` for UI.
- **Completion rule**: mission **cannot** `completed` while blueprint has non-optional steps not `done`/`skipped`, unless operator **supersedes** blueprint (explicit action).

**Acceptance**

- Unit tests: DAG order preserved; circular dependency detection surfaces as planner error or host validation error.
- Orchestrator: after approval, first enqueue batch matches blueprint order subject to dependencies.

**Key files**

- `src/missions/blueprintSynthesis.ts`, `src/types.ts` (`WorkItem`), `src/ui/missionProgressStats.ts` (extend or parallel)

---

## Phase 5 — Sidebar / webview: blueprint UI

**Goal**: Operator sees **full plan**, **approval controls**, and **progress**.

**Deliverables**

- Snapshot fields: `missionBlueprintSummary` or embedded `blueprint` slice (mind webview payload size — summarize long plans).
- Missions tab / inspector:
  - Render steps with status icons; show **Acceptance criteria** collapsed.
  - Buttons: **Approve plan**, **Request changes** (prompt), **Reject** (fail mission or return to draft).
- **Shipped (v0.18.45+)**: export blueprint as markdown — inspector **Export blueprint (markdown)…** and command **`myAi.exportMissionBlueprint`** (save dialog under workspace folder; opens the file).

**Acceptance**

- Webview smoke tests for new message types (pattern already in `aiSidebarUiDispatchSmoke.test.ts`).
- Manual: large blueprint truncates with “expand” or file export, not broken render.

**Key files**

- `src/ui/protocol.ts`, `media/chat/*`, `src/ui/AiSidebarProvider.ts`, snapshot builder

---

## Phase 6 — Autonomous execution policy (minimal chat)

**Goal**: After approval, **do not** stop for human unless necessary.

**Deliverables**

- Document and enforce:
  - **Stop reasons**: approval-gated tools, `BLOCKER:`, optional `myAi.missions.pauseAfterEachValidator` (default false), budget exhaustion, fatal errors.
- **Shipped (v0.18.42+)**: `pauseAfterEachValidator` pauses after each successful validator step (`awaiting_input`, `post_validator_checkpoint`); operator **`resumeMission`** clears the gate and continues (unlike blueprint/approval `awaiting_input`, which stays gated until the matching command).
- **No mid-mission “chat thread”** required: all clarifications should be **structured** (single revision round during agreement gate, or blocker form).
- **Dry-run**: blueprint mode respects existing `mission.dryRun` (synthesis can still run; tools muted).

**Acceptance**

- Config matrix tests: autonomous path runs without UI messages when approvals auto-granted in test harness.

**Key files**

- `src/missions/MissionOrchestrator.ts`, settings schema in `package.json`

---

## Phase 7 — Architect / gap-analysis pass (post-validation)

**Goal**: **System-level** review pass (not file editing) after milestones.

**Deliverables**

- New role **`architect`** (or reuse `planner` with distinct work-item title/prompt) **enqueued by orchestrator** when:
  - Validator marks a **milestone** complete (config: every N implementer tranches, or when blueprint “phase” boundary crossed), **or**
  - Blueprint has **explicit** “review gates.”
- **Prompt**: compare **repo summary + mission memory + blueprint**; output only **`WORK:`** / **`BLUEPRINT_AMEND:`** structured lines (new mini-parser) — **no** `applyPatch`.
- **Amendments**: append to `MissionBlueprint.amendments` and enqueue new items with `blueprintStepId` pointing to new ids.

**Acceptance**

- Test: architect pass adds exactly one approved follow-up when mock output requests gap closure.

**Key files**

- `src/agents/AgentFactory.ts`, new `src/agents/ArchitectAgent.ts`, `src/missions/MissionOrchestrator.ts`, parser extension

---

## Phase 8 — Researcher + external discovery alignment

**Goal**: Implicit discovery uses **workspace + web** when enabled.

**Deliverables**

- Update **`ResearchAgent`** instructions: when `myAi.webResearch.enabled`, **prefer** `webSearch` / `fetchWebPage` for external facts, APIs, versions — still bounded by policy.
- Optional blueprint template section **“External research checklist”** auto-filled by researcher before blueprint finalization (if two-phase planning: **research → blueprint**).

**Acceptance**

- Mock tool test: researcher emits webSearch tool call when setting on.

**Key files**

- `src/agents/ResearchAgent.ts`, planner prompts if two-phase planning added

---

## Phase 9 — Shared coding standards fragment

**Goal**: Modularity and structure are **default**, not user-repeated.

**Deliverables**

- `src/agents/instructionFragments.ts` (or similar): **`CODING_STANDARDS_FRAGMENT`**, **`ARCHITECTURE_DISCIPLINE_FRAGMENT`** (short, stable).
- Injected into **Planner** (blueprint), **Implementer**, **Reviewer** system paths in `BaseAgent` or per-agent.

**Acceptance**

- Snapshot test or string test that fragments are included when setting `myAi.agents.enforceDefaultCodingStandards` (default true).

---

## Phase 10 — Plan fidelity & drift (optional hardening)

**Goal**: Surface **unplanned scope** relative to approved blueprint.

**Shipped (v0.18.41+, opt-in)**

- **Setting**: `myAi.missions.blueprintFidelityCheck` (default **false**). When **true**, after an **implementer** work item completes, the orchestrator calls **`MissionFileTracker.flush(missionId)`** so `mission.filesModified` is current, then runs **`computePlanFidelityDrift(mission)`** in `blueprintPlanFidelity.ts`.
- **Heuristic v1**: tokens (length ≥ 4, stopwords stripped) from blueprint **requirements**, **architecture**, and **step** titles; a modified path “matches” if any token appears as a substring in the normalized path, or the path hits a **config/tooling allowlist** (`package.json`, lockfiles, `tsconfig`, ESLint, Docker, etc.). If there is drift, enqueue a **non-blocking** reviewer item **“Plan fidelity — unexpected file paths”** (`requiredForCompletion: false`, `dependsOn` the implementer item), with dedupe if a **Plan fidelity** todo/running item already exists. **`MissionEvent`** `source: blueprint-fidelity` on flag.
- **v2 (later)**: structured **module list** in blueprint + path glob expectations; optional tie-in to **memory tags**.

**Deliverables (original spec — v1 covered above)**

- **Heuristics v1**: compare **MissionFileTracker** paths to blueprint-derived keywords; if mismatch, enqueue reviewer work item to justify or amend plan.
- **v2 (later)**: structured **module list** in blueprint + path glob expectations.

**Acceptance**

- Unit tests in `src/test/blueprintPlanFidelity.test.ts`: drift vs no-drift paths, allowlisted config, no blueprint / not approved → no drift.

**Key files**

- `src/missions/blueprintPlanFidelity.ts` — keyword extraction + drift
- `src/missions/MissionOrchestrator.ts` — `maybeEnqueuePlanFidelityReview`, optional ctor `fileTracker`
- `src/missions/MissionFileTracker.ts` — `flush` before comparison
- `src/extension.ts` — pass `fileTracker` into orchestrator

---

## Implementation order (dependencies)

```
Phase 1  Data model + persistence
   ↓
Phase 2  Parser + blueprint planner output
   ↓
Phase 3  Agreement gate + orchestrator pause/resume
   ↓
Phase 4  Queue synthesis + blueprint progress
   ↓
Phase 5  Webview blueprint UI + protocol
   ↓
Phase 6  Autonomy policy + settings
   ↓
Phase 7  Architect pass (can start after Phase 4 in parallel with Phase 5–6)
   ↓
Phase 8  Researcher/web alignment (parallel anytime after Phase 2)
   ↓
Phase 9  Instruction fragments (parallel early)
   ↓
Phase 10 Plan fidelity (after Phase 4 + file tracker integration)
```

**Suggested first milestone (shippable slice)**: **Phases 1–4 + minimal Phase 5** (approve + list steps, no polish) + **Phase 9** — gives end-to-end “full plan then run” behind a **settings flag**.

---

## Readiness & cross-cutting items (review pass)

These were double-checked against **`IMPROVEMENT_PLAN.md`** (shipped orchestrator, runner, reports) and the host **`MissionStatus`** / **`BackgroundMissionRunner`** behavior. Address them during implementation so nothing fights the new flow.

| Topic | Why it matters | Where to handle |
|--------|----------------|-----------------|
| **Pre-blueprint clarification** | Product ask: short **Q&A after mission text**, *before* full blueprint generation, so the model does not guess unstated constraints. | **Shipped (v0.18.43+)**: `myAi.missions.preBlueprintClarification` + planner `pre_blueprint_clarify` JSON **`questions[]`** → **`awaiting_pre_blueprint_answers`**; inspector textarea + **`submitPreBlueprintAnswers`** / command **`myAi.submitPreBlueprintClarification`** → enqueue **`blueprint_generate`** with Q&A in prompt. |
| **Mission status vs approval pause** | Today **`queued` / `running`** drive **`BackgroundMissionRunner`** and stall recovery. A mission **waiting only for plan approval** must **not** look like a stuck queue or trigger auto-replan. | **Shipped**: **`BackgroundMissionRunner`** only iterates missions in **`queued`** or **`running`**; **`awaiting_input`** (blueprint approval, pre-blueprint answers, approvals, etc.) is **excluded** from heartbeat stall / recovery ticks. |
| **Heartbeat / runner lease** | **`tryAcquireRunnerLease`** and stall thresholds must not run destructive recovery while the mission is **only** waiting on human plan approval. | **Shipped**: same filter as above; no stall counter advance for **`awaiting_input`** missions. |
| **Closure + validator vs blueprint** | **`missionClosurePolicy`** and **`validationState`** already gate completion; blueprint “all steps done” must **align** with validator closure so missions do not complete with an incomplete blueprint (or vice versa). | **Phase 4** — extend closure checks or add a single **pre-terminal** guard: `blueprint` satisfied **and** existing closure rules. Document interaction with **`shouldCollapseToComplete`**. |
| **Mission events / audit** | Operators need a trail: blueprint generated, revised, approved, synthesized, amended. | **Phase 3–5** — append **`MissionEvent`** rows (or structured `source` tags) on each transition; mission report already surfaces events. |
| **Memory mirror** | Semantic recall (`BaseAgent.askModel`) works best if the **approved** blueprint summary lives in **`mission.memory`**. | **Phase 3–4** — on approve, add a **`MemoryItem`** (e.g. kind `summary`, tags `["blueprint","approved"]`) with a trimmed text cap. |
| **Sub-items / DECOMPOSE** | Existing **`WorkItem.subItems`** and **`DECOMPOSE:`** flow must **coexist** with `blueprintStepId` (either nest under a step or forbid double-decomposition per policy). | **Phase 4** — document policy in `blueprintSynthesis.ts` (recommend: one synthesized top-level item per blueprint step; internal decomposition unchanged). |
| **VSIX / docs** | Ship this blueprint for operators (same pattern as **`AGENT_CAPABILITIES_PLAN.md`**). | **Shipped**: blueprint markdown is **not** in **`.vscodeignore`**; command **`myAi.openMissionAutonomyBlueprint`** + Settings tab link. |

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Models emit invalid JSON | Schema validation + one retry + user-visible “plan failed to parse, simplify goal or switch model.” |
| Huge plans overflow context | Step caps, summarization pass, “export full plan to file” for UI. |
| Users want infinite revisions | `maxBlueprintRevisions` + explicit “reset mission.” |
| Blueprint and queue diverge | Single synthesis function on approve; amendments only via architect pass or explicit replan command. |

---

## Out of scope (for this blueprint)

- Replacing VS Code with a standalone app.
- Guaranteed correctness of generated plans (always human + validator in the loop for high-stakes work).
- Full formal methods / theorem proving of architecture.

---

## Checklist summary

Use this as a **burn-down** when implementing (host + webview **shipped** v0.18.40+ unless noted):

- [x] Phase 1 — Types + persistence + migration tests
- [x] Phase 2 — Blueprint parser + planner contract
- [x] Phase 3 — Agreement gate + lifecycle + commands
- [x] Phase 4 — Synthesis + `blueprintStepId` + progress math
- [x] Phase 5 — Webview blueprint + approval UX
- [x] Phase 6 — Autonomy policy settings (+ `pauseAfterEachValidator`, pre-blueprint Q&A)
- [x] Phase 7 — Architect / gap pass
- [x] Phase 8 — Researcher + web tools alignment
- [x] Phase 9 — Shared coding-standard fragments
- [x] Phase 10 — Plan fidelity / drift (optional; `myAi.missions.blueprintFidelityCheck`)
- [x] **Cross-cutting** — Pre-plan Q&A, runner/status exclusion for `awaiting_input`, closure + events + memory mirror, VSIX doc + command (see § Readiness table for detail)

---

*Document version: 1.6 — Export includes pre-blueprint clarification when `preBlueprintClarification` exists.*
