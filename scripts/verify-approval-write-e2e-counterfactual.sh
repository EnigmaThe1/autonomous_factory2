#!/usr/bin/env bash
# Route A: same E2E regression as fixed tree, compiled on a known pre-fix commit when one is
# reachable in this repository lineage. Some clones of this repo were bootstrapped with a stale
# legacy SHA pair (5652877 / 9791601) copied from an earlier history; when that commit is absent,
# skip the historical checkout and verify the fixed tree only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LEGACY_PRE_FIX_SHA="5652877d0ff056a2fc849c2ffdac23c3b42216c7"
E2E_TS="src/test/missionToolRegistryWriteApprovalE2e.test.ts"
E2E_JS="dist/test/missionToolRegistryWriteApprovalE2e.test.js"

resolve_pre_fix_sha() {
  local override="${PRE_FIX_SHA_OVERRIDE:-}"
  if [[ -n "$override" ]]; then
    if git cat-file -e "${override}^{commit}" 2>/dev/null; then
      printf '%s\n' "$override"
      return 0
    fi
    echo "verify-approval-write-e2e-counterfactual: PRE_FIX_SHA_OVERRIDE is not a reachable commit: $override" >&2
    exit 2
  fi

  if git cat-file -e "${LEGACY_PRE_FIX_SHA}^{commit}" 2>/dev/null; then
    printf '%s\n' "$LEGACY_PRE_FIX_SHA"
    return 0
  fi

  return 1
}

PRE_FIX_SHA=""
RUN_HISTORICAL=0
if PRE_FIX_SHA="$(resolve_pre_fix_sha)"; then
  RUN_HISTORICAL=1
fi

if [[ "$RUN_HISTORICAL" -eq 1 ]]; then
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo "verify-approval-write-e2e-counterfactual: working tree must be clean (commit or stash)." >&2
    exit 2
  fi
fi

FIXED_REF="$(git rev-parse HEAD)"
FIXED_BRANCH="$(git symbolic-ref -q --short HEAD || true)"
SNAP="$(mktemp)"
trap 'rm -f "$SNAP"' EXIT

git show "$FIXED_REF:$E2E_TS" >"$SNAP"

if [[ "$RUN_HISTORICAL" -eq 1 ]]; then
  git checkout "$PRE_FIX_SHA" --quiet
  cp "$SNAP" "$ROOT/$E2E_TS"
  npm run compile -s
  set +e
  node --require ./scripts/vscode-test-shim.cjs --test "$E2E_JS"
  pre_exit=$?
  set -e
  if [[ "$pre_exit" -eq 0 ]]; then
    echo "verify-approval-write-e2e-counterfactual: expected FAILURE on pre-fix $PRE_FIX_SHA, got pass." >&2
    rm -f "$E2E_JS" "${E2E_JS}.map" 2>/dev/null || true
    rm -f "$ROOT/$E2E_TS"
    git checkout "${FIXED_BRANCH:-$FIXED_REF}" --quiet
    exit 1
  fi
  echo "verify-approval-write-e2e-counterfactual: pre-fix run failed as expected (exit $pre_exit)."

  rm -f "$E2E_JS" "${E2E_JS}.map" 2>/dev/null || true
  rm -f "$ROOT/$E2E_TS"
  git checkout "${FIXED_BRANCH:-$FIXED_REF}" --quiet
else
  echo "verify-approval-write-e2e-counterfactual: legacy pre-fix SHA $LEGACY_PRE_FIX_SHA is not reachable in this repository lineage; skipping historical checkout. Set PRE_FIX_SHA_OVERRIDE to a reachable commit to force the counterfactual run."
fi

npm run compile -s
node --require ./scripts/vscode-test-shim.cjs --test "$E2E_JS"
if [[ "$RUN_HISTORICAL" -eq 1 ]]; then
  echo "verify-approval-write-e2e-counterfactual: fixed tree PASS."
else
  echo "verify-approval-write-e2e-counterfactual: fixed tree PASS (historical counterfactual skipped)."
fi
