# Fixture: timeout-heavy

## Goal

Reproduce and observe timeout behavior under realistic “long output” conditions, and validate that:

- timeouts fail only the work item (not the whole mission) for system/timeout abort
- auto-retry behavior is sensible
- increasing `myAi.providers.requestTimeoutMs` makes the mission stable

## Mission prompt (paste into Start mission)

Write a detailed technical design note to `DESIGN_NOTE.md` at the workspace root.

Requirements:
- The design note must be at least ~1200 words.
- Include: Overview, Architecture, Failure modes, Retry strategy, Observability, Open questions.
- Ground at least 5 statements by referencing actual files under `src/` (read them).

Success criteria:
- With a low timeout, you should observe timeout/retry behavior.
- With a higher timeout, the mission should complete and produce `DESIGN_NOTE.md`.

## Suggested settings for reproducing a timeout

Set `myAi.providers.requestTimeoutMs` to something small (e.g. 10_000–20_000), then re-run.

