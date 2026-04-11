Treat this prompt as the authoritative task contract for this mission. Do not treat prior chat, summaries, scratch notes, or generic heuristics as higher authority than this prompt.

You are working inside the Autonomous Factory extension repository.

Mission id:
`long_run_step_cap_chain`

Mission family:
Long-run resilience mission

Primary objective:
Verify that a longer bounded mission can continue coherently across multiple passes when step limits are encountered.

What the orchestrator is supposed to prove:
- pass continuity across bounded run loops
- no misleading completion claims between passes
- no duplicate or forgotten work when the mission resumes

Default mission root candidate:
`.tmp/af_regression_runs/long_run_step_cap_chain/`

Required work:
- create a chained artifact set of at least 10 files under the mission root
- each file should represent a small bounded stage of progress
- include:
  - `00_run_binding.md`
  - `01_plan.md`
  - `02_step_01.md`
  - `03_step_02.md`
  - `04_step_03.md`
  - `05_step_04.md`
  - `06_step_05.md`
  - `07_review.md`
  - `08_validation.md`
  - `99_final_report.md`

Execution style requirement:
- prefer multiple bounded steps over one giant shell script
- preserve continuity and summary accuracy if the mission spans multiple autonomous passes

Safety boundaries:
- keep all writes inside the resolved mission root
- do not claim completion until all required files exist
- if a pass cap is hit, preserve honest progress and continue cleanly on the next pass

Success criteria:
- the mission remains coherent across multiple passes if needed
- no duplicate conflicting artifacts are created
- final report accurately summarizes whether multi-pass continuity held

Preferred final response format:
- resolved mission root
- total required files created
- whether multiple passes were needed
- continuity verdict
- exact path to `99_final_report.md`
