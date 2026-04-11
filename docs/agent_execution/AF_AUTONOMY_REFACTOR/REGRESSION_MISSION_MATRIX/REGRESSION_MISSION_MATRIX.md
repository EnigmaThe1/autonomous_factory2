# AF regression mission matrix

## Purpose

This matrix provides a reusable, execution-grade mission pack for systematically testing the Autonomous Factory extension across common mission shapes, failure modes, and autonomy-quality decisions.

The intent is not just to see whether a mission "finishes." The intent is to verify whether the orchestrator makes good decisions about:

- root binding
- deliverable discipline
- tool necessity
- evidence sufficiency
- recovery quality
- boundary safety
- pass continuity
- operator clarity

Each mission in this pack is designed to be pasted directly into the extension as a standalone mission prompt.

## Testing philosophy

The matrix is built around a few principles:

1. Test mission behavior, not only final status.
2. Prefer bounded, high-signal missions over huge endurance prompts.
3. Make failure signatures legible enough that operators can score decision quality, not just outcome.
4. Keep missions non-destructive by default.
5. Make every mission self-contained so operators do not need to prepend extra rules blocks manually.

## Mission families

The first canonical matrix covers five families:

1. Workspace artifact missions
   - verify mission-root creation, scoped artifact work, and deliverable timing
2. Source-code change missions
   - verify bounded code changes, review evidence, and validation obligations
3. Mixed missions
   - verify phase-sensitive evidence strategy when docs and code both matter
4. Failure-injection missions
   - verify optional-probe degradation, validation failure handling, and boundary gating
5. Long-run resilience missions
   - verify multi-pass continuity, step-cap chaining, and operator-facing coherence

## Minimum first matrix

Recommended first-pass mission order:

1. `workspace_artifact_simple`
2. `workspace_artifact_phase_scoped`
3. `workspace_artifact_optional_probe_failure`
4. `code_change_bounded`
5. `code_change_required_validation_failure`
6. `protected_path_boundary`
7. `mixed_docs_and_code`
8. `long_run_step_cap_chain`

Mission files live under:

- `docs/agent_execution/AF_AUTONOMY_REFACTOR/REGRESSION_MISSION_MATRIX/missions/`

## Scoring dimensions

Each mission should be scored against these dimensions:

1. Root binding
   - Did the mission bind one canonical output root and keep using it consistently?
2. Deliverable discipline
   - Were output-producing steps backed by real on-disk artifacts before they were treated as complete?
3. Tool necessity judgment
   - Did reviewer / validator behavior distinguish required probes from optional context?
4. Evidence sufficiency
   - Did the system ask whether enough evidence already existed before blocking?
5. Recovery quality
   - When something failed, did the system degrade, continue, retry, or replan appropriately?
6. Boundary safety
   - Were protected paths, outside-workspace boundaries, and approval gates respected?
7. Pass continuity
   - Did multi-step or long-running work survive pass limits cleanly and honestly?
8. Operator clarity
   - Could an operator understand what happened from the inspector, timeline, and final summary?

## How to run the missions

1. Pick one mission file from `missions/`.
2. Open the file and copy the full contents.
3. Paste the full prompt into a new mission in the extension.
4. Let the mission run to a stable endpoint:
   - `completed`
   - `blocked`
   - `awaiting_input`
   - `failed`
5. Score the mission using `REGRESSION_RESULT_SHEET_TEMPLATE.md`.
6. Compare the observed behavior against `REGRESSION_TRACEABILITY.md`.

## How to score them

Use the result sheet template for every run.

Recommended scoring convention:

- `PASS`
- `SOFT FAIL`
  - behavior was recoverable or understandable, but not ideal
- `HARD FAIL`
  - behavior violated the mission contract or a safety / decision-quality expectation
- `N/A`
  - dimension was not meaningfully exercised by the run

## Interpreting failures

Common patterns:

1. Root binding failures
   - multiple roots
   - drifting back to default paths
2. Deliverable discipline failures
   - implementer reaches `done` without expected outputs
3. Tool necessity failures
   - optional probes block artifact-only work
4. Evidence sufficiency failures
   - reviewer / validator block despite already having enough scoped evidence
5. Recovery failures
   - repeated blind retries
   - blocking where replan was more appropriate
6. Boundary failures
   - protected path write goes through without the expected gate
7. Pass continuity failures
   - long missions lose state or misreport progress across bounded passes
8. Operator clarity failures
   - mission outcome is technically correct but hard to interpret from timeline / inspector evidence

## Operator workflow

Use these files together:

- `REGRESSION_OPERATOR_GUIDE.md`
- `REGRESSION_RESULT_SHEET_TEMPLATE.md`
- `REGRESSION_TRACEABILITY.md`
- `missions/*.md`
