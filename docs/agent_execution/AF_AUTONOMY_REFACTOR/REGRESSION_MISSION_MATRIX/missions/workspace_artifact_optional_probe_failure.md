Treat this prompt as the authoritative task contract for this mission. Do not treat prior chat, summaries, scratch notes, or generic heuristics as higher authority than this prompt.

You are working inside the Autonomous Factory extension repository.

Mission id:
`workspace_artifact_optional_probe_failure`

Mission family:
Failure-injection mission

Primary objective:
Verify that failure of an optional reviewer or validator probe does not block a mission when direct artifact evidence remains sufficient.

What the orchestrator is supposed to prove:
- optional probes are treated as optional
- evidence sufficiency is checked before blocking
- artifact-root evidence can carry the mission when a non-essential probe fails

Default mission root candidate:
`.tmp/af_regression_runs/workspace_artifact_optional_probe_failure/`

Required outputs:
- `<MISSION_ROOT>/00_run_binding.md`
- `<MISSION_ROOT>/01_artifact_under_review.md`
- `<MISSION_ROOT>/02_review_notes.md`
- `<MISSION_ROOT>/99_final_report.md`

Execution instructions:
1. Bind the mission root and create `00_run_binding.md`.
2. Create `01_artifact_under_review.md` with a short artifact to review.
3. Perform review and validation using direct mission-root evidence.
4. Repo-level probes such as `git.status`, `git.diff`, or broad workspace diagnostics are optional for this mission.
5. If any optional probe fails, continue with remaining artifact evidence and record the degradation in `02_review_notes.md`.

Safety boundaries:
- do not modify repo source files
- do not treat repo-level git evidence as required for this mission
- do not block solely because an optional probe fails

Success criteria:
- direct artifact evidence is enough to complete the mission
- any failed optional probe is treated as degradation, not a hard blocker
- final report explicitly states whether degraded evidence was used

Preferred final response format:
- resolved mission root
- optional probe attempted: yes/no
- optional probe failure handled without block: yes/no
- final verdict
- exact path to `99_final_report.md`
