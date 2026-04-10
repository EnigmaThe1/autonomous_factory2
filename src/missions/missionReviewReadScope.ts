/**
 * Phase/deliverable-scoped read allowlist for reviewer and validator readFile probes.
 * Prevents ENOENT churn on future-phase filenames when the full mission prompt lists end-state artifacts.
 */

import type { Mission, WorkItem } from "../types";

export type ReviewReadScopeDecision =
  | { mode: "off" }
  | { mode: "enforce"; allowedPaths: Set<string> };

const PATH_LIKE =
  /(?:^|[\s`'"(])((?:\.?\/)?[\w./-]+\.(?:md|txt|json|ts|tsx|py|yaml|yml|toml))(?:\b|$)/gi;

/** Normalize workspace-relative path for comparison; rejects traversal. */
export function normalizeWorkspaceRelPath(p: string): string | undefined {
  const s = String(p || "").trim().replace(/\\/g, "/");
  if (!s || s.includes("..")) return undefined;
  return s.replace(/^\/+/, "") || undefined;
}

function addNormalized(target: Set<string>, raw: string): void {
  const n = normalizeWorkspaceRelPath(raw);
  if (n) target.add(n);
}

function collectPathLikeStrings(text: string | undefined, target: Set<string>, max = 40): void {
  if (!text?.trim()) return;
  let count = 0;
  PATH_LIKE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_LIKE.exec(text)) !== null && count < max) {
    addNormalized(target, m[1]);
    count += 1;
  }
}

/**
 * Build scope from mission + work item only (never the full mission.prompt).
 * When no scope signals exist, enforcement is off (backward compatible).
 */
export function buildReviewerValidatorReadScope(mission: Mission, item: WorkItem): ReviewReadScopeDecision {
  if (item.role !== "reviewer" && item.role !== "validator") {
    return { mode: "off" };
  }
  const allowedPaths = new Set<string>();
  for (const p of mission.filesModified || []) addNormalized(allowedPaths, p);
  for (const p of item.changedFiles || []) addNormalized(allowedPaths, p);
  collectPathLikeStrings(item.validationScopeHint, allowedPaths);
  collectPathLikeStrings(item.scopeSummary, allowedPaths);
  collectPathLikeStrings(item.validationHint, allowedPaths);
  collectPathLikeStrings(item.prompt?.slice(0, 6000), allowedPaths);
  if (allowedPaths.size === 0) {
    return { mode: "off" };
  }
  return { mode: "enforce", allowedPaths };
}

export function isReadPathAllowedInReviewScope(decision: ReviewReadScopeDecision, relPath: string | undefined): boolean {
  if (decision.mode === "off") return true;
  if (!relPath) return false;
  if (decision.allowedPaths.has(relPath)) return true;
  // Permit ancestor paths of an allowed file (e.g. reading a parent segment) but not arbitrary siblings.
  for (const p of decision.allowedPaths) {
    if (p.startsWith(`${relPath}/`)) return true;
  }
  return false;
}
