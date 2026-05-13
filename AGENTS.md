# InkFlow Repository Instructions

## Scope
- This file defines repository-local working rules for `/Users/Zhuanz/Documents/dodo-inkflow`.
- Keep machine-wide preferences in `~/.codex/AGENTS.md`.

## Workflow
- Start with read-only analysis when the project or requirement is unclear.
- Inspect the relevant code before editing and summarize the intended change.
- Keep diffs small, reviewable, and easy to roll back.
- Prefer one scoped task at a time instead of multi-feature rewrites.
- Preserve the existing React + TypeScript + Vite + Express + SQLite architecture unless there is a clear reason to change it.

## Karpathy Coding Guidelines
- Apply these guidelines by default when writing, reviewing, or refactoring code in this repository.
- Think before coding: state assumptions, surface ambiguity, and ask when a risky choice cannot be inferred.
- Prefer simplicity: implement only what was requested, avoid speculative features, and do not add abstractions for one-off code.
- Make surgical changes: touch only files and lines needed for the task, preserve existing style, and do not clean up unrelated code.
- Use goal-driven execution: define a verifiable success condition for non-trivial changes and loop until the relevant check passes or the blocker is clear.
- Every changed line should trace back to the user's request or to validation required by that request.

## Safety
- Do not modify secrets, shell profiles, system settings, SSH config, or Git remotes.
- Do not change migrations, infrastructure, deployment settings, or destructive scripts without explicit approval.
- Do not add dependencies without approval.
- Do not disable sandboxing, bypass approvals, or enable network access for this repository without explicit approval.

## Validation
- Add or update tests when behavior changes.
- Run the smallest relevant validation after edits.
- If project metadata is incomplete, inspect the repository and infer the real commands before making changes.

## Output
- Communicate in Chinese unless the user explicitly asks otherwise.
- For non-trivial changes, report:
  1. Summary of changes
  2. Files changed
  3. Validation performed
  4. Risks or follow-up work
