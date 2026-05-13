# InkFlow 参考架构与 Prompt 分层设计

## 1. 目的

这份设计文档用于回答一个具体问题：

在参考 `91Writing / 魔力创作` 这类 AI 写作产品后，InkFlow 应该借鉴什么，不应该照搬什么，以及这些判断如何落成我们自己的产品架构与 Prompt 架构。

目标不是复刻对方的工具形态，而是吸收其中对“小说生产工序”的理解，转译成更符合 InkFlow 当前主线的实现方案。

---

## 2. 当前上下文

InkFlow 当前已经形成一条真实主线：

`开始创作 -> 进入作品 -> 进入当前章节 -> 写作推进 -> 卡住时唤起灵感助手 -> 结果落回正文/分镜/设定/碎片 -> 继续写`

这一主线已经在近期评审中被冻结为优先保护对象，意味着后续一切借鉴都必须服务这条路径，而不是把系统重新做回“功能很多的 AI 写作器”。

相关上下文：

- [2026-05-12-product-mainline-review.md](/Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-12-product-mainline-review.md)
- [2026-05-12-mainline-validation-checklist.md](/Users/Zhuanz/Documents/dodo-inkflow/docs/superpowers/specs/2026-05-12-mainline-validation-checklist.md)

---

## 3. 外部参考对象判断

### 3.1 参考对象本质

`91Writing / 魔力创作` 更像一个“小说生产工具平台”，不是“围绕当前章节推进的主稿桌”。

其核心优势在于：

- 对长篇小说工序有明确理解
- Prompt 资产组织成熟
- 模型接入灵活
- 模板、变量、素材、生成之间形成流水线

其核心代价在于：

- 用户需要自己理解工序顺序
- 系统容易暴露过多工具面
- 写作主线容易被模板和素材管理打断

### 3.2 可以借鉴的三类能力

1. **工序链条意识**
   - 脑洞
   - 世界观
   - 角色
   - 大纲
   - 细纲
   - 章纲
   - 正文
   - 润色 / 审稿

2. **Prompt 资产化**
   - 分类
   - 标题
   - 描述
   - 输入变量
   - 输出形态
   - 使用场景

3. **节点式 AI 调用**
   - 不同创作任务用不同提示词与上下文
   - 不是所有事都交给一个泛聊天助手

### 3.3 明确不借鉴的三类形态

1. **工具暴露过多**
   - 不把工序完整暴露给用户逐一操作

2. **Prompt 成为主导航**
   - 不让用户把“挑提示词”当成主要工作

3. **工作台总控台化**
   - 不把人物、世界观、语料、模板、变量、生成配置全部同时推到主屏

---

## 4. InkFlow 参考架构

### 4.1 总原则

借鉴外部系统时，InkFlow 只吸收“工序理解”和“Prompt 资产化”，但将它们下沉到系统内部，不把完整工厂暴露给用户。

用户面前永远优先呈现：

- 当前阶段
- 当前章节
- 当前最推荐动作

而不是：

- 现在有哪 12 类工具可选
- 现在有哪 19 条提示词可切换

### 4.2 产品四层

#### 第一层：开书层

目标：

- 从模糊灵感进入一个真实项目

承载：

- 灵感输入
- 创作规划输入（字数 / 节奏 / 重心）
- 故事方向卡

系统内部可调用的能力：

- 脑洞类 prompt
- 方向卡类 prompt

#### 第二层：骨架层

目标：

- 在进入正文前把作品最基本的支撑结构立住

承载：

- 世界观
- 主角与关键关系
- 核心冲突
- 篇幅规划

系统内部可调用的能力：

- 世界观 prompt
- 角色卡 prompt
- 长篇总纲 prompt

#### 第三层：章节推进层

目标：

- 让作者始终围绕“当前章节”写下去

承载：

- 当前章节正文
- 当前章节分镜
- 当前章节上下文
- 卡住时的阶段型求助

系统内部可调用的能力：

- 细纲 prompt
- 章纲 prompt
- 正文 prompt
- 续写 / 改写 / 补桥段 prompt

#### 第四层：修稿层

目标：

- 在写出来之后做定向提纯，而不是写之前就陷入复杂管理

承载：

- 润色
- 去 AI 味
- 审稿
- 一致性与设定检查

系统内部可调用的能力：

- 润色 prompt
- 审稿 prompt
- 风格 / 重复 / 逻辑类检查 prompt

---

## 5. InkFlow Prompt 分层

### 5.1 分层原则

Prompt 不按“作者名字”或“模板收藏夹”作为主结构，而按创作阶段与任务目标分层。

推荐分为六类：

1. `discovery`
   - 用于脑洞、方向卡、选题裂变

2. `foundation`
   - 用于世界观、角色、关系、总纲

3. `planning`
   - 用于细纲、章纲、分镜拆解、篇幅分配

4. `drafting`
   - 用于正文生成、续写、扩写、桥段补位

5. `polish`
   - 用于润色、口语化、去 AI 高频词、句式重塑

6. `review`
   - 用于审稿、逻辑检查、设定一致性、风险提示

### 5.2 每条 Prompt 的统一结构

每条 Prompt 资产不应只有一个字符串模板，而应包含元信息：

- `id`
- `title`
- `stage`
- `goal`
- `inputs`
- `template`
- `outputShape`
- `riskNotes`
- `successSignal`

示例：

```ts
type PromptStage =
  | 'discovery'
  | 'foundation'
  | 'planning'
  | 'drafting'
  | 'polish'
  | 'review';

interface PromptAsset {
  id: string;
  title: string;
  stage: PromptStage;
  goal: string;
  inputs: string[];
  template: string;
  outputShape: 'json' | 'markdown' | 'plain-text';
  riskNotes: string[];
  successSignal: string;
}
```

### 5.3 Prompt 调用原则

1. 用户先说目标，系统再选 Prompt
2. Prompt 尽量不作为主 UI 对象暴露
3. 一个阶段只推荐一个主动作
4. Prompt 资产可以被组合，但组合关系由系统控制，不由用户手动拼接

---

## 6. 与当前 InkFlow 的衔接方式

### 6.1 已有基础

InkFlow 当前已经具备部分 Prompt 分层雏形：

- `storyCards`
- `setupTaskRefine`
- `editorAgent`
- `manualAudit`
- `orchestrateWriter`
- `orchestrateCritic`
- `generateOutline`

这说明系统并不是从零开始，而是已经存在一个“分散定义的 Prompt 集合”。

### 6.2 需要收口的问题

当前问题不在于 Prompt 不存在，而在于：

- Prompt 是按接口和功能堆积出来的
- 缺少统一的阶段标签
- 缺少统一的输入 / 输出契约
- 与产品主线的对应关系没有被正式定义

### 6.3 下一步设计动作

建议后续分两步实施：

#### 步骤一：Prompt 资产层收口

先不改大交互，只做：

- Prompt 分类
- 元信息补齐
- 输入输出统一
- 调用关系梳理

#### 步骤二：章节主线联动

再把这些 Prompt 资产接回主线页面：

- 开书层调 `discovery`
- 骨架层调 `foundation`
- 章节推进层调 `planning + drafting`
- 修稿层调 `polish + review`

---

## 7. 决策建议

### 7.1 推荐路线

推荐采用“收敛借鉴”路线：

- 学它的工序链条
- 学它的 Prompt 资产组织
- 不学它的工具暴露方式
- 不学它把模板操作放到用户前台

### 7.2 不推荐路线

不建议把 InkFlow 改造成：

- 提示词中心产品
- 模板切换中心产品
- 面向熟练用户的流程装配台

因为这会直接削弱当前已经成形的主线价值。

---

## 8. 设计结论

本次参考的核心结论如下：

1. `91Writing / 魔力创作` 最值得借鉴的是其对长篇创作工序的理解，以及 Prompt 资产化方法。
2. InkFlow 不应照搬其“工具工厂”形态，而应把这些能力下沉到系统内部。
3. InkFlow 的正确方向是：外部保持主线收敛，内部逐步建立完整 Prompt 分层与阶段型调用系统。
