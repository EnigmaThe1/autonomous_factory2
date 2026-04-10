# Implementation ledger — AF autonomy / workspace coder refactor

**Program slug:** `AF_AUTONOMY_REFACTOR`  
**Extension repo:** `autonomous_factory/` (git root)

## Ledger location rationale

The extension had no pre-existing `IMPLEMENTATION_LEDGER.md`. This file is the canonical program ledger for the autonomy/workspace-coder initiative, under `docs/agent_execution/<slug>/` to align with workspace mission conventions.

## Phase 0 — Discovery (2026-04-10)

**Status:** DONE (discovery only)

**What changed**

- Added this ledger.
- Produced evidence pack at workspace path:  
  `/srv/autonomous_factory_v2/.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Autonomy_Phase0_Discovery/`  
  (maps, findings, decisions, validation log).

**Key mappings (summary)**

- Control plane: `MissionOrchestrator`, `MissionOrchestratorRunLoop`, `MissionOrchestratorWorkItemRunner`, blueprint flow, approval resolver.
- Five agents + factory: `AgentFactory`, `BaseAgent`, `PlannerAgent`, `ResearchAgent`, `ImplementerAgent`, `ReviewerAgent`, `ValidatorAgent`; additional `ArchitectAgent`.
- Policy/tools: `ToolRegistry`, `TrustPolicyEngine`, `RecoverySpinePolicy`.
- Blueprint: `blueprintParser`, `blueprintReadinessGate`, `blueprintSynthesis`, `MissionOrchestratorBlueprintFlow`.
- Collapse: `missionCompletionCollapse`, run loop `tryCollapseMissionToCompleted`.

**Validation**

- `npm run typecheck` — PASS (see run folder `07_validation/00_typecheck.log`).

**Follow-ups for Phase 1+**

- Extension-core path policy (`extensionUri`) vs workspace vs outside.
- Autonomy-oriented defaults or presets (in-workspace writes / terminal) without breaking safety.
- Unified failure taxonomy adapter over `toolOutcomeClassifier` + hard-stop classes.

**Next phase entry point**

- Implement policy/snapshot changes per `05_decisions/01_repo_mapping.md` recommended order; update this ledger after each validated phase.

## Phase 1 — Policy layer (2026-04-10)

**Status:** DONE

**What changed**

- Added `src/security/missionAutonomyPolicyTypes.ts`, `missionAutonomyPolicy.ts`, `workspacePathUtils.ts` (shared `isPathInWorkspace`).
- Refactored `TrustPolicyEngine` to delegate file/rename/terminal command decisions to the autonomy evaluator; extended `PolicyInput` with `renameFromPath`, `commandText`, `commandCwd`, `shellInvocationKind`.
- Updated `ToolRegistry` (`policyEngine` + `rename` + `runCommand`/`runTerminal`/git/docker/browser policy calls) to pass extension root and command context.
- `RecoverySpinePolicy`: paths outside workspace root are **not** recovery-spine protected (avoids bogus approval prompts; autonomy denies outside writes).
- `package.json`: new `myAi.missions.autonomy.*` settings; defaults aligned with workspace_coder (`allowTerminal` true, legacy write/terminal approval defaults false).
- `scripts/vscode-stub.cjs`: default `myAi.missions.autonomy.mode` **strict** so headless tests keep approval-heavy behavior unless overridden.
- Tests: `missionAutonomyPolicy.test.ts`, `missionAutonomyToolRegistry.integration.test.ts`, expanded `TrustPolicyEngine.test.ts`, `policyBlockedExecution` expectation update.

**Evidence pack**

- `.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Autonomy_Phase1_Policy_Layer/` (findings, decisions, validation log, final report).

**Validation**

- `npm run typecheck` — PASS  
- `npm test` — PASS

**Follow-ups**

- Failure-taxonomy adapter + recovery routing; optional autonomy for HTTP/MCP; sidebar copy for autonomy settings.

## Phase 2 — Structured failure classification & recovery router (2026-04-10)

**Status:** DONE

**What changed**

- Added canonical module `src/missions/failure/` (`structuredFailureTypes`, `failureClassifier`, `recoveryRouter`, `recoveryFingerprint`, `index.ts`).
- Wired `MissionOrchestratorWorkItemRunner` so terminal tool failures carry `pendingStructuredFailure`, resolve via `routeStructuredRecovery` (fingerprint + streak on `MissionRuntime`), and enqueue investigation / environmental researcher / terminal fail as appropriate.
- Policy denials record structured `hard_deny` (and related) on mission events while preserving block semantics.
- Post-mutation `runLinter` / `runTests` failures classify as validation failures and can spawn investigation waves via `tryEnqueueVerificationRecoveryWave` (implementer may remain `done`).
- Blueprint and pre-blueprint parse failures use `classifyBlueprintFailure` with bounded replan (`blueprint_revise` or extra `pre_blueprint_clarify`); streak and revision limits prevent infinite loops.
- Stream abort path records `StructuredFailure` + route (`transient` → `retry_direct` for timeout/system).
- Tests: `src/test/failureRecovery.test.ts`; matrix integration cases (host-risk `hard_deny`, post-mutation repairable + recovery wave, timeout `transient`).

**Evidence pack**

- `.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Autonomy_Phase2_Failure_Recovery/` (code map, findings, decisions, validation log, final report).

**Validation**

- `npm run typecheck` — PASS  
- `npm test` — PASS  

**Follow-ups**

- Optional replan around selected `hard_deny` cases (setting-gated); validator summary-only failure routing; UI surfacing of structured recovery fields.

## Phase 3 — Work-item lifecycle & recovery visibility (2026-04-10)

**Status:** DONE

**What changed**

- Added `src/missions/workItemLifecycle.ts`: runnable vs active sets, `resolveActiveStatusForWorkItem`, `normalizeWorkItem` / `normalizeWorkItemQueue` (legacy `running` → `in_progress`; `deadLetter` → `dead_letter`), `canTransitionWorkItemStatus`, `displayLabelForWorkItemStatus`.
- Extended `src/types.ts` with lifecycle statuses and metadata: `spawnedFromFailureOf`, `recoveryChainId`, `attemptCount`, `changedFiles`, `validationScopeHint` (plus existing `parentWorkItemId` / `retryCount`).
- `MissionStore.normalizeMission` normalizes the queue through `normalizeWorkItemQueue`.
- Orchestrator: run loop, work-item runner, approval resolver (approve → active resolve; reject → `blocked` + `approval_rejected`), failure investigation wave with optional reviewer/validator tail; `hasBlockingImplementerOutcome` includes `dead_letter` for terminal honesty signaling.
- `package.json`: `myAi.missions.recovery.enqueueReviewValidateChain` (default `true`).
- UI: `aiSidebarAgentPresentation` phase prefix for recovery-visible actives; mission progress stats / protocol updates for recovery-oriented visibility.
- Tests: `workItemLifecycle.test.ts`, `failureInvestigationEnqueue.test.ts` (minimal vs full wave), `missionWorkItemRecoveryLifecycle.integration.test.ts`; orchestrator tests updated for `awaiting_approval` and `dead_letter` timeout path.

**Evidence pack**

- `autonomous_factory/.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Autonomy_Phase3_WorkItem_Lifecycle/` (`02_code_map`, `05_decisions`, `07_validation/01_lifecycle_tests.txt`, `08_final_report/FINAL_REPORT.md`).

**Validation**

- `npm run typecheck` — PASS  
- `npm test` — PASS (log captured under evidence pack `07_validation/`).

**Follow-ups**

- Periodic audit for remaining hard-coded `status === "running"` outside lifecycle helpers; optional snapshot fields for recovery chains in additional UI surfaces.

## Phase 4 — Agent dispatch & role-scoped context (2026-04-10)

**Status:** DONE

**What changed**

- `src/types.ts`: canonical `MissionAgentRole` const object (JSON-safe string values), `FIVE_MISSION_AGENT_ROLES`, `ChatContext.roleDispatch` / `MissionRoleDispatchMeta`.
- New `src/missions/agentDispatch/`: `roleAllowedTools.ts` (`isMissionToolAllowedForRole`, enforcement-aligned allowlists), `roleContextBuilder.ts` (keyword policy, researcher targeting, filtered context, tailored user prompt cores, `attachRoleDispatchMeta`), `roleToolPromptLines.ts` (role-budget TOOL lines), `index.ts`.
- `missionOrchestratorWorkItemRunner`: `missionWorkItemContextKeywords` for `collectForMission`; post-collect filter + `roleDispatch`; tool loop denies disallowed tools with `[role_dispatch]` events.
- `BaseAgent.askModel`: uses `buildRoleSpecificUserPromptCoreLines`, `shouldAttachOptionalContextLabel`, `getRoleScopedToolInstructionLines` when `roleDispatch` is set.
- Tests: `src/test/agentDispatch.test.ts`, `src/test/missionAgentDispatch.integration.test.ts`; `missionOrchestratorUncaughtErrorReconcile` uses implementer for writeFile throw path.

**Evidence pack**

- `autonomous_factory/.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Autonomy_Phase4_Agent_Dispatch/` (`02_code_map`, `05_decisions`, `07_validation/01_agent_dispatch_tests.txt`, `08_final_report/FINAL_REPORT.md`).

**Validation**

- `npm run typecheck` — PASS  
- `npm test` — PASS (log under evidence pack `07_validation/`).

**Follow-ups**

- Optional MCP read-vs-write classification; harness scripts for explicit validator-BLOCKER + multi-replan ordering assertions.
