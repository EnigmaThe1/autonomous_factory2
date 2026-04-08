import * as vscode from "vscode";
import { runCommand } from "./CommandRunner";
import { trimText } from "../util";

export interface TestResult {
  ok: boolean;
  summary: string;
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  failures?: Array<{ test: string; message: string }>;
  rawOutput?: string;
}

interface FrameworkDetection {
  name: string;
  command: string;
}

function detectTestFramework(): FrameworkDetection | null {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) return null;

  try {
    const pkgUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "package.json");
    void pkgUri;
  } catch { /* ok */ }

  const candidates: FrameworkDetection[] = [
    { name: "npm-test", command: "npm test -- --reporter=json 2>&1 || npm test 2>&1" },
  ];

  return candidates[0];
}

export function parseTestOutput(raw: string): Partial<TestResult> {
  const lines = raw.split("\n");

  // TAP format (node:test)
  const tapTests = lines.filter((l) => l.match(/^(ok|not ok) \d+/));
  if (tapTests.length > 0) {
    const passed = tapTests.filter((l) => l.startsWith("ok ")).length;
    const failed = tapTests.filter((l) => l.startsWith("not ok ")).length;
    const failures = tapTests
      .filter((l) => l.startsWith("not ok "))
      .map((l) => ({ test: l.replace(/^not ok \d+ - /, "").trim(), message: "" }))
      .slice(0, 20);
    return { total: tapTests.length, passed, failed, skipped: 0, failures };
  }

  // Jest/Vitest format
  const jestSummary = raw.match(/Tests:\s+(\d+)\s+failed.*?(\d+)\s+passed.*?(\d+)\s+total/);
  if (jestSummary) {
    return {
      total: parseInt(jestSummary[3]),
      passed: parseInt(jestSummary[2]),
      failed: parseInt(jestSummary[1]),
      skipped: 0,
    };
  }

  // pytest format
  const pytestMatch = raw.match(/(\d+) passed(?:.*?(\d+) failed)?(?:.*?(\d+) skipped)?/);
  if (pytestMatch) {
    const passed = parseInt(pytestMatch[1]) || 0;
    const failed = parseInt(pytestMatch[2]) || 0;
    const skipped = parseInt(pytestMatch[3]) || 0;
    return { total: passed + failed + skipped, passed, failed, skipped };
  }

  // Go test format
  const goPass = (raw.match(/--- PASS/g) || []).length;
  const goFail = (raw.match(/--- FAIL/g) || []).length;
  if (goPass > 0 || goFail > 0) {
    return { total: goPass + goFail, passed: goPass, failed: goFail, skipped: 0 };
  }

  return {};
}

export async function runTests(opts?: { command?: string; cwd?: string; timeoutMs?: number }): Promise<TestResult> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cwd = opts?.cwd || workspaceRoot;
  if (!cwd) return { ok: false, summary: "No workspace open" };

  let command = opts?.command;
  if (!command) {
    const detected = detectTestFramework();
    if (!detected) return { ok: false, summary: "No test framework detected" };
    command = detected.command;
  }

  const result = await runCommand({
    command,
    cwd,
    timeoutMs: opts?.timeoutMs ?? 120_000,
    maxOutputBytes: 32_768,
  });

  const raw = `${result.stdout}\n${result.stderr}`.trim();
  const parsed = parseTestOutput(raw);

  const ok = result.exitCode === 0;
  const summary = parsed.total !== undefined
    ? `Tests: ${parsed.passed ?? 0} passed, ${parsed.failed ?? 0} failed, ${parsed.total} total (exit ${result.exitCode})`
    : `Test command ${ok ? "succeeded" : "failed"} (exit ${result.exitCode})`;

  return {
    ok,
    summary,
    total: parsed.total,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    failures: parsed.failures,
    rawOutput: trimText(raw, 8000),
  };
}

export interface LintResult {
  ok: boolean;
  summary: string;
  errorCount?: number;
  warningCount?: number;
  issues?: Array<{ file: string; line: number; rule: string; message: string; severity: string }>;
  rawOutput?: string;
}

/** Result of parsing linter stdout/stderr (see `parseLintOutput`). */
export type LintParseResult = Partial<LintResult> & {
  /** ESLint JSON array output vs loose line counting. */
  source?: "eslint-json" | "heuristic";
};

/** True when lint should be treated as passing (exit 0, or ESLint JSON reports zero errors and zero warnings). */
export function lintResultOk(exitCode: number, parsed: LintParseResult): boolean {
  if (exitCode === 0) return true;
  if (
    parsed.source === "eslint-json" &&
    (parsed.errorCount ?? 0) === 0 &&
    (parsed.warningCount ?? 0) === 0
  ) {
    return true;
  }
  return false;
}

function detectLinter(): string | null {
  return "npx eslint . --format json 2>&1 || npx eslint . 2>&1";
}

export function parseLintOutput(raw: string): LintParseResult {
  // ESLint JSON format
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      let errors = 0;
      let warnings = 0;
      const issues: LintResult["issues"] = [];
      for (const file of parsed) {
        errors += file.errorCount || 0;
        warnings += file.warningCount || 0;
        for (const msg of file.messages || []) {
          if (issues!.length < 50) {
            issues!.push({
              file: file.filePath || "",
              line: msg.line || 0,
              rule: msg.ruleId || "",
              message: msg.message || "",
              severity: msg.severity === 2 ? "error" : "warning",
            });
          }
        }
      }
      return { errorCount: errors, warningCount: warnings, issues, source: "eslint-json" };
    }
  } catch { /* not JSON — try line parsing */ }

  // Count error/warning lines
  const errorLines = (raw.match(/error/gi) || []).length;
  const warnLines = (raw.match(/warning/gi) || []).length;
  return { errorCount: errorLines, warningCount: warnLines, source: "heuristic" };
}

export async function runLinter(opts?: { command?: string; cwd?: string; timeoutMs?: number }): Promise<LintResult> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cwd = opts?.cwd || workspaceRoot;
  if (!cwd) return { ok: false, summary: "No workspace open" };

  let command = opts?.command;
  if (!command) {
    const detected = detectLinter();
    if (!detected) return { ok: false, summary: "No linter detected" };
    command = detected;
  }

  const result = await runCommand({
    command,
    cwd,
    timeoutMs: opts?.timeoutMs ?? 60_000,
    maxOutputBytes: 32_768,
  });

  const raw = `${result.stdout}\n${result.stderr}`.trim();
  const parsed = parseLintOutput(raw);
  const exitCode = result.exitCode ?? -1;
  const ok = lintResultOk(exitCode, parsed);

  let summary: string;
  if (parsed.errorCount !== undefined) {
    summary = `Lint: ${parsed.errorCount} error(s), ${parsed.warningCount ?? 0} warning(s)`;
    if (!ok) {
      summary += ` (exit ${exitCode})`;
    } else if (exitCode !== 0) {
      summary += ` (process exit ${exitCode}; ESLint JSON reports no issues — treated as pass)`;
    }
  } else {
    summary = `Lint command ${ok ? "passed" : "failed"} (exit ${exitCode})`;
  }

  return {
    ok,
    summary,
    errorCount: parsed.errorCount,
    warningCount: parsed.warningCount,
    issues: parsed.issues,
    rawOutput: trimText(raw, 6000),
  };
}
