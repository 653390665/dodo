# 生成质量 A/B 记录：模型档位与能力卡（2026-10-01）

> 目的：为「哪套模型/档位在写、能力卡到底有没有效果」提供第一手可复核读数。此前仓库只有「文本是否进提示词」层面的证据，没有成品质量的因果测量。

## 0. 摘要

- **模型档位**：`gemini-3.8-flash-high` 明显强于 `gemini-3.1-pro-low`——9 个有效盲评轮 **全部**由 flash 系包揽前二、pro 系包揽后二；pro 系 6/6 低于 4000 字整章合同。档位从 low 升到 high 有增益（更少的套话、门禁通过率 2/3 vs 0/3），代价约 **+32% 延迟 / +45% token**。App 当前正文实际跑在 **flash-low**（`disableThinking: true` → `server/lib/server-llm.ts:439` 对非 DeepSeek/SiliconFlow 端点下发 `reasoning_effort: 'low'`）。
- **能力卡**：链路可信（指纹 / sources / 卡正文进提示词三重证据）。n=3 时读数持平（3:3），扩到 **n=8 后转为方向性证据**：挂卡臂在 32 场盲评对决中胜出 **21** 场（pacing 11:5、style 10:6），两位评委各自同向，且不随匿名位置变化；但**未达统计显著**（两尾 p≈0.21 / 0.45），且**产品自家门禁两臂无差别（8/8 全过）**。
- **发现的摩擦**：①写法确认按章节单槽，换卡会静默让另一套配置失效（409 `STYLE_CONFIRMATION_REQUIRED`）；②`hook-card` 只映射 planner，挂上去对写作面**零影响**（指纹与不挂卡完全相同）；③6 卡总闸（卡组+本章卡 ≤6）是提示词预算语义，超限只有 toast；④`assetId` 与 `cardRef` 的可用性语义仍未收口。

## 1. 方法

### 1.1 被测端
- 隔离实例：`PORT=3301`，`INKFLOW_DB_PATH=/tmp/inkflow-writetest/data.db`（生产库副本）、`INKFLOW_CONFIG_DIR=/tmp/inkflow-writetest/inkflow-config`、`INKFLOW_ENABLE_DEV_AUTH_TOKEN=true`，node v22.22.3 + `npx tsx server.ts`（沙箱内 vite 无法写 `node_modules/.vite-temp`，须在宿主上下文起）。
- 取令牌：`GET /api/dev-auth-token` → **JSON** `{"token":"<64 hex>"}`（不是裸文本）。
- 所有写操作走应用端点，**不直连数据库**（`~/.inkflow/data.db` 只读、且用副本）。

### 1.2 模型臂（实验 A）
- 直连本机反代 `http://127.0.0.1:8317/v1/chat/completions`（CLIProxyAPI，凭据在 `harness/.credentials.yaml` 的 `CLIPROXY_API_KEY`）。
- 提示词：**真实整章 writer prompt**，取自真机落盘的 `/tmp/writer-prompts-gemini2.jsonl`（`kind="whole-chapter-prompt"`，21,804 字符，含角色设定、反 AI 腔红线、篇幅控制「整章约 4000-6000 字」）。
- 四组合 × 3 次：`gemini-3.8-flash-high@low`（= App 现况）、`@high`、`gemini-3.1-pro-low@low`、`@high`；`reasoning_effort` 是唯一的档位旋钮。
- **模型 id 事实**：`gemini-3.1-pro-high` / `gemini-3.1-pro` / `-medium` / `-xhigh` 均 400 `unknown provider for model`；pro 线只有 `gemini-3.1-pro-low` 一个 id，high 档要靠请求参数表达。

### 1.3 卡臂（实验 B）
- 作品 `novel-a` / 章节 `chapter-a`：卡组空、技法 0、护栏 0 → **唯一变量就是本章使用卡**。
- 接缝：`POST /api/orchestrate`（`draftingSurface: 'workspace-draft'`、`maxIterations: 1`、`includeCritic: false`、`sessionCardIds`）——与试跑台（`src/components/skills/SkillTestBench.tsx`）完全同源。
- 每次调用前重新 `POST /api/novels/:id/writing-style/resolve` + `/confirm`，并把 **服务端返回的 fingerprint** 回填进 orchestrate 载荷（否则 409）。
- 臂：`no-card`（对照）、`pacing-card`（`deconstruct-card-pacing`）、`style-card`（`style-cthulhu-mystique`）；每臂 8 次，同一 beats / context，按 rep 轮转顺序消除顺序效应。

### 1.4 判评
1. **产品自家门禁**：`validateCompleteChapterDraftQuality`（`shared/lib/draft-quality.ts`）——ok 与 findings codes。
2. **文体统计**：字数 / 段数 / 句长均值与标准差 / 对白占比 / 套话命中。
3. **盲评**：匿名为「稿一/稿二」随机排序，两位评委（`claude-sonnet-4-6` 严格 `json_schema`；`gpt-oss-120b-medium` 纯 JSON），输出 winner + 五维分（pacing / sceneCraft / voice / structure / overall）。

## 2. 实验 A：writer 模型档位（n=3 每档）

### 2.1 生成读数（12/12 `finish_reason=stop`）

| 组合 | 字数 | 延迟 ms | completion tokens |
|---|---|---|---|
| flash-low（= App 现况） | 6221 / 5841 / 5854 | 36912 / 33686 / 30263 | 5106 / 4785 / 4798 |
| flash-high | 6617 / 4662 / 4475 | 47882 / 40905 / 44442 | 7586 / 6454 / 7239 |
| pro-low | 1659 / 1723 / 1719 | 33240 / 33687 / 34490 | 2354 / 2738 / 2983 |
| pro-high | 2768 / 3657 / 2426 | 100299 / 69798 / 57043 | 11069 / 7407 / 6089 |

### 2.2 门禁读数
- `flash-low`：r1 `literary-slop/P1 + mechanical-quality/P1`、r2 `literary-slop/P1`、r3 同 r1 → **0/3 过门**。
- `flash-high`：r1 `literary-slop/P1`、r2 `literary-polish/P2`（**ok**）、r3 无 finding（**ok**）→ **2/3**。
- `pro-low`：3/3 `chapter-below-contract/P1`（+ `literary-polish/P2` ×2）→ **0/3**。
- `pro-high`：3/3 `chapter-below-contract/P1`（+ `repeated-opening/P2` r1、`literary-polish/P2` r2/r3）→ **0/3**。
- 文体均值：套话命中 flash-low 6.0 → flash-high 2.0；markdown 残留 0/12。

### 2.3 盲评（9 个有效评判轮：gpt-oss 5 轮 + claude 4 轮）
| 组合 | 平均名次 | 第一名次数 |
|---|---|---|
| flash-high | **1.44** | 5 |
| flash-low | 1.67 | 4 |
| pro-low | 3.33 | 0 |
| pro-high | 3.56 | 0 |

- 9/9 轮：flash 系占前二、pro 系占后二；两评委各自也给出同一方向（gpt-oss：flash-high 1.20 / flash-low 2.00；claude：flash-low 1.25 / flash-high 1.75）。
- flash 内部 flash-high 与 flash-low 接近（1.44 vs 1.67），差异接近噪声；**硬门禁才是 flash-high 的可靠优势（2/3 vs 0/3）**。

### 2.4 结论
1. 就「写中文长章」而言，**flash 线压倒 pro 线**（本反代的 pro 只有 low 档可取，且无论如何调档都写不到合同长度）。
2. **档位比型号更值钱**：flash low→high 有实打实的增益（套话减半、门禁通过率 0/3 → 2/3），代价是延迟与 token ~+1/3~+1/2。
3. App 今天跑的是 **flash-low**；若把写作档位改成 high，按本读数应能得到更稳的过门稿，但单章耗时增加。
4. 上一轮 n=1 的两个观察（flash-low 过门、flash-high 产出 `***` 分隔符）**未复现**，说明单次样本不可作依据。

## 3. 实验 B：能力卡（挂卡 vs 不挂卡，n=8 每臂）

### 3.1 链路完整性（先证明卡真的进去了）
| 臂 | 指纹 | sources（除 continuation-pack 外） |
|---|---|---|
| no-card | `00eb29cc11b97b77…` | — |
| pacing-card | `1bfac79f9fe051d3…` | `writer-session · deconstruct-card-pacing · 节奏拆书卡` |
| style-card | `2f89fa505f3648b0…` | `writer-session · style-cthulhu-mystique · 克苏鲁不可名状寒风氛围风格增色包` |

- 24/24 运行 `status=200`，`confirm/resolve` 均 200。
- **对照组**：挂 `deconstruct-suspense-hook-clone-1789708517018`（hook 卡）得到的指纹与 no-card **完全相同**（`00eb29cc…`）、sources 里也不出现 `writer-session` → 与 §4-② 的代码事实互相印证。

### 3.2 生成读数（8 次/臂）

| 臂 | 字数均值（范围 / sd） | 段数 | 句长均值 | 句长 sd | 对白占比 | 套话 | 门禁 |
|---|---|---|---|---|---|---|---|
| no-card | 4134.5（4091–4208 / 42.4） | 45.9 | 16.85 | 10.74 | 0.020 | 2.88 | **8/8**（0 findings） |
| pacing-card | 4145.1（4092–4183 / 31.4） | 44.6 | 16.91 | 10.67 | 0.020 | 2.50 | **8/8**（1 次 `literary-polish` P2） |
| style-card | 4136.6（4105–4174 / 21.4） | 43.9 | 17.39 | 11.69 | 0.020 | 3.00 | **8/8**（4 次 `literary-polish` P2） |

→ 字数、段数、句长、套话、门禁**三臂无实质差异**；产品门禁在当前判据下分辨不出挂卡收益（P2 不影响 ok）。

### 3.3 盲评（32 场对决 = 2 组对比 × 8 rep × 2 评委）

| 对比 | 挂卡胜 | 对照胜 | 分评委 | 获胜位置分布 | overall 均分 | 两评委同判 rep |
|---|---|---|---|---|---|---|
| no-card vs pacing-card | **11** | 5 | claude 5:3 / gpt-oss 6:2 | 先手 5 / 后手 6 | 6.93 vs 6.47 | 5/8 |
| no-card vs style-card | **10** | 6 | claude 5:3 / gpt-oss 5:3 | 先手 5 / 后手 5 | 7.06 vs 7.00 | 6/8 |

- 方向一致（两臂两评委均偏向挂卡），且**不随匿名位置变化**（先手/后手都赢）→ 不是位置偏误。
- 统计上 **未达显著**：pacing 11/16 两尾 p≈0.21；style 10/16 两尾 p≈0.45；合并 21/32 两尾 p≈0.11。
- 与 n=3 对照：同一 pacing 对比在 n=3 时是 **3:3 平** → 小样本读数不可当结论。

### 3.4 结论
1. **卡的管线生效可验证**（指纹、sources、提示词注入三重证据）；`hook-card` 例外，仅进 planner（见 §4-②）。
2. 在净面 + 单场景短章上，挂卡对**成品质量只有方向性、未显著的**提升（胜率 ~63–69%，均分仅差 0.5 分以内），且**产品自家门禁毫无察觉**（三臂 8/8）。
3. 若要用 A/B 证明卡的价值，应换更大的 n、更长/多场景的章、或改用更能体现差异的判据（结构指标、伏笔回收、风格一致度）。

## 4. 摩擦与口径债（已登记）

1. **写法确认按章节单槽**：`resolve/confirm` 的确认结果按章节保存；换一套「本章使用卡」后，旧那套的确认即失效 → 交替测试必然 409 `STYLE_CONFIRMATION_REQUIRED`（实测：no-card 臂 3/3 全 409）。产品侧是设计的写法确认流，但对做链路/卡 A/B 的人是隐蔽的额外步骤。
2. **`hook-card` 只映射 planner**（`shared/types/capability-execution.ts:168-176` 的 `CARD_STAGE_MAP`）→ 挂载钩子卡对 writer 提示词零影响；实测挂 `deconstruct-suspense-hook-clone-1789708517018` 得到的 fingerprint 与完全不挂卡**完全相同**（`00eb29cc11b97b77…`），sources 里也不出现 `writer-session`。
3. **6 卡总闸**：卡组 + 本章卡 ≤6，超出 400 `TOO_MANY_SESSION_CARDS` / `TOO_MANY_EFFECTIVE_SKILL_CARDS`（`server/helpers/writing-style-service.ts:1855-1896`）；这是提示词预算语义（1 主 + 4 辅后 overlay 只剩 1 张），非缺陷，但 UI 只弹 toast。
4. **口径债**：`assetId` 与 `cardRef` 的可用性语义仍未收口（`docs/architecture/inkflow.architecture-understanding.md:268`）；「卡正文对生成质量的因果影响此前无测量」——本文档是该缺口的第一份读数。

## 5. 复现

```bash
# 1) 令牌（JSON）
curl -s http://127.0.0.1:3301/api/dev-auth-token

# 2) 卡臂：每次调用前先 resolve+confirm（同一载荷），再 orchestrate
#    POST /api/novels/novel-a/writing-style/resolve   {chapterId, databaseGeneration, sessionCardIds}
#    POST /api/novels/novel-a/writing-style/confirm   （同上载荷；指纹由服务端给）
#    POST /api/orchestrate  {draftingSurface:'workspace-draft', maxIterations:1, includeCritic:false, sessionCardIds:[...]}

# 3) 产品门禁 + 文体读数（纯函数，无需服务；会把草稿目录跑一遍）
node --import tsx scripts/report-card-ab-metrics.ts /tmp/cardab3   # → /tmp/cardab3-metrics.json
```

- 生成驱动与盲评脚本是会话期的 `/tmp/*.py`（`/tmp/cardab3-run.py`、`/tmp/cardab3-judge.py`、`/tmp/ab-gen3.py`），**未入库**；纯函数读数已入库（`scripts/report-card-ab-metrics.ts`）。

## 6. 局限

- 卡实验是**单章节、单场景、短章（~4100 字）**；写作面目标字数下限把三臂字数钉在 4.1k 附近，压制了「节奏卡可能改变篇幅/密度」的空间。
- 每臂 8 次 ≠ 统计显著；盲评对决共享同一批草稿（同一 rep 的两份稿子被两位评委各评一次），自由度有限。
- 评委是 LLM，存在噪声与自相矛盾（n=3 时 r1/r3 两评委结论相反，理由还出现事实性倒置）。
- 模型实验用的是**一份**真实 writer 提示词、n=3/档；换题材/章型结论可能不同。
- 对照臂带 continuation-pack（资料包），不是「纯白纸」对照。

## 7. 后续（2026-10-01，Plan 267）

### 7.1 应用内档位对照（与第 2 节的外部对照结论不同）

外部 API 盲评（第 2 节，n=3）显示 `high` 文风更好；但把档位搬进应用链路（隔离 3301，`INKFLOW_REASONING_EFFORT`，代理日志实证 `level=high|low`）后：

| 档位 | 耗时（2 跑） | model 稿字数 | critic |
| --- | --- | --- | --- |
| high | 425.3 / 376.9 s | 5235 / 4875 | **审计不可用**（请求失败） |
| low | 62.8 / 70.6 s | 5950 / 6053 | 结构化 audit JSON（scores/totalScore） |

机制：high 档下 writer 返回 `empty_response / reasoning_only`（不可重试），critic 撞 70s 超时。结论：外部对照的「high 更好」在当前应用链路里不成立，瓶颈是应用侧超时与推理流处理，不是模型。

### 7.2 多场景（三场面）卡 A/B，n=4/臂

结构读数：no-card 锚点覆盖 1.0、场序 4/4；pacing-card 覆盖 0.9、场序 3/4；两臂门禁 4/4。盲评有效 5 场：no-card 4 : pacing-card 1。仍未观察到 pacing 卡的正向因果效果。

### 7.3 新残余

- R-267-1：两臂草稿尾部均出现与主线无关的「年代戏」片段（同臂跳 rep 逐字相同，全库检索仅命中草稿文本）→ 待定位来源。
