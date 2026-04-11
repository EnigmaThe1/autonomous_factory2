Treat this prompt as the authoritative task contract for this mission. Do not treat prior chat, summaries, scratch notes, or generic heuristics as higher authority than this prompt.

You are working inside the Autonomous Factory extension repository.

Mission id:
`mixed_docs_and_code`

Mission family:
Mixed mission

Primary objective:
Verify that a mission with both artifact work and bounded code change uses different evidence strategies at the correct times.

What the orchestrator is supposed to prove:
- docs phases rely on mission-root artifact evidence
- code phases rely on direct source/test evidence and validation
- review and validation do not confuse the two scopes

Default mission root candidate:
`.tmp/af_regression_runs/mixed_docs_and_code/`

Allowed write scope:
- mission root under `.tmp/af_regression_runs/...`
- one bounded change under `src/test/**`

Execution phases:

Phase 0:
- bind the mission root
- create `<MISSION_ROOT>/00_run_binding.md`
- create `<MISSION_ROOT>/01_plan.md`

Phase 1:
- make one bounded change under `src/test/**`
- create `<MISSION_ROOT>/02_change_note.md`

Phase 2:
- review both the mission-root artifacts and the bounded code change
- create `<MISSION_ROOT>/03_review.md`

Phase 3:
- validate with evidence appropriate to the code change
- create `<MISSION_ROOT>/99_final_report.md`

Safety boundaries:
- do not modify runtime orchestration code
- do not treat docs-only evidence as enough for code validation
- do not require repo-wide git evidence unless the specific code review truly needs it

Success criteria:
- docs phases stay artifact-scoped
- code phases use direct code and validation evidence
- final review clearly separates artifact evidence from code evidence

Preferred final response format:
- resolved mission root
- code files changed
- mission-root artifacts created
- validation evidence used
- final verdict
