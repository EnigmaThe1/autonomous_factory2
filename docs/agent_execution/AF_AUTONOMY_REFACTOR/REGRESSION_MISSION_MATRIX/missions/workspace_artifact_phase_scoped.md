Treat this prompt as the authoritative task contract for this mission. Do not treat prior chat, summaries, scratch notes, or generic heuristics as higher authority than this prompt.

You are working inside the Autonomous Factory extension repository.

Mission id:
`workspace_artifact_phase_scoped`

Mission family:
Workspace artifact mission

Primary objective:
Verify that future-phase deliverables are not probed or required too early.

What the orchestrator is supposed to prove:
- phase-sensitive deliverable timing
- reviewer / validator scope discipline
- no blind ENOENT retry loop on files that are not supposed to exist yet

Default mission root candidate:
`.tmp/af_regression_runs/workspace_artifact_phase_scoped/`

Required phase outputs:

Phase 0:
- `<MISSION_ROOT>/00_run_binding.md`
- `<MISSION_ROOT>/00_phase_contract.md`

Phase 1:
- `<MISSION_ROOT>/phase1/01_plan.md`
- `<MISSION_ROOT>/phase1/02_status.md`

Phase 2:
- `<MISSION_ROOT>/phase2/03_review.md`

Phase 3 only:
- `<MISSION_ROOT>/phase3/04_final_validation.md`
- `<MISSION_ROOT>/99_final_report.md`

Critical timing rule:
- `phase3/04_final_validation.md` and `99_final_report.md` must remain absent until Phase 3

Execution tasks:
1. Bind one canonical mission root.
2. Create the Phase 0 files first.
3. Create the Phase 1 files and explicitly record which later files must still be absent.
4. Create the Phase 2 review using only Phase 0-2 artifacts.
5. Only in Phase 3 create the final validation and final report.

Safety boundaries:
- do not modify files outside the resolved mission root
- do not treat missing Phase 3 files as failures during Phase 1 or Phase 2
- if a future-phase file is absent early, treat that absence as expected and continue / replan appropriately

Success criteria:
- future-phase files stay absent until their phase
- no reviewer / validator work reads or requires Phase 3 outputs early
- no generic missing-file retry loop replaces correct phase-aware behavior
- final report documents phase timing discipline

Preferred final response format:
- resolved mission root
- whether any future-phase read was attempted
- whether timing discipline passed
- final verdict
- exact path to `99_final_report.md`
