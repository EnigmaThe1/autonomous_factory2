/**
 * Canonical workspace/tool rules injected by the extension into agent prompts.
 * Operators should not need to repeat path-discovery guidance in mission text.
 */

/** Full block for mission agents (system prompt, all roles using BaseAgent). */
export const EXTENSION_TOOL_HARD_RULES_MISSION = [
  "WORKSPACE & TOOL RULES (extension-enforced defaults — follow even if the mission text omits them):",
  "",
  "1) Paths: readFile/writeFile/applyPatch use paths relative to the workspace root, or absolute paths under that workspace. Do not invent paths outside the open workspace.",
  "",
  "2) Case sensitivity: On Linux and typical CI, file names are case-sensitive. If readFile fails, obtain exact spelling from fileTree, listFiles, or grepSearch — do not retry the same wrong casing.",
  "",
  "3) Discovery before blind reads: When unsure of location, run fileTree, listFiles, or grepSearch (basename, class, or symbol) before readFile.",
  "",
  "4) suggestedPaths: When readFile returns ok:false with suggestedPaths in data, your next readFile MUST use one of those workspace-relative paths (or run grepSearch to disambiguate).",
  "",
  "5) Project shape: Do not assume pyproject.toml, docker-compose.yml, or other manifests exist. Infer stack from files that exist (package.json, go.mod, Cargo.toml, etc.) via fileTree or listFiles.",
  "",
  "6) Tool failures: readFile and other tools return structured ok:false results; the mission may continue. Read the summary and data, then correct your approach — do not treat a missing file as a host crash.",
  "",
  "7) Missing output artifacts: If readFile fails with FileNotFound for an expected deliverable (e.g. report/plan/notes markdown), you should create the file via writeFile and include meaningful initial content (title + section headings + any known progress). Do NOT create an empty placeholder file just to satisfy existence.",
  "",
  "8) runLinter: When output is ESLint JSON with 0 errors and 0 warnings, the extension may treat the run as passing even if the process exit code is non-zero; trust the reported error/warning counts."
].join("\n");

/** Mission discipline aligned with extension guidance: re-ground after plan changes, scope, honest validation. */
export const EXTENSION_MISSION_DISCIPLINE_RULES = [
  "MISSION DISCIPLINE (extension defaults — follow on every task):",
  "",
  "1) After a replan, detour, or change of approach: re-read enough of the real codebase to restore an accurate picture (entrypoints and flow for what you will touch), not only the last file edited — then make the smallest change that fits the actual system.",
  "",
  "2) For non-trivial work, be explicit about in-scope vs out-of-scope and what would count as proof of success (in narrative, plans, or MEMORY).",
  "",
  "3) Do not claim full success or PASS unless evidence supports it; if validation is partial, say so honestly.",
  "",
  "4) Validators may optionally add two single lines at the end of the response: VALIDATION_VERDICT: <e.g. PASS | PASS_WITH_LIMITS | BLOCKED | PENDING — brief reason> and VALIDATION_LIMITS: <what was not verified, or \"none\">."
].join("\n");

/** Shorter block for sidebar chat (no TOOL lines; still sets path expectations). */
export const EXTENSION_CHAT_WORKSPACE_RULES = [
  "Workspace context: file paths are relative to the open workspace folder; on this OS file names are usually case-sensitive.",
  "If you need a file path you do not know, ask the user or describe how to find it in the explorer — do not guess absolute paths outside the workspace."
].join("\n");

/** Repeated in the user-side tool prompt so models that weight user content higher still see the rules. */
export const EXTENSION_TOOL_USER_PROMPT_BULLETS = [
  "WORKSPACE/TOOL RULES (fixed): paths are workspace-relative; names are case-sensitive; use fileTree/listFiles/grepSearch before guessing readFile targets.",
  "If readFile fails, read data.suggestedPaths and retry with one of those paths when present.",
  "If readFile fails with FileNotFound for an expected deliverable artifact, create it with writeFile and meaningful content — do not create an empty placeholder.",
  "Do not assume pyproject.toml, docker-compose.yml, etc.; detect the stack from files that actually exist."
];
