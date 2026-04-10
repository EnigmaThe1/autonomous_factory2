# Extension guidance principles

**Audience:** Operators, contributors, and anyone mapping workspace **Cursor rules** to the **Autonomous Factory** extension.

**Purpose:** Portable **behavioral** guidance — not a file-format prescription. For a technical rules-vs-code gap analysis, see [RULES_GAP_ANALYSIS.md](./RULES_GAP_ANALYSIS.md).

**Last updated:** 2026-04-10

**Extension behavior:** Mission agents receive `EXTENSION_MISSION_DISCIPLINE_RULES` in the system prompt (`src/agents/extensionToolHardRules.ts` → `BaseAgent`). New missions record a **start baseline** (memory + event). Validators may emit `VALIDATION_VERDICT:` / `VALIDATION_LIMITS:` lines; those persist on the mission and appear in generated mission reports.

---

## Persistence: structured state is enough

The extension keeps mission truth in **structured persistence** (e.g. mission JSON under workspace data). That satisfies the *intent* of “record the mission” as long as these **classes of information** survive restarts:

- Intent, queue, statuses, blockers, risky in-flight tools, events, memory, checkpoints, closure/validation policy.

**Markdown trees** under fixed repo paths (as often illustrated in `.cursor/rules`) are **one encoding**, not a requirement. **JSON fields, exports, or agent-written files** are all valid as long as the information exists and is discoverable.

**Git commits per task** are optional team practice. The extension’s default rollback spine is **mission state + operator resume**, not VCS.

---

## 1. What to record (durable record checklist)

| Concern | Principle | Extension today (examples) |
|--------|-----------|----------------------------|
| **Intent** | Mission prompt + plan survive restarts | `Mission.prompt`, memory items, blueprint JSON |
| **Work breakdown** | Ordered / DAG work with stable IDs | `WorkItem.id`, `dependsOn`, `blueprintStepId` |
| **Progress truth** | Status matches reality | `WorkItem.status`, `Mission.status`, `blockReasonCode` |
| **Blockers** | Why stopped + what to do next | `blocker`, events, work item `output` |
| **Risky work** | Know what might have partially run | `activeMutatingToolCall`, approval flags |
| **Audit trail** | Timeline of orchestrator + tools | `events`, tool-result memory, checkpoints |
| **Closure** | “Done” only when policy satisfied | Closure policy, validation state |

If your team cares about a row on the left, ensure it has a **store field, export, or deliberate artifact** — format is your choice.

---

## 2. Recoverability (non-negotiable spine)

- **Protect:** Model access, tool execution, mission persistence, resume, visible history.
- **Never silently replay** mutating work when side effects may already have happened; **require manual review** when uncertain.
- **Prefer** enough metadata (e.g. `runCommand` text) to separate **read-only probes** from **mutating** commands after interruption.

These principles are **path-agnostic**; they describe how the product should behave.

---

## 3. AI-native bounded autonomy

- **Encode in software:** Permissions, approvals, policy presets, validation gates, rate limits, mutating markers, dry-run.
- **Do not encode:** Every reasoning step, fixed tool order, or full recovery script for all cases.
- **Let the model** plan and choose tools **inside** those boundaries.

---

## 4. Scope and change control (shape, not filepath)

In prompts and blueprints, make explicit:

- **In scope** — what this step may touch.
- **Out of scope** — what must not change.
- **Proof** — what demonstrates success.

Optional future **structured fields** on work items would only formalize what you already want in prose.

---

## 5. Validation and honesty

- Do not imply **complete success** while required work is **blocked** or **unvalidated**.
- Reports should admit **limits** (what was not tested) when true.
- Verdict vocabulary (e.g. PASS / PASS WITH LIMITS / BLOCKED) can live in **report text or JSON** — same meaning, any encoding.

---

## 6. Long-horizon work (programs, waves, roadmaps)

- Treat waves, program boards, and roadmaps as **governance concepts**, not as mandates for specific markdown filenames.
- Represent them with **mission memory, tags, linked missions, or future product fields** (e.g. `programId`) as needed.
- Avoid hard-coding repository paths for “the program board” unless your team chooses that convention.

---

## 7. What not to import literally from `.cursor/rules`

Do **not** treat these as **extension product requirements**:

- Specific folders (e.g. `docs/agent_execution/<slug>/`) or filenames (`IMPLEMENTATION_LEDGER.md`, `PHASE_BOARD.md`, …).
- **Git commit after every task** unless you add that integration yourself.
- Exact markdown templates — **equivalent information** in mission store + export matches the underlying intent.

Use those rule files as **guidance for agents and humans**, adapted to how Autonomous Factory actually persists and runs missions.

---

## 8. Re-ground in the system after any plan shift

After a **detour**, **re-plan**, **new sub-goal**, **long pause**, **resume**, or any moment the “current plan” changed, do **not** jump straight to new edits.

**Before the next meaningful code change:**

1. **Re-read** enough of the real code to restore truth: follow the flow from entrypoint through the subsystem you will change (orchestrator, store, tools, webview), and widen the read until behavior is clear — **not** only the last file you edited.
2. **Reconcile** what actually changed: recent diffs, prior commits, or behavior you observed at runtime — so you are not assuming an old layout.
3. **Trace blast radius** — how the next edit affects callers, persistence shape, policy, and UI — then make the **smallest** change that fits the real system.

Blindly appending lines on top of a stale picture produces drift, duplicate paths, and fixes that miss the real bug. **Planning and re-planning reset the obligation to understand the codebase again.**

---

## Related

- [RULES_GAP_ANALYSIS.md](./RULES_GAP_ANALYSIS.md) — rule clusters vs implementation, partial gaps, recommendations.
- [MYAI_SETTINGS_INVENTORY.md](./MYAI_SETTINGS_INVENTORY.md) — configuration surface.
