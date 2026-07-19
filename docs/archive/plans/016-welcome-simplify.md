# Plan 016: WelcomeView 新手模式简化
> Commit: ca53899 | Status: TODO | Source: 产品策略审查

## Why this matters
WelcomeView 首屏 15 个交互元素，新用户决策疲劳。

## Changes
- `WelcomeView.tsx`: `showAdvanced` state, fold genre picker + planning behind expandable panel
- `app-store.ts`: `hasCompletedOnboarding` flag

## Steps
1. Add `hasCompletedOnboarding` to app-store, set true after first novel
2. Default: input + 3 seeds + create button. Genre + planning folded under "高级选项▸"
3. Existing users get expanded by default

## Done: `npx tsc --noEmit` zero errors, first-visit WelcomeView ≤5 elements
