# 013 — 能力卡全量普查、货架分类学与适合度评分（实施记录）

> 完成：2026-09-08。来源：用户 PM 诊断（文风与正文 73 张卡"分类不清/与创作流程重复/评分无区分度"）。
> 方法：两轮 Explore 侦察（资产全量 / 调用链与冲突面 / 评分与展示现状）+ 实跑数字。

## 普查核心数据（实跑）

- 内部目录 174 条（active 128 上架 / candidate 46）；精选 16；流程 6（30 步 / 22 唯一资产）；包 **9**（4 免费 + 5 付费，UI 显示 8 为另一会话口径）
- **双重身份 19 卡**：流程步骤资产同时以独立卡上架（square-183/76、private-163、generateOutline、core-slop-shield…）；仅 3 条 flow-default 独占
- `opening-gold-three`（curated）≡ `plaza-golden-three`（主目录）**同标题异 id 真重复**
- 73 张 optional-style = 31 系列/孤岛：风华 25（含私有化流程×6）、lwl 13、小飞鸡 6、题材模板 11、天马 2、锅盖 2、其余孤张
- 语义同质："脑洞生成"7 单卡 + 3 流程步骤；"简介生成"6；"世界观"6+1+1；"大纲"17
- 治理分 30-98：≥80 仅 10 张、74-79 挤 32 张、<74 有 31 张；curated 另有 89-97 + S 级（不同量纲，不混排）
- genreTags 仅 16/127（英文 slug）；题材信息 88% 在标题/描述自然语言；novel.tags 中文，直接交集会失配

## 冲突面记录（本轮不改，待验证/另立）

1. **双重注入风险（待实测）**：19 张双重身份卡被激活流程包含、又被用户单卡启用时，writer/critic 是否重复注入同源提示词——需在 writing-style-service 注入侧加去重或实测确认
2. **`getAssetEnhancementPackage` 陈旧桥接**：硬编码主目录旧 id，与包 steps 的 curated id 完全对不上（实跑 23 个 step assetId 全部返回 null）——`getAssetEnhancementPackage` 对广场卡失效，影响"推荐包"提示
3. **同名异 id**：opening-gold-three ≡ plaza-golden-three，显示两处、实为一物，宜在目录层合并或加别名

## 已实施（本轮交付）

1. **分类学纯函数** `src/lib/capability-shelf.ts`：
   - `deriveShelfTags`：标题/描述 → 题材/平台 token 规则特征化
   - `deriveNovelGenreTokens`：作品文本+tags → 题材 token（英文 slug 直收 + 中文规则）
   - `groupStyleShelf<T>`：系列组（前缀 ≥3 折叠）+ 功能组（正文润色与文风/故事生成/大纲与设定/题材模板/拆书与仿写），73 张全覆盖无未分类桶
   - `computeCardFitness`：适合度 = 题材命中 30 + 平台 20 + 阶段 15 + 反馈 20（无样本自动重分配）+ 治理分 15，产出 reasons chips
2. **前端**：文风与正文页签二级分组渲染（功能组平铺 + 系列组 `<details>` 折叠）、卡面适合度 chip + 匹配原因、组内按适合度排序
3. **测试**：capability-shelf.test.ts 10 用例（标签特征化/分组覆盖/系列折叠/流程标记/评分重分配）

## 验证

- 前端 vitest **851/851**（841 + capability-shelf 10）；tsc 0；eslint 改动文件 0（Panel 仅剩 005 已记录的既有 ReviewIssue warning）
- 后端 npm test 1153/1153（本轮未触后端，此前实测）

## 遗留

- genreTags 离线补全本版以 deriveShelfTags 投影时实时计算替代（等效达成 ≥90% 语义覆盖，且无需改 1153 行数据文件）；如需将 tags 固化进目录数据，另跑一次性脚本
- 双重注入验证与陈旧桥接修复 → 待验证项（见冲突面记录）
