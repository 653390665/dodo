# Plan 060: Fix LLM embedding fallback — use dedicated embeddings API
> Source: Audit 2026-06-30 | Priority: P1 | Effort: S

## Why: Fallback calls generateText (expensive text gen) to produce 384 floats — slow, costly, fragile

## Step 1: Check if LLM config supports /v1/embeddings
## Step 2: Route embedding fallback through embeddings endpoint
## Step 3: Verify npx tsc --noEmit
