# Fixture: approval-flow

## Goal

Validate end-to-end approval pausing and resuming in a realistic mission:

- mission pauses to request approval for a write
- Approvals tab shows the pending item
- approving continues the mission without replay bugs or stale UI

## Mission prompt (paste into Start mission)

Create a file `OUTPUT.txt` at the workspace root with:

- a short greeting line
- a second line that lists the files in `src/` you inspected (names only)

Rules:
- Use tools to inspect the workspace (`listFiles`/`fileTree`/`readFile`) before writing.
- Write the file in one shot.

Success criteria:
- The mission pauses for approval (if write approvals are enabled).
- After approval, `OUTPUT.txt` is created and mission completes.

