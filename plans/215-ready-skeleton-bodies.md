# Plan 215: 33 张 ready 条目骨架正文补齐（210 同病灶收尾，占位）

> **Executor instructions**: 按步骤顺序执行。完成后更新 `plans/README.md` 中本计划的状态行。

## Status

- **Priority**: P3（Next 批次占位：数据诚实度尾巴）
- **Effort**: S/M（内容工程为主，模式已验证）
- **Risk**: LOW
- **Depends on**: 210（realTemplates 模式与重生成链路已验证）
- **Category**: product + data honesty
- **Planned at**: commit `aad58c2`, 2026-09-14

## Why this matters

210 只重建了 44 张 sanitize-required 候选的正文；`rawPrivateConfigs` 中 score≥70 的 33 张 ready 条目（licensed 高分资产）模板同样是 `[商业定制专属提示词体]…骨架推进。` 占位——其中 runtime-active 且 tier 为 optional-style 的条目已进入公开目录与可选文风集，是「展示文案正常、主体为占位符」的同款产品谎言。

## Steps

### Step 1: 盘点

列出 33 张 ready 条目的 id/title/cat/tier，标注哪些 tier=optional-style（进公开目录、用户可见）与其他 tier（内部消费）。

### Step 2: 正文撰写

复用 `realTemplates` 映射按 210 口径撰写（120-300 字编号规则指令式、无署名/联系方式/竞品/水印词）。

### Step 3: 重生成 + 验证 + 台账

重跑生成脚本（freshness 守卫）、骨架计数归零断言、前端全量；台账落账。

## Done criteria

- [ ] rawPrivateConfigs 骨架模板归零（或仅剩显式豁免清单并有据）
- [ ] freshness + 前端全量绿；台账落账

## STOP conditions

- 个别条目 title 过于含混无法负责任地撰写正文（如纯「测试」占位名）→ 单独列出报告，不硬编。
