#!/bin/bash
# Pre-commit guard: typecheck + lint staged TS/TSX files.
# Install: cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
# Bypass with: git commit --no-verify
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' || true)

if [ -n "$STAGED_TS" ]; then
  echo "[pre-commit] linting staged TS/TSX files..."
  npx eslint $STAGED_TS --max-warnings=0
fi

echo "[pre-commit] typecheck..."
npm run typecheck

echo "[pre-commit] OK"