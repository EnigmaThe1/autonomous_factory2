# Fixtures: real-life mission test workspaces

These folders are **tiny, purpose-built workspaces** you can open in an Extension Development Host to test:

- model reasoning (search vs. create vs. re-plan)
- mission loop behavior (planner → implementer → reviewer → validator)
- pause/block semantics (approvals, policy blocks, tool failures, timeouts)
- artifact creation and update (reports, notes, etc.)

## How to use

1. Run the extension in an **Extension Development Host** (F5).
2. In the dev host window, open one fixture folder (e.g. `fixtures/missing-artifact/`) as the workspace.
3. Start a mission using the prompt in that fixture’s `MISSION_PROMPT.md`.
4. Watch Missions / Timeline / Approvals for the expected behavior listed in that fixture.

## Fixture list

- `missing-artifact/`: required deliverable file does not exist at start; agent should create/populate it from mission context.
- `approval-flow/`: mission requires a write; should pause awaiting approval and resume cleanly after approval.
- `timeout-heavy/`: intentionally long output; tune `myAi.providers.requestTimeoutMs` to reproduce timeout vs. stable run.
- `closure-pending/`: mission tries to COMPLETE too early; closure policy should inject required tranches instead of silently completing.

