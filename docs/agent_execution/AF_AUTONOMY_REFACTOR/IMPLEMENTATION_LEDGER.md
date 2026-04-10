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
