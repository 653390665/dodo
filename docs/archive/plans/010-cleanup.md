# Plan 010: Cleanup — remove tmp-server.cjs, empty dirs, npm audit
> Commit: ca53899 | Status: TODO

## Finding
Three low-effort cleanup items:
1. `tmp-server.cjs` (4.1MB) is a build artifact leaked into the git repo root
2. `src/components/factory/` is an empty directory (created June 18, never populated)
3. `pnpm audit` shows 3 advisories: 1 moderate (Electron ASAR bypass CVE-2025-55305) and 2 high (node-tar path traversal via electron-builder dependency chain)

## Goal
Remove leaked files, add gitignore rules, and resolve audit advisories where practical.

## Files
| Op | File |
|----|------|
| Delete | `tmp-server.cjs` |
| Delete | `src/components/factory/` (empty dir) |
| Modify | `.gitignore` — add `/tmp-*.cjs` |
| Modify | `package.json` — bump electron to >=35.7.5 if possible |

## Steps

### Step 1: Remove tmp-server.cjs from git
- Action: `git rm tmp-server.cjs`
- Commit: `chore: remove leaked build artifact tmp-server.cjs (4.1MB)`
- Verify: `ls tmp-server.cjs` returns "No such file"; `git status` shows file staged for deletion.

### Step 2: Remove empty factory directory
- Action: `rmdir src/components/factory` (empty dir, safe to remove)
- Commit: `chore: remove empty factory component directory`
- Verify: `ls src/components/factory` returns "No such file or directory".

### Step 3: Add gitignore rules
- Action: Add these lines to `.gitignore`:
  ```
  # Build artifacts
  /tmp-*.cjs
  ```
- Verify: `grep "tmp-\*" .gitignore` confirms entry exists.

### Step 4: Resolve npm audit advisories
- Action: Run `pnpm audit` to get current advisory list.
- For Electron (moderate, CVE-2025-55305): try `pnpm update electron` — requires >=35.7.5. Current version is ~33.x. If major bump breaks electron-builder config, defer and document as accepted risk (app doesn't use the vulnerable ASAR fuses).
- For node-tar (high, via electron-builder): this is a transitive dependency. Run `pnpm update electron-builder` if a newer version pulls in patched `tar >=7.5.7`. If not available, `pnpm audit --fix` may add overrides.
- Verify: `pnpm audit` shows zero HIGH advisories, or remaining ones are documented as accepted.

## Done Criteria
- [ ] `tmp-server.cjs` deleted and gitignore rule added
- [ ] `src/components/factory/` directory removed
- [ ] `.gitignore` contains `/tmp-*.cjs`
- [ ] `pnpm audit` shows 0 HIGH advisories (moderate Electron CVE acceptable if documented)
- [ ] `npx tsc --noEmit` passes
- [ ] `node scripts/runtime-smoke.mjs` passes (or `pnpm dev` starts)

## STOP Conditions
- If `tmp-server.cjs` is referenced by any script or config (check `grep -r "tmp-server" .`), stop and remove those references first.
- If bumping Electron to 35.7+ breaks `electron-builder` or `electron.cjs`, stop — document the CVE as accepted risk with justification.
- If `pnpm audit --fix` introduces breaking changes, stop and document remaining advisories.

## Maintenance notes
- When running `build:electron`, ensure `tmp-server.cjs` is in `.gitignore` to prevent re-leakage.
- The empty `factory/` directory may be repopulated later when `BookFactoryView` is split into sub-components (plan out of scope here).
