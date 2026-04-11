Treat this prompt as the authoritative task contract for this mission. Do not treat prior chat, summaries, scratch notes, or generic heuristics as higher authority than this prompt.

You are working inside the Autonomous Factory extension repository.

Mission id:
`workspace_artifact_simple`

Mission family:
Workspace artifact mission

Primary objective:
Create a small, self-contained mission artifact bundle in one canonical mission root and prove that simple artifact work does not require irrelevant repo-level probes.

What the orchestrator is supposed to prove:
- it can bind one mission root cleanly
- it can create bounded artifacts without wandering outside scope
- reviewer and validator can rely on direct artifact evidence instead of repo-wide git evidence

Default mission root candidate:
`.tmp/af_regression_runs/workspace_artifact_simple/`

Required root behavior:
- if the default root already exists, create a unique sibling such as `.tmp/af_regression_runs/workspace_artifact_simple__<run_id>/`
- once chosen, use the resolved root consistently for the rest of the mission

Required outputs:
- `<MISSION_ROOT>/00_run_binding.md`
- `<MISSION_ROOT>/01_scope.md`
- `<MISSION_ROOT>/02_inventory.md`
- `<MISSION_ROOT>/03_review.md`
- `<MISSION_ROOT>/99_final_report.md`

Execution tasks:
1. Bind the mission root and record it in `00_run_binding.md` with a plain line:
   `MISSION_ARTIFACT_ROOT: <resolved_root_relative_path>`
2. Create `01_scope.md` summarizing:
   - objective
   - allowed paths
   - forbidden paths
   - why repo-level git probes are unnecessary for this mission
3. Create `02_inventory.md` listing the files created in the root.
4. Create `03_review.md` reviewing only mission-root artifacts.
5. Create `99_final_report.md` with a concise outcome summary.

Safety boundaries:
- do not modify repo source code
- do not modify pre-existing files outside the resolved mission root
- do not run destructive git commands
- do not depend on repo-level git status, diff, or log unless a real blocker proves it is necessary

Success criteria:
- exactly one resolved mission root is used
- all required outputs exist
- review and validation stay inside the mission root
- no irrelevant repo-level probe causes a block

Preferred final response format:
- resolved mission root
- files created count
- whether any irrelevant probe was attempted
- final verdict
- exact path to `99_final_report.md`
