# Plan 222: AgentWorkspace 打字路径性能——每键重渲与全文哈希消除（PERF-04）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat d6c2ed2..HEAD -- src/components/AgentWorkspace.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW-MED（需保留「无输入焦点时全量扫描」语义与既有测试基线）
- **Depends on**: none
- **Category**: performance
- **Planned at**: commit `d6c2ed2`, 2026-09-15（发现：improve 四路审计 PERF-04）

## Why this matters

AgentWorkspace（1101 行）在**主写作 textarea** 上监听 `select/keyup/mouseup`，每键 `setSelection` 触发整组件重渲（`React.memo` 只防父级重渲，防不了内部 state）；同时 `entityScanHash` memo 依赖 `selection`，每键把全文 + 全部实体名 join 成一份正文长度的字符串再做全长 FNV-1a 哈希。长章节 + 低端机上这是持续打字卡顿源。实体扫描本身已有 400ms debounce，但 debounce 读的是 state 而非定时器内直读 textarea——debounce 没能挡住重渲与哈希。

## Current state（2026-09-15 亲读核实，锚点基于 `d6c2ed2`）

- `src/components/AgentWorkspace.tsx:359-373` — useEffect 在 `contentRef.current` 上挂 `select/keyup/mouseup` 三监听 → `setSelection({start, end})`。
- `:375-390` — `entityScanHash` useMemo：`[currentChapter?.id, currentChapter?.content, characters, locations, items, factions, selection]` → `hashEntityScanInput([...].join('\u0000'))`——`currentChapter?.content`（全文）每键参与哈希输入重建（selection 变化即重算）。
- `:392-438` — 400ms debounce 的实体扫描 effect，读取 `entityScanHash` 变化触发。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 相关套件 | `npx vitest run --config vitest.config.frontend.ts src/tests/entity-sniffing.test.tsx src/tests/editor-guidance-layout.test.tsx`（按实际关联文件增删） | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| typecheck | `npm run typecheck` | 0 |

## Scope

**In scope**：

- `AgentWorkspace.tsx`：selection state 去状态化；哈希输入降频

**Out of scope**：

- 实体扫描算法本身（400ms debounce 保留）
- AgentWorkspace 的其他重渲源（tab 面板等，如存在另行立项）

## Steps

### Step 1: selection 去状态化

删除 `selection` state 与每键 setState：监听保留但 handler 改为记录「dirty」标记（ref）+ 触发一次 400ms debounce 定时器；定时器回调内**直读** `contentRef.current.selectionStart/End` 与当时全文做哈希比较，仅在实体扫描输入真变化时才执行扫描。原「无输入焦点时全量扫描」语义与 `currentChapter?.id`/实体列表变化即扫描的行为保持（实体列表变化仍走既有 effect 路径）。

**Verify**: 既有实体扫描相关测试全绿；新增/调整一个用例锁定「输入后 400ms 扫描仍触发」与「光标移动不触发扫描重跑（哈希未变时）」

### Step 2: 回归 + 台账

人工冒烟：长章节（>1 万字）打字 Performance 面板确认无每键组件重渲热点；台账落账。

**Verify**: 前端全量 + typecheck 绿；台账落账

## Done criteria

- [ ] 打字路径不再每键重渲 AgentWorkspace / 重建全文哈希
- [ ] 实体扫描语义不变（400ms、全文、实体名参与）；既有测试绿
- [ ] 台账落账

## STOP conditions

- 发现 selection 除了实体扫描外还有其他消费方（如选区工具按钮）依赖每键 state → 停止，列出消费面重新设计。
