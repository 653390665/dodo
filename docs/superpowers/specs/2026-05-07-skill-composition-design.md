# Skill Composition And Evolution Design

## 1. 背景

当前 InkFlow 的 Skill 系统已经能完成 `拆书 -> 萃取 Skill -> 保存到技能库 -> 在创作舞台挂载` 的基础流程，但它存在 4 个结构性问题：

1. `技能仓库` 只有列表和删除，缺少详情、编辑、版本化迭代与对比试驾。
2. 拆出的 Skill 目前是“融合型单卡”，把文风、人物、世界观、战力、节奏等能力塞在同一张卡里，导致 Skill 难以组合复用。
3. `创作舞台` 里的 Skill 挂载只是静态多选，缺少卡牌式装配、拖拽替换、适配得分和冲突提示。
4. Skill 使用后的反馈没有结构化落库，无法沉淀成 Evolution 机制，不能根据真实使用情况优化推荐和权重。

本设计的目标不是一次性推翻现有 Skill，而是在兼容现有数据的前提下，把系统演进成“可管理、可版本化、可组合、可反馈学习”的 Skill 平台。

## 2. 设计目标

### 2.1 产品目标

- 让用户能在 `技能仓库` 中打开 Skill 详情，编辑字段，并保存为新版本。
- 让用户能通过 `试驾对比台` 对同一个 Skill 的不同版本或不同 Skill 组合进行对比测试。
- 让 Skill 从“融合型大卡”逐步演进为“带维度标签和组合权重的能力卡”。
- 让 `创作舞台` 支持卡牌式装配、拖拽排序、替换预览和适配得分。
- 让 Skill 的使用过程产生结构化反馈，并用于后续推荐和权重调优。

### 2.2 非目标

- 第一阶段不做真正的模型训练或自动微调。
- 第一阶段不做复杂的向量检索或多目标优化引擎。
- 第一阶段不推翻现有 `Skill` 表结构为多表范式，而是先做兼容式增强。

## 3. 分阶段方案

### 阶段 A：技能仓库闭环

先解决“能管理、能迭代、能比较”的问题。

新增能力：

- 技能卡点击后打开详情抽屉。
- 详情抽屉支持字段编辑。
- 支持两种保存方式：
  - `保存当前版本`：覆盖当前 Skill。
  - `保存为新版本`：复制当前 Skill 并提升版本号，建立谱系关系。
- 新增 `试驾对比台`：
  - 输入测试片段。
  - 选择主 Skill 和可选对比 Skill / 候选版本。
  - 输出 `原文 / 当前版 / 对比版` 三栏对照。

这一阶段不要求 Skill 已经完全可组合，但要求它已经“可编辑、可分叉、可试驾、可比较”。

### 阶段 B：兼容式组合 Skill 模型

在不破坏现有 Skill 数据的前提下，引入“维度标签 + 组合画像”。

新增概念：

- `dimensionTags`
  - Skill 所覆盖的维度标签，如 `style`、`character`、`world`、`power`、`plot`、`pacing`。
- `compositionProfile`
  - 每个维度的强度、优先级、冲突倾向、推荐权重。
- `primaryDimension`
  - 该 Skill 的主维度，用于在装配时展示和排序。

兼容策略：

- 旧 Skill 默认被视为“融合型 Skill”。
- 拆书工厂生成 Skill 时，新增一步“维度归因”，给 Skill 自动打上主维度和次维度标签。
- 新增或编辑 Skill 时允许用户将其收敛成单一维度卡，或保留为融合型卡。

这样系统可以同时支持：

- 融合型 Skill：适合快速上手。
- 单维度 Skill：适合精细组合。

### 阶段 C：创作舞台装配与反馈进化

在创作舞台把静态挂载升级成“卡牌式装配台”。

新增能力：

- Skill Deck 展示所有可用 Skill 卡。
- Loadout 区保留最多 3 个卡槽，但每个卡槽都包含：
  - Skill 卡片
  - 主维度
  - 当前权重
  - 适配得分
  - 冲突提示
- 支持拖拽排序和替换。
- 装配变化时实时计算：
  - 总适配得分
  - 维度覆盖情况
  - 维度冲突
  - 写作风格摘要

写作完成后记录反馈：

- 用户是否保留生成文本。
- 用户是否重写或大幅删改。
- 审计结果是否通过。
- Skill 是否在本次后被移除或替换。

这些数据会落到 `SkillUsageRecord`，用于后续统计：

- 某张 Skill 的真实可用度。
- 某类 Skill 组合的长期得分。
- 哪个维度经常导致冲突。

## 4. 数据模型设计

### 4.1 兼容式 Skill 扩展

保留现有 `Skill` 基础字段，并新增：

- `parentSkillId?: string`
- `lineageRootId?: string`
- `primaryDimension?: SkillDimension`
- `dimensionTags?: SkillDimension[]`
- `compositionProfile?: SkillCompositionProfile`
- `usageStats?: SkillUsageStats`
- `feedbackScore?: number`
- `updatedAt?: number`

建议新增类型：

```ts
type SkillDimension =
  | 'style'
  | 'character'
  | 'world'
  | 'power'
  | 'plot'
  | 'pacing';

interface SkillCompositionProfile {
  styleWeight: number;
  characterWeight: number;
  worldWeight: number;
  powerWeight: number;
  plotWeight: number;
  pacingWeight: number;
  conflictTags: string[];
  blendHints: string[];
}

interface SkillUsageStats {
  mountedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  revisedCount: number;
  averageFitScore: number;
}
```

### 4.2 Novel 装配结构

当前 `Novel` 只有 `mountedSkillIds: string[]`，不够表达装配权重和顺序。

新增：

```ts
interface MountedSkillLoadoutItem {
  slot: number;
  skillId: string;
  weight: number;
  lockedDimensions?: SkillDimension[];
}
```

`Novel` 中新增：

- `mountedSkillLoadout?: MountedSkillLoadoutItem[]`

兼容策略：

- 如果旧数据只有 `mountedSkillIds`，启动时自动映射成默认权重为 `1` 的 loadout。

### 4.3 新增 SkillUsageRecord

新增表或等价存储结构：

```ts
interface SkillUsageRecord {
  id: string;
  novelId: string;
  chapterId?: string;
  mountedSkillIds: string[];
  fitScore: number;
  auditScore?: number;
  userAction: 'accepted' | 'revised' | 'rejected';
  notes?: string;
  createdAt: number;
}
```

它是后续反馈优化的基础，不直接修改模型，只先记录真实使用行为。

## 5. 适配得分设计

适配得分必须可解释，不能是黑箱。

建议由 4 部分组成：

- `维度覆盖分`
  - 当前写作任务需要哪些维度，装配是否覆盖到。
- `冲突惩罚分`
  - 两张 Skill 在同一维度上是否强冲突，例如一个要求“极简冷峻”，一个要求“华丽抒情”。
- `稳定性分`
  - 来自 Skill 自身的 `stabilityScore` 和历史反馈。
- `上下文匹配分`
  - 根据章节类型、世界观类型、当前 scene beats 粗略判断是否匹配。

输出不只是一串数字，还要附带解释：

- 总分
- 每张卡贡献
- 冲突来源
- 推荐替换建议

## 6. UI 设计

### 6.1 技能仓库

- 保留卡牌式列表。
- 点击卡牌打开右侧详情抽屉。
- 抽屉内分为 4 个区块：
  - `基础信息`
  - `维度画像`
  - `试驾对比台`
  - `版本谱系`

详情页支持：

- 编辑文本字段。
- 调整维度标签和主维度。
- 查看 `v1 -> v2 -> v3` 的谱系关系。
- 保存当前版本或另存为新版本。

### 6.2 试驾对比台

试驾区采用三栏：

- 左：输入原始测试片段
- 中：当前 Skill 输出
- 右：对比 Skill / 新版本输出

支持：

- 同 Skill 不同版本对比
- 两张 Skill 的单卡对比
- 多卡装配结果对比

### 6.3 创作舞台装配台

Skill 装配区采用“卡组 + 卡槽”布局：

- 上方是推荐总评和组合摘要。
- 中间是 3 个卡槽，可拖拽替换。
- 下方是 Skill Deck，可按维度筛选。

每张卡展示：

- 名称
- 主维度
- 稳定性
- 适配得分
- 当前权重

卡拖进卡槽后立刻刷新：

- 总适配分
- 风格描述
- 冲突警告

## 7. 后端与提示词影响

`buildContextPrompt()` 不能继续把 Skill 当作同质文本拼接。

后续应改成按维度注入：

- 文风类 Skill：进入 Writer 的 style 约束
- 人物类 Skill：进入角色塑造约束
- 世界观类 Skill：进入设定一致性约束
- 战力类 Skill：进入 power/rules 约束
- 节奏类 Skill：进入节奏与分章约束

组合后的 prompt 应带上：

- 维度归属
- 权重
- 冲突回避说明

这样 Skill 才真正具备“组合”意义，而不是简单文本拼接。

## 8. 风险与边界

### 8.1 风险

- 现有 `skills` 表字段偏平，直接新增太多列会让数据迁移变重。
- `EditorView.tsx` 已经很大，如果继续堆逻辑，复杂度会失控。
- 组合式 Skill 如果一次性强推到拆书工厂，会导致萃取结果质量波动。

### 8.2 应对

- 第一轮优先采用 JSON 扩展字段或兼容性列，不做激进拆表。
- Skill 仓库和装配逻辑尽量拆到独立组件，不把全部逻辑堆进 `EditorView.tsx`。
- 拆书工厂先做“维度归因”，不强制一步生成纯单维度 Skill。

## 9. 实施顺序

建议按以下顺序落地：

1. `技能仓库闭环`
   - 详情
   - 编辑
   - 保存为新版本
   - 试驾对比台
2. `Skill 模型兼容式增强`
   - 维度标签
   - 组合画像
   - 版本谱系
3. `创作舞台卡牌装配`
   - 拖拽
   - 替换
   - 适配得分
4. `使用反馈与权重优化`
   - 记录 usage
   - 更新反馈分
   - 改进推荐和权重

## 10. 验收标准

满足以下条件才算闭环成立：

- 用户可以在 `技能仓库` 打开 Skill 详情并编辑。
- 用户可以把当前 Skill 另存为新版本，并看到版本谱系。
- 用户可以在 `试驾对比台` 中看到同一段文本在不同 Skill 或不同版本下的输出差异。
- 用户可以在 `创作舞台` 中以卡牌方式装配 Skill，并看到适配得分和冲突提示。
- 写作完成后系统能够记录装配情况和使用反馈。
- 下一次装配时系统能够根据历史反馈调整推荐得分。
