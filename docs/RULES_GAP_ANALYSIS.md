# Cursor rules vs Autonomous Factory extension — gap analysis

**Scope:** Compares workspace rules under `.cursor/rules/` (repo root) with what the **Autonomous Factory** VS Code extension (`autonomous_factory/`, published as *Autonomous Factory*) actually implements in code, UX, and persistence.

**Persistence stance:** The product uses **structured mission state** (e.g. JSON under workspace data). That fully satisfies the *intent* of “record the mission” as long as the same **classes of information** are durable (blockers, checkpoints, events, queue, memory). **Markdown paths in `.cursor/rules` are one possible encoding, not a requirement** for the extension.

**Verdict discipline:** This document uses **PASS / PARTIAL / GAP** per rule *cluster* (not every `.mdc` file listed individually when a single row covers a folder).

**Last updated:** 2026-04-10

---

## 1. Executive summary

The Cursor rules describe a **mission operating system**: destination-first work, bounded autonomy, recoverability, validation before “done,” honest status, and durable audit trails. The extension implements a **strong subset** in **mission store + orchestrator**: queue, approvals, mutating-tool attribution, replay-safe recovery, policy presets, blueprint mode, checkpoints, events, memory, and operator-facing copy.

**Format-agnostic takeaway:** Gaps about “no `MISSION.md`” are really gaps about **whether each concern has a durable home** (could be JSON fields, export bundles, or optional repo files). **Git-per-task commits** remain a separate choice: the extension’s rollback spine is **mission state + operator resume**, not VCS.

**Largest *behavioral* gaps (not about file format):** (a) **structured scope / validation hints** on work items; (b) **richer completion semantics** in reports (verdict + limits); (c) **program-level** linking across missions if you want long-horizon governance in-product; (d) **`runCommand` metadata** when models send non-string args (recovery conservatism).

---

## 2. Extension-aligned guidance (generic principles)

**Canonical onboarding copy (no gap tables):** [EXTENSION_GUIDANCE_PRINCIPLES.md](./EXTENSION_GUIDANCE_PRINCIPLES.md)

**Summary:** Durable structured state (JSON is fine) should hold intent, queue, blockers, risky tools, events, and closure truth. Protect recoverability; bound the model with policy; be honest about validation. **Do not** treat fixed repo markdown paths or git-per-task from `.cursor/rules` as mandatory product behavior for the extension.

---

## 3. Rule cluster → extension mapping

| Cluster (`.cursor/rules/…`) | PASS | PARTIAL | GAP |
|----------------------------|------|---------|-----|
| **00-core** — mission OS, execution loop, validation gates, logging, checkpoints, blockers, handoff, preflight, scope, destination/mode, AI bounded autonomy, recoverability | | ✓ | Structured preflight/baseline; structured scope on work items |
| **10-governance** — task IDs, continuity, approval gates, phase exit, quality, archives | ✓ | ✓ | Strict phase-exit vs blueprint-as-content |
| **20-execution-hardening** — baseline, bounded fixes, commits, modularity, reuse | | ✓ | VCS-per-task not in product; rest is dev/agent discipline |
| **30-autonomy-program-control** — waves, program board, roadmap linking | | | Optional: first-class program links in store |
| **40-repo-ops-delivery** — artifact layout, stable checkpoints, packaging | | ✓ | **Intent** met by JSON + export; **layout** not prescribed |
| **50-evidence-audit** — proof, verdicts, observation vs inference, observability | | ✓ | Structured verdicts / claim-to-proof in reports |
| **60-testing-regression** — targeted tests, gap visibility | ✓ | | Extension test suite |
| **70-refactor-canonicalization** | | ✓ | Codebase hygiene |
| **80-config-dependency** | ✓ | ✓ | Settings inventory; avoid key sprawl |
| **90-docs-operator** | | ✓ | Operator docs vs product pace |
| **100-ui-human-factors** | ✓ | ✓ | Truthful mission UI |
| **110-runtime-resilience** | ✓ | ✓ | Heartbeat/lease/replay; `runCommand` preview edge case |
| **120-long-horizon-governance** | | | Optional durable program/backlog in store |

**Legend:** **PASS** = extension behavior substantially matches the rule intent. **PARTIAL** = important elements exist; notable pieces missing. **GAP** = no or minimal automated support.

---

## 4. Strong alignment (PASS / mostly PASS)

### 4.1 Recoverability-first autonomy (`00e`, `resumeRecovery`, orchestrator)

- **Implemented:** `recoverInterruptedQueueItems` (`src/missions/resumeRecovery.ts`) — read-only tools and read-only `runCommand` heuristics can be re-queued; ambiguous mutating interruption → **blocked** + explicit manual-review messaging.
- **Implemented:** `activeMutatingToolCall` on `WorkItem` (`src/types.ts`); set in `markMutatingToolExecutionStarted` (`missionOrchestratorWorkItemRunner.ts`); cleared on completion paths.
- **Implemented:** `blockReasonCode` `manual_review_required` and presentation (`missionBlockReasonCode.ts`, `missionLifecycleSummaryPresentation.ts`, `media/chat/missionOperatorLabelsCore.js`).
- **Tests:** `missionInterruptedReplaySafety.test.ts`, `resumeRecovery.test.ts`, lifecycle/operator UI tests.

### 4.2 AI-native bounded autonomy (`00d`)

- **Implemented:** Tool registry + policy engine; mutating vs non-mutating adapters; approval flows; `dryRun` mission mode (`types.ts`).
- **Implemented:** Agents receive objectives and tools; orchestrator enforces gates, not fixed reasoning scripts.

### 4.3 Autonomy control & continuation (`25`, `02-execution-loop`)

- **Implemented:** `runMission` loop, `maxAutoRounds`, `autoContinue`, work-item runner, resume/join semantics (`MissionOrchestrator.ts`).
- **Implemented:** Stall detection and replan policy (`BackgroundMissionRunner.ts`, `runnerRecoveryPolicy.ts`, `stallRecoveryReplanContext.ts`).

### 4.4 Validation gates & closure policy (`03`, `missionClosurePolicy`, `requiredWork`)

- **Implemented:** `closureRequired`, `requireReviewerBeforeComplete`, `requireValidatorBeforeComplete`, `requireImplementerBeforeComplete`, `minCompletedWorkItems`, `requireValidationEvidence` (`MissionStore` defaults + `types.ts`).
- **Implemented:** Downstream gating when required implementer work is blocked/failed (`requiredImplementerHardStopGate.ts`, `missionDownstreamGatingPresentation.ts`).

### 4.5 Blockers & escalation (`06`)

- **Implemented:** Mission `status` `blocked`/`failed`, `blocker` string, `blockReasonCode`, events log.
- **Note:** Blockers live in **mission persistence** (JSON). Optional repo `BLOCKERS.md` is a **human mirror**, not required for the extension to be “compliant” with the *spirit* of the rules.

### 4.6 Task identity & traceability (`13`)

- **Implemented:** Stable `work_*` / `mem_*` ids, `blueprintStepId`, checkpoints with `queueSnapshot`.

### 4.7 Runtime resilience (`57–60`, `60a`)

- **Implemented:** `MissionRuntime`: `lastProgressAt`, `lastRunnerHeartbeatAt`, `stalledHeartbeats`, `runnerLeaseExpiresAt`, `runnerOwnerId` (`RunnerLease.ts`, `MissionStore.ts`); webview inspector surfaces (`webviewRenderMissions.js`).
- **Implemented:** Bounded retry / auto-retry policy (`workItemAutoRetry.ts` and related).

### 4.8 UI truthfulness (`54`, `56`, `56a`)

- **Implemented:** Distinct labels for manual review, blocked vs completed, downstream gating hints; mission lifecycle summary strings tested under `src/test/mission*Presentation*.test.ts`.

---

## 5. Partial alignment — important gaps

### 5.1 Scope and change control (`07`)

- **Rules expect:** Per-task scope, affected files/systems, side effects, exclusions.
- **Extension today:** `WorkItem` has `title`, `role`, `prompt`, `dependsOn`, optional `blueprintStepId` — **no** first-class `scope` / `nonGoals` / `excludedPaths` fields.
- **Gap impact:** Scope lives in **natural language** prompts; orchestrator cannot validate or display structured scope.

### 5.2 Durable mission record vs markdown templates (`04`, `40-repo-ops`, `16`)

- **Rules often illustrate:** Repo markdown trees for mission state.
- **Extension today:** **Mission JSON** + checkpoints + events + memory + optional exports. **Same role** as the rule’s files: durable history and handoff.
- **Remaining gap:** Not format — it is **optional mirroring** into user-visible repo files if operators want git-diffable mission logs without using export.

### 5.3 Git checkpoints & rollback (`05`)

- **Rules expect:** VCS as rollback spine per task.
- **Extension today:** **Mission-level** resume, blocked state, approvals — not auto-commits per work item.
- **Guidance:** Treat git as **optional team practice**; extension spine is **store + operator actions**.

### 5.4 Preflight & baseline (`09`, `21`)

- **Rules expect:** Record environment baseline before heavy work.
- **Extension today:** No dedicated preflight object at `startMission`.
- **Portable improvement:** A small **mission.memory** or **event** snapshot (workspace folder, policy preset, time) — **any** structured slot — satisfies the guidance without a fixed filepath.

### 5.5 Implementation ledger & five-role cycle (`00c`)

- **Rules expect:** Formal complexity gating and named roles in sequence.
- **Extension today:** **Roles exist** as `AgentRole` and queue rows; enforcement is **policy + prompts**, not a hardcoded five-step state machine.
- **Guidance:** Use blueprint + queue to **approximate** the cycle; add product rules only if you need stricter gates.

### 5.6 Evidence, verdicts, claim-to-proof (`33–36`, `36a`)

- **Rules expect:** Explicit verdicts and proof mapping.
- **Extension today:** `generateMissionReport` — stats, errors, timeline; strong **operational** audit, lighter **semantic** verdict taxonomy.
- **Portable improvement:** Optional fields on `Mission` or a closing validator output string (still JSON-serializable).

### 5.7 `runCommand` interruption recovery (`110` + `00e`)

- **Implemented:** Read-only probe heuristic (`runCommandReadOnlyProbe.ts`).
- **Gap:** Missing **`commandPreview`** when `args.command` is not a string → conservative manual review (safe but noisy).
- **Recommendation:** Normalize or persist args before mutating marker (see §7).

### 5.8 Program / wave / roadmap (`26–28`, `61–64`)

- **Rules expect:** Linked multi-mission governance.
- **Extension today:** Missions mostly independent; blueprint/DAG **simulate** waves.
- **Guidance:** Use **mission title/tags/memory** or future `programId` — **not** a required `ROADMAP.md` path.

---

## 6. Optional product gaps (only if you want parity with *specific* repo conventions)

| Idea | Notes |
|------|--------|
| Export mission summary to **user-chosen** path | Settings-driven; avoids hard-coded `docs/...` |
| Optional `validationVerdict` / `validationLimits` on mission | JSON fields; report picks them up |
| Optional `programId` / links between missions | For program board *behavior* without markdown |

---

## 7. Recommendations (prioritized, format-agnostic)

1. **Structured work item metadata (high):** Optional JSON fields `scopeSummary`, `validationHint`, `excludedPaths` (or blueprint metadata) — **no** required on-disk layout.
2. **`runCommand` args durability (high):** Ensure mutating marker always carries inspectable command text when execution is possible (normalize malformed model args).
3. **Report honesty (medium):** Optional verdict + “limits” line sourced from mission JSON or validator output.
4. **Program linking (low / strategic):** Only if multi-mission programs become a core scenario.

---

## 8. How to use this document

- **Onboarding / principles only:** Use [EXTENSION_GUIDANCE_PRINCIPLES.md](./EXTENSION_GUIDANCE_PRINCIPLES.md).
- **Product/engineering:** That file for guidance; this document §4–§7 for concrete gaps and backlog.
- **Operators:** Use `.cursor/rules` as **behavioral guidance** for agents; [EXTENSION_GUIDANCE_PRINCIPLES.md](./EXTENSION_GUIDANCE_PRINCIPLES.md) §7 lists what **not** to over-fit to the extension.
- **Updates:** After orchestrator or policy changes, refresh §3 and §5 here; keep the principles doc in sync when semantics change.

---

## 9. References (code)

| Topic | Location |
|-------|-----------|
| Recovery / mutating marker | `src/missions/resumeRecovery.ts`, `src/missions/orchestrator/missionOrchestratorWorkItemRunner.ts` |
| Mission / work item types | `src/types.ts` |
| Closure & validation evidence | `src/missions/missionClosurePolicy.ts`, `src/missions/MissionStore.ts` |
| Downstream gating | `src/missions/requiredImplementerHardStopGate.ts`, `src/missions/missionDownstreamGatingPresentation.ts` |
| Stall / replan | `src/missions/BackgroundMissionRunner.ts`, `src/missions/runnerRecoveryPolicy.ts` |
| Operator strings / webview | `media/chat/missionOperatorLabelsCore.js`, `media/chat/webviewRenderMissions.js` |
| Mission report | `src/missions/missionReport.ts` |
| Settings inventory | `docs/MYAI_SETTINGS_INVENTORY.md` |
