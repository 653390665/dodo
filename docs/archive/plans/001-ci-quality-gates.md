# Plan 001: CI Quality Gates
> Commit: fcb3b9b | Status: TODO | Blocks: None

## Finding
CI only runs build/package, no lint/typecheck/test. This allows type errors and lint violations to reach production.

## Goal
Add quality gates to CI by running type checking and linting before build jobs.

## Files
- Modify: `.github/workflows/build.yml` — add `check` job and dependencies

## Steps
### Step 1: Add check job to workflow
- Action: In `.github/workflows/build.yml`, add a new job named `check` that runs on ubuntu-latest with steps:
  1. Checkout code
  2. Setup Node.js
  3. Install dependencies (`npm ci`)
  4. Run type checking (`npm run typecheck`)
  5. Run linting (`npm run lint`)
- Verify: `yamllint .github/workflows/build.yml` passes (or manual YAML validation)

### Step 2: Add dependencies to build jobs
- Action: In the same file, add `needs: [check]` to both the `mac` and `win` build jobs so they only run after the check job passes.
- Verify: `grep -A 5 "needs:" .github/workflows/build.yml` shows both jobs depend on `check`

### Step 3: Test the workflow locally (optional)
- Action: Use `act` or similar tool to simulate CI run locally, or push to a test branch.
- Verify: CI runs `check` job first, then `mac` and `win` jobs in parallel.

## Done Criteria
- [ ] `.github/workflows/build.yml` contains a `check` job that runs `npm run typecheck && npm run lint`
- [ ] Both `mac` and `win` jobs have `needs: [check]`
- [ ] YAML is valid and workflow runs successfully in CI

## STOP Conditions
- If `npm run typecheck` or `npm run lint` commands don't exist in package.json, stop and report missing scripts.
- If the workflow file has unexpected structure that can't be safely modified, stop and report.
- If adding the check job breaks existing CI triggers or matrix strategies, stop and report.