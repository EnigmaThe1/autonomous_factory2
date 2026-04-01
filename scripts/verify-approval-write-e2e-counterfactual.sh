#!/usr/bin/env bash
# Route A: same E2E regression as fixed tree, compiled on pre-fix 5652877 (parent of fix 9791601),
# must FAIL (mission completes without awaiting_input). Restores HEAD and must PASS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Parent of fix(tools): require in-workspace write approval by default
PRE_FIX_SHA="5652877d0ff056a2fc849c2ffdac23c3b42216c7"
E2E_TS="src/test/missionToolRegistryWriteApprovalE2e.test.ts"
E2E_JS="dist/test/missionToolRegistryWriteApprovalE2e.test.js"

if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "verify-approval-write-e2e-counterfactual: working tree must be clean (commit or stash)." >&2
  exit 2
fi

FIXED_REF="$(git rev-parse HEAD)"
FIXED_BRANCH="$(git symbolic-ref -q --short HEAD || true)"
SNAP="$(mktemp)"
trap 'rm -f "$SNAP"' EXIT

git show "$FIXED_REF:$E2E_TS" >"$SNAP"

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
npm run compile -s
node --require ./scripts/vscode-test-shim.cjs --test "$E2E_JS"
echo "verify-approval-write-e2e-counterfactual: fixed tree PASS."
