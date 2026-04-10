# Fixture: missing-artifact

## Goal

Validate that when a mission **requires an artifact** and it is missing (e.g. `readFile` returns FileNotFound),
the mission does **not** dead-end into a blocked state. The agent should **create/populate** the artifact using
mission context and continue.

## Mission prompt (paste into Start mission)

You are writing an audit-style report for this workspace.

Requirements:
- The canonical output artifact is `AUDIT_REPORT.md` at the workspace root.
- If `AUDIT_REPORT.md` does not exist, create it with **meaningful content** (not an empty placeholder).
- The report must include at least:
  - Title
  - Summary
  - Findings (bulleted)
  - Test plan / validation notes
  - Open questions / next steps
- Use tools to read the project files under `src/` to ground the findings.
- Update `AUDIT_REPORT.md` as you learn new facts. Keep it coherent and operator-readable.

Success criteria:
- `AUDIT_REPORT.md` exists and contains real content tied to files in this fixture.
- Mission does not get stuck on a missing readFile.

## Expected behavior

- The agent may attempt `readFile AUDIT_REPORT.md` first.
- If missing, the agent should write it (with content) and proceed, without requiring operator hand-fixes.

