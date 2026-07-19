# Plan 017: AgentWorkspace 核心标签精简
> Commit: ca53899 | Status: DONE | Source: 产品策略审查

## Why
AgentWorkspace 10 个扁平标签页，新用户认知负荷过高。

## Changes
- `AgentWorkspace.tsx`: `showMoreTabs` state. Default shows 3 core tabs (智能建议/自动生产/查设定) + "更多 ▸" button. Advanced tabs (技能装备/大纲/分镜/审计/节奏/追踪台/版本) hidden behind toggle.

## Done: `npx tsc --noEmit` zero errors, default 3 visible tabs
