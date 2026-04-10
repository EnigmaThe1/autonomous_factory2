## Fixture runbook (real-life extension testing)

### Prereqs

- Open the extension project in Cursor/VS Code.
- Start an **Extension Development Host** (F5 / Run Extension).

### Run a fixture

1. In the dev host window, **File → Open Folder…**
2. Pick one fixture folder under `autonomous_factory/fixtures/`:
   - `missing-artifact/`
   - `approval-flow/`
   - `timeout-heavy/`
3. Open `MISSION_PROMPT.md` in that fixture.
4. Start a mission and paste the prompt.
5. Observe behavior using:
   - Missions (status + Resume UI)
   - Timeline (ground truth)
   - Approvals (pending items)

### What to record when something fails

- The mission id and title
- Timeline lines around the failure (tool result + orchestrator line)
- Whether Approvals tab had pending items
- Your key settings:
  - `myAi.tools.requireApprovalForWrite`
  - `myAi.tools.requireApprovalForTerminal`
  - `myAi.tools.requireApprovalForNonImplementerMutations`
  - `myAi.providers.requestTimeoutMs`

