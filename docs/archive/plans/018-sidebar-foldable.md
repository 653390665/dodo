# Plan 018: Sidebar 探索工具可收起
> Commit: ca53899 | Status: DONE | Source: 产品策略审查

## Why
"探索工具"和"资料工具"对 80% 用户低频，占用 Sidebar 固定位置。

## Changes
- `Sidebar.tsx`: `showExplore` state (default false). Explore section hidden behind "▸ 探索工具" toggle button. Secondary items follow same toggle.

## Done: `npx tsc --noEmit` zero errors, default 4 main nav items visible
