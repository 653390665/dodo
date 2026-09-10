#!/bin/bash
# Pre-commit guard: typecheck + lint staged TS/TSX files.
# Install: automatic via `npm run prepare` (copies this file to .git/hooks/pre-commit);
# manual fallback: cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
# Bypass with: git commit --no-verify
# NOTE: calls node_modules binaries via `node` directly (no npx/npm) so the gate
# still works when the global npm installation is broken.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

ESLINT="./node_modules/eslint/bin/eslint.js"
TSC="./node_modules/typescript/bin/tsc"
[ -x "$ESLINT" ] || { echo "[pre-commit] node_modules missing"; exit 1; }
[ -x "$TSC" ] || { echo "[pre-commit] node_modules missing"; exit 1; }

STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' || true)

if [ -n "$STAGED_TS" ]; then
  echo "[pre-commit] linting staged TS/TSX files..."
  node "$ESLINT" $STAGED_TS --max-warnings=0
fi

echo "[pre-commit] typecheck..."
node "$TSC" --noEmit

echo "[pre-commit] OK"
