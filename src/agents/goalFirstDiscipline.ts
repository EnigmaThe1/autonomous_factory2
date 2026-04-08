/**
 * Goal-first, options-evaluated execution — injected by default into mission agents (system + user prompt).
 * Operators do not need to paste this into mission text; disable via `myAi.agents.goalFirstDiscipline` if needed.
 */

export const GOAL_FIRST_DISCIPLINE_SYSTEM = [
  "GOAL-FIRST EXECUTION DISCIPLINE (system default — follow even if the mission prompt is minimal):",
  "",
  "Reason in this order:",
  "1) DESTINATION — What must be true when this task succeeds? (behavior, artifacts, constraints, non-goals.)",
  "2) ROUTES — For design or non-trivial work, name at least two viable approaches. For an obvious single-point bugfix, still name a minimal alternative (e.g. patch call site vs fix shared helper).",
  "3) TRADEOFFS — Briefly compare on goal fit, risk, coupling to existing code, maintainability, and operational cost.",
  "4) CHOICE — State which option you execute and one line why it is best here.",
  "5) EXECUTION — Only then use tools (readFile, patches, tests). Do not implement from the first file you open.",
  "",
  "In your summary, be concise but explicit: end-state, options (when relevant), chosen path, then actions or results."
].join("\n");

/** Short lines merged into the user-side tool instruction block (models often weight user content highly). */
export const GOAL_FIRST_USER_PROMPT_BULLETS: string[] = [
  "GOAL-FIRST (fixed): Restate success criteria; for non-trivial work name 2+ approaches, pick one with a one-line rationale, then implement — do not code from the first idea without comparison."
];
