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

## Phase 5 — Mission runner: autonomous pass chaining & stop reasons (2026-04-10)

**Status:** DONE

**What changed**

- `missionActionResult.ts`: `MissionRunPassStopReason`; `ran_pass` may carry `stopReason`.
- `missionOrchestratorRunLoop.ts`: `RunLoopHost.normalizeQueueBeforeRunStep`; per-iteration normalize; empty-queue path uses fresh gate; classified returns; `autonomousStepCapChainCount` increment on step-cap exit and reset on work-item `done`/`skipped`; **step-cap terminal probe** (normalize → tryCollapse → handleEmptyQueue once) before emitting `max_steps_per_run`.
- `MissionOrchestrator.ts`: `normalizeQueueBeforeRunStep` via `normalizeMissionQueueForRunner`; `runMission` chains with autonomy policy + `maxAutonomousStepCapChains`; blueprint `scheduleRunMission` → `o.runMission`.
- `missionQueueNormalize.ts`: `collapseDuplicateRetryBranches` + structural `mutated` flag; **does not** call `reconcileStaleApprovalPendingHardStops` (preserves `approval_gate_stale` / awaiting_input semantics).
- `missionRunnerAutonomy.ts`: `autonomyModeAutoChainsRunPasses`.
- `types.ts`: `MissionRuntime.autonomousStepCapChainCount`.
- `missionAutonomyPolicy*.ts`: `workspace_autonomous` / `structured_autonomous` mode normalization.
- `package.json`: autonomy mode enum + `myAi.missions.autonomy.maxAutonomousStepCapChains`.
- Tests: `missionRunnerAutonomousChain.integration.test.ts`.

**Evidence pack**

- `autonomous_factory/.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Autonomy_Phase5_Mission_Runner/` (`02_code_map`, `05_decisions`, `07_validation/01_mission_runner_tests.txt`, `08_final_report/FINAL_REPORT.md`).

**Validation**

- `npm run compile` — PASS  
- `npm test` — PASS (full log under evidence pack `07_validation/`).

**Follow-ups**

- Optional refactor: shared `pickNextRunnable` helper; consider not counting pure `continue` empty-queue iterations as steps toward `maxStepsPerRun`.

## Phase 6 — Blueprint controller & enum modes (2026-04-10)

**Status:** DONE

**What changed**

- `missionBlueprintMode.ts` + `blueprint/missionBlueprintController.ts`: `off` / `soft` / `hard`; soft parse/readiness exhaustion → dynamic decomposition; hard honors `requireBlueprintApproval` before synthesis.
- `missionOrchestratorWorkItemRunner.ts`: blueprint planner path uses `planBlueprintParseFailureOutcome`, `buildBlueprintParseRecoveryWorkItem`, `buildDynamicDecompositionPlannerItem`, `finalizeParsedBlueprint` (removed inline readiness duplicate).
- `finalizeParsedBlueprint`: readiness errors logged via **`classifyBlueprintFailure`** + `recovery_attempt` telemetry.
- `package.json`: `myAi.missions.blueprintMode` **`oneOf`** string enum + legacy boolean.
- Tests: `src/test/missionBlueprintController.integration.test.ts`; `preBlueprintClarificationFlow.test.ts` uses **`hard`** when testing approval gate.

**Evidence pack (local, `.dev/` gitignored)**

- `autonomous_factory/.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Autonomy_Phase6_Blueprint_Controller/` (`02_code_map`, `04_findings/BLOCKER_DIRTY_TREE.md`, `05_decisions`, `07_validation/01_blueprint_tests.txt`, `08_final_report/FINAL_REPORT.md`).

**Validation**

- `npm run typecheck` — PASS  
- `npm test` — PASS (full log under evidence pack `07_validation/`).

**Follow-ups**

- Align operator docs / webview copy with `soft` vs `hard` semantics; optional `MYAI_SETTINGS_INVENTORY.md` refresh.

## Phase 7 — Review / validator structured outcomes & closure hardening (2026-04-10)

**Status:** DONE

**What changed**

- Structured reviewer lines + `reviewerOutcomeExtract` / `reviewValidatorOutcomeContracts`; `shouldEnqueueReviewerAutoRemediation` honors `REVIEW_OUTCOME: approved` and explicit `revision_required` / severity-gated `findings` before keyword heuristic.
- Structured validator lines in `validatorVerdictExtract` (`extractValidationStructuredFromSummary`, `validationStructuredToOutcome`); `validatorOutcomeRouting` applies pass/fail/inconclusive; fail path runs `applyValidatorFailRecoveryRouter` (`classifyValidationFailure` + `routeStructuredRecovery` + optional `prependResearcherBeforeValidatorRemediationChain`).
- `missionOrchestratorWorkItemRunner`: reviewer remediation prompts include structured findings; validator routing after tool-driven completion adjustment.
- `tryCollapseMissionToCompleted`: narrow `ensureClosurePolicy` when queue has no runnable/active work, `closureRequired`, and `validationState === "passed"` (final gap / proof injection without mid-mission planner spam).
- `runMission`: early return if mission already `completed` or `cancelled` (fixes invalid transitions when helpers call `runMission` after terminal completion).
- Agent prompts updated for Reviewer/Validator structured lines.

**Evidence pack (local, `.dev/` gitignored)**

- `autonomous_factory/.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Autonomy_Phase7_Review_Validate_Closure/` (`02_code_map`, `05_decisions`, `07_validation/01_review_validation_tests.txt`, `08_final_report/FINAL_REPORT.md`).

**Validation**

- `npm run compile` — PASS  
- `npm test` — PASS (full log under evidence pack `07_validation/`).

**Checkpoint commit:** `efe650b` — `[Phase 7][P7-T-001] Structured review/validator outcomes, routing, closure hardening`

**Follow-ups**

- Optional mission-level fields for last structured review/validation outcome; UI surfacing; docs refresh for new line protocols.

## Phase 8 — Settings / UI / validation stabilization (2026-04-10)

**Status:** DONE

**What changed**

- **Defaults:** `myAi.missions.autonomy.mode` default **`workspace_autonomous`**; `autonomy.blueprintPlanning` default **`off`**; new `myAi.missions.autonomy.autoContinuePasses` (default true) and `requireApprovalForProtectedPaths` (default true). `loadMissionAutonomyPolicy` fallbacks aligned.
- **Policy:** Non-spine `protectedPathGlobs` may follow ordinary auto-approve when `requireApprovalForProtectedPaths` is false; recovery-spine protected paths still require approval.
- **Runner:** `autonomyShouldScheduleNextPassAfterStepCap`; `MissionOrchestrator.runMission` persists `runtime.lastRunPassStopReason` after each pass.
- **Snapshot / UI:** `SidebarSettingsSummary` extended (blueprint enum, autonomy flags, globs, extension-core policy, recovery preset, retry budget numbers); `focusedMissionAutonomyObservability` in merge + full snapshot build; Chat hint + Settings read-only rows + Quick Settings autonomy controls + inspector **Autonomy & recovery** + runtime line for last pass stop.
- **Tests:** `missionPhase8Stabilization.integration.test.ts`, policy + chain tests, webview contract + modular smoke expectations updated.

**Evidence pack (local, `.dev/` gitignored)**

- `autonomous_factory/.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Autonomy_Phase8_Settings_UI_Validation/` (`07_validation/full_test_run.txt`, `08_final_report/FINAL_REPORT.md`, `08_final_report/RESIDUAL_RISKS_AND_NEXT_STEPS.md`, `05_decisions/01_settings_snapshot_contract.md`).

**Validation**

- `npm run compile` — PASS  
- `npm test` — PASS (full log under evidence pack `07_validation/full_test_run.txt`).

**Checkpoint commit:** `0959b4f` — `[Phase 8][P8-T-001] Settings UI: autonomy defaults, snapshot, inspector observability`

**Follow-ups**

- Inspector surfacing of structured recovery routes from events; operator doc refresh (`EXTENSION_GUIDANCE_PRINCIPLES`); optional mission-level autonomy overrides.

## Phase 9 — Mission root & phase/deliverable contract (2026-04-10)

**Status:** DONE

**Problem addressed**

- Reviewer/validator probed **future** or **out-of-scope** paths (often suggested by full mission goal text), hit ENOENT, and the runner treated those as **generic recoverable readonly** retries instead of scope/phase mismatch.
- No persisted **canonical artifact root** after unique run-folder selection.
- Implementer could reach **done** without on-disk evidence when blueprint acceptance criteria named concrete output paths.

**What changed**

- `types.ts`: `MissionRuntime.resolvedArtifactRootRelative`; `WorkItem.expectedDeliverableRelPaths`.
- `missionArtifactRootBinding.ts`: parse/persist `MISSION_ARTIFACT_ROOT:` (no `..`) into runtime.
- `missionReviewReadScope.ts`: reviewer/validator read allowlist from `filesModified`, `changedFiles`, and work-item scope fields (not `mission.prompt`); optional strict ENOENT handling.
- `implementerDeliverableVerification.ts`: stat expected deliverables before implementer `done`.
- `blueprintSynthesis.ts`: `extractImplementerDeliverablePathsFromStep` + populate `expectedDeliverableRelPaths` for implementer steps.
- `roleContextBuilder.ts`: reviewer prompt/keywords aligned with phase-scoped task context; optional bound root line.
- `toolOutcomeClassifier.ts`: `out_of_scope_review_read` blocked outcome.
- `failureClassifier.ts` / `recoveryRouter.ts`: `premature_or_out_of_scope_read` → **replan** (planner enqueue in runner).
- `missionOrchestratorWorkItemRunner.ts`: wire scope check, artifact root persistence, deliverable guard, structured recovery branch for premature reads.

**Design summary**

- Generalized, mission-agnostic; enforcement activates only when scope signals exist (backward compatible).
- Autonomy / protected-path / outside-workspace behavior unchanged.

**Validation**

- `npm run compile` — PASS  
- `npm test` — PASS (899 dist + 78 webview smoke); targeted `missionRootPhaseContract.test.ts` — PASS

**Evidence pack**

- `.dev/docs/_autogen/refactoring/refactoring__2026_04_10__AF_Mission_Root_And_Phase_Contract_Fix/` (inventory, code map, findings, decisions, validation log attachment).

**Residual follow-ups**

- Optional ToolRegistry join with `resolvedArtifactRootRelative` for default-relative reads (not implemented; blast radius).
- Tighter allowlist rules if operators need stricter “only these files” without `filesModified` warming up.

**Checkpoint commit:** `ff01d1a` — `[Phase 9][P9-T-001] Mission artifact root binding, review read scope, deliverable guard, premature-read recovery.`

## Phase 10 — Optional probe resilience & generalized deliverable guards (2026-04-10)

**Status:** DONE

**Problem addressed**

- Reviewer / validator could still block on optional readonly probes such as `git.status` because the control plane had no required-vs-optional evidence signal and git probes were not fully classified as readonly runtime tools.
- Non-blueprint implementer work could still reach `done` without strong artifact proof because deliverable guards only fired when `expectedDeliverableRelPaths` had already been populated.

**Files changed**

- `src/missions/missionEvidenceContract.ts`
- `src/missions/implementerDeliverableContract.ts`
- `src/missions/agentDispatch/roleContextBuilder.ts`
- `src/missions/agentDispatch/roleToolPromptLines.ts`
- `src/missions/readonlyMissionToolIds.ts`
- `src/missions/orchestrator/toolOutcomeClassifier.ts`
- `src/missions/orchestrator/missionOrchestratorWorkItemRunner.ts`
- `src/test/agentDispatch.test.ts`
- `src/test/toolOutcomeClassifier.test.ts`
- `src/test/implementerDeliverableContract.test.ts`
- `src/test/missionScenarioMatrix.test.ts`

**Design decision summary**

- Added a canonical evidence-contract layer that classifies review / validation tools as `required`, `preferred`, or `optional`.
- Reviewer / validator now default to artifact-root / current-phase evidence, and git probes are treated as optional unless the work-item contract explicitly asks for git evidence.
- Optional readonly probe failures now degrade in the runner instead of automatically becoming mission blockers.
- Added generalized implementer deliverable resolution for non-blueprint work by combining current-step prompt / summary evidence with phase-structured mission text and optional `<MISSION_ROOT>` resolution.
- Preserved autonomy defaults, protected-path gating, and outside-workspace / host-risk denials.

**Validation summary**

- `npm run compile` — PASS
- targeted regression suites — PASS
- `npm test` — PASS
  - 908 dist tests + 78 webview smoke tests passed

**Residual follow-ups**

- Planner-emitted explicit evidence / deliverable contracts would further reduce reliance on prompt-text inference for generic missions.
- Optional future improvement: expose the resolved evidence contract in inspector / mission event presentation for easier operator debugging.

## Phase 11 — Tool necessity & evidence sufficiency layer (2026-04-11)

**Status:** DONE

**Problem addressed**

- The prior optional-probe fix still treated necessity mostly as a per-tool flag, not as a first-class evidence sufficiency decision.
- Reviewer / validator failures could still fall into generic tool-failure routing because the orchestrator did not explicitly track:
  - what requirement the tool was serving
  - whether that requirement was already satisfied
  - whether substitute evidence remained
  - whether the correct response was continue, replan, or block
- Role packets still carried only tool allowlists, so evidence strategy existed mainly as prompt text.

**Files changed**

- `src/missions/missionEvidenceContract.ts`
- `src/missions/orchestrator/toolOutcomeClassifier.ts`
- `src/missions/orchestrator/missionOrchestratorWorkItemRunner.ts`
- `src/missions/agentDispatch/roleContextBuilder.ts`
- `src/missions/failure/failureClassifier.ts`
- `src/missions/failure/recoveryRouter.ts`
- `src/types.ts`
- `src/test/agentDispatch.test.ts`
- `src/test/toolOutcomeClassifier.test.ts`
- `src/test/missionScenarioMatrix.test.ts`

**Design decision summary**

- Expanded the canonical evidence-contract layer to define `WorkItemEvidenceContract`, `EvidenceRequirement`, and `ToolFailureEvidenceAssessment`.
- Reviewer / validator work items now derive mission-sensitive evidence strategies:
  - `artifact_scoped`
  - `repo_scoped`
  - `mixed`
- The runner now assesses failed tools against evidence sufficiency before deciding to block.
- Added a canonical `insufficient_evidence` / `insufficient_evidence_after_tool_failure` path so preferred-evidence failure without substitutes replans instead of becoming a generic pause.
- Added evidence metadata to `roleDispatch`, aligning the control plane and agent packet around the same contract.
- Preserved the existing deliverable guard as the canonical implementer completion proof path; no sidecar completion flow was introduced.

**Validation summary**

- `npm run compile` — PASS
- targeted evidence / orchestrator regression suites — PASS
- `npm test` — PASS
  - 914 dist tests passed
  - 78 webview smoke tests passed

**Residual follow-ups**

- A future Mission Compiler should emit explicit evidence contracts instead of relying on text inference from prompts and scope hints.
- Inspector / dashboard surfaces could expose evidence strategy and degraded-evidence telemetry more directly for operators.
