/**
 * Narrow, deterministic applyPatch no-op detection when the search string is absent but the
 * intended replacement text is already in the file (stale search / prior edit).
 *
 * Supported class only:
 * - Single-shot `String.prototype.replace` semantics (first match only) — caller already knows
 *   `text.replace(search, replace) === text`.
 * - `search` is non-empty and does not occur in the file (true search miss).
 * - `replace` is non-whitespace-only and has UTF-16 length ≥ {@link APPLY_PATCH_NOOP_REPLACE_MIN_LEN}.
 * - The file contains `replace` as an exact substring (same bytes as the tool argument; no
 *   normalization or fuzzy match).
 *
 * Explicitly unsupported (still a normal failure):
 * - Semantic equivalence, reordered lines, whitespace-normalized matches.
 * - Empty `search` / `replace` or very short `replace` (ambiguous substring hits).
 * - Cases where `search` still appears in the file but `replace` equals `search` (identity edit).
 */

/** Minimum replace length so trivial substrings (e.g. `a`, `return`) do not yield false no-ops. */
export const APPLY_PATCH_NOOP_REPLACE_MIN_LEN = 12;

export function isApplyPatchNoopBecauseReplaceAlreadyPresent(
  fileText: string,
  search: string,
  replace: string
): boolean {
  if (!search) return false;
  if (fileText.includes(search)) return false;
  if (replace.trim().length < APPLY_PATCH_NOOP_REPLACE_MIN_LEN) return false;
  return fileText.includes(replace);
}

/**
 * After a successful tool round, set work-item `completionKind: "apply_patch_noop"` only when at
 * least one applyPatch was a deterministic no-op and no mutating write (writeFile or real patch)
 * occurred in the same round. readFile / listFiles / etc. do not affect this.
 */
export function workCompletionKindFromSuccessfulToolSteps(
  steps: ReadonlyArray<{ tool: string; applyPatchNoop?: boolean }>
): "apply_patch_noop" | undefined {
  let hadMutating = false;
  let hadApplyPatchNoop = false;
  for (const s of steps) {
    if (s.tool === "writeFile") hadMutating = true;
    else if (s.tool === "applyPatch") {
      if (s.applyPatchNoop) hadApplyPatchNoop = true;
      else hadMutating = true;
    }
  }
  return hadApplyPatchNoop && !hadMutating ? "apply_patch_noop" : undefined;
}
