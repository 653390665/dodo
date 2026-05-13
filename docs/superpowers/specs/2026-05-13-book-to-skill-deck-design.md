# InkFlow 整书拆卡设计

## 1. 目标

把“整本书拆书”从一次性分析报告，改成可直接进入 Skill 仓库与工作台装配的卡组产物。

## 2. 产物结构

- 主笔卡：1 张
- 副卡：2-4 张
- 每张卡必须有：
  - `primaryDimension`
  - `dimensionTags`
  - `compositionProfile`
  - `slot recommendation`
  - `evidenceCoverage`
  - `evidenceMoments`

## 3. 展示原则

- 主展示对象是卡组，不是维度分析面板
- 维度评分降级为“样本信号强度”或仅供内部计算
- 证据只回答“这张卡为什么成立、来自全书哪些阶段”

## 4. 覆盖标签

- `full-book-stable`
- `opening-heavy`
- `mid-book-heavy`
- `climax-heavy`
- `weak-evidence`

## 5. 与工作台的适配要求

- 最终卡片必须能直接进入 Skill 仓库
- 最终卡片必须能直接进入工作台装配板
- 作者在工作台里看到的是“主笔卡 / 人物卡 / 世界规则卡 / 剧情推进卡”，不是整书分析报告

## 6. 风险边界

整本书上传不代表模型一次就能理解整本书，必须走“分段证据 -> 汇总成卡”的流程。
