# Plan 197 · Step 3 语义质量抽查统计表（STOP 门测量）

> 测量时间：2026-09-12。对象：`shared/lib/public-skill-catalog.ts` 新增导出 `SANITIZED_SKILL_COPIES` 的 45 张消毒副本（由 `scripts/generate-public-catalog.ts` 从 45 张非 test-fixture 的 sanitize-required 候选生成）。
> 一次性脚本：对每张副本测量 标题/描述/prompt 主体（template）的空主体、占位骨架、相对源的长度损失，并复算 `analyzeAndSanitize` 命中数。

## 结论（STOP 门判定）

| 指标 | 数值 |
|---|---|
| 副本总数 | 45 |
| 空标题 / 空描述 / 空主体 | 0 / 0 / 0 |
| **仅剩骨架（主体为源占位模板）** | **44（97.8%）** |
| 真实主体但薄弱（<40 字） | 1（sanitized-raw-comp-brand-detector，34→26 字，消毒命中 3） |
| 相对源损失 > 50%（消毒剥光） | 0 |
| **失效数（计划口径：空主体或仅剩骨架）** | **44 > 15（1/3 门槛）→ STOP** |

**按计划 Verify 口径（语义失效 = 空主体或仅剩骨架 ≤ 15 张），44/45 失效，STOP 门触发，未进入 Step 4（渲染切换）。**

## 归因（关键发现：失效不是消毒造成的）

- **消毒管线本身几乎无损**：相对源长度损失 >50% 的为 0 张；标题、描述（goal）全部非空；署名剥离（如「沐殇专用克苏鲁标题」→「克苏鲁标题」）属于预期白标行为。
- **44 张的主体在源目录里就是占位骨架**：`rawPrivateConfigs`（scorecard 元数据）经 `buildRealAssets` 生成的 template 一律为 `[商业定制专属提示词体] 针对长篇小说 <标题> 骨架推进。`——真实提示词正文从未进入本仓库的治理目录。副本如实继承了骨架。
- **运行时先例同样产出骨架**：`POST /api/skills/sanitize/:assetId`（server/routes/skills.ts:284）把 `sanitizeWhiteLabelText(asset.template)` 写入 style 字段——今天点「消毒并启用」落库的就是同样的占位正文。副本与运行时先例语义一致，没有引入新的退化。
- 副本标题/描述字段（货架展示面）语义完好；失效集中在不可见的 prompt 主体。若把副本提升为公开货架卡（Step 4），用户会得到「展示文案正常、实际主体是占位符」的卡。

## 样例（源 → 副本）

| 字段 | 源（private-221） | 副本（sanitized-private-221） |
|---|---|---|
| title | 沐殇专用克苏鲁标题 | 克苏鲁标题 |
| goal | 利用定制付费资产 沐殇专用克苏鲁标题 全链路推进长篇正文或提供题材适配。 | 利用定制付费资产 克苏鲁标题 全链路推进长篇正文或提供题材适配。 |
| template | `[商业定制专属提示词体] 针对长篇小说 沐殇专用克苏鲁标题 骨架推进。` | `[商业定制专属提示词体] 针对长篇小说 克苏鲁标题 骨架推进。`（占位骨架） |

| 字段 | 源（raw-comp-brand-detector） | 副本（sanitized-raw-comp-brand-detector） |
|---|---|---|
| title | 墨流竞品检测模板 | 外部工具竞品检测模板（品牌词映射） |
| template | `你是一个检测助手。如有问题联系 QQ群 123456。推荐使用墨流。` | `你是一个检测助手。如有问题联系 。推荐使用外部工具。`（QQ 群删除后残留悬空「联系 。」） |

## 逐张统计表

| 副本 id | 大类 | 判定 | 主体长度(源→副本) | 源主体性质 | 备注 |
|---|---|---|---|---|---|
| sanitized-raw-comp-brand-detector | quality-guardrail | 真实主体(薄弱<40字) | 34→26 | 源为真实 | 消毒命中:3 |
| sanitized-private-222 | style-reference | 仅剩骨架(源即占位) | 36→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-221 | constellation-pack | 仅剩骨架(源即占位) | 35→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-220 | constellation-pack | 仅剩骨架(源即占位) | 38→34 | 源即占位 | 消毒命中:2 |
| sanitized-private-219 | constellation-pack | 仅剩骨架(源即占位) | 38→34 | 源即占位 | 消毒命中:2 |
| sanitized-private-218 | constellation-pack | 仅剩骨架(源即占位) | 46→42 | 源即占位 | 消毒命中:2 |
| sanitized-private-217 | constellation-pack | 仅剩骨架(源即占位) | 35→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-216 | constellation-pack | 仅剩骨架(源即占位) | 35→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-215 | constellation-pack | 仅剩骨架(源即占位) | 35→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-214 | constellation-pack | 仅剩骨架(源即占位) | 35→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-213 | constellation-pack | 仅剩骨架(源即占位) | 36→32 | 源即占位 | 消毒命中:2 |
| sanitized-private-212 | constellation-pack | 仅剩骨架(源即占位) | 35→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-211 | constellation-pack | 仅剩骨架(源即占位) | 38→34 | 源即占位 | 消毒命中:2 |
| sanitized-private-210 | constellation-pack | 仅剩骨架(源即占位) | 38→34 | 源即占位 | 消毒命中:2 |
| sanitized-private-209 | constellation-pack | 仅剩骨架(源即占位) | 35→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-208 | constellation-pack | 仅剩骨架(源即占位) | 35→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-207 | constellation-pack | 仅剩骨架(源即占位) | 35→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-206 | constellation-pack | 仅剩骨架(源即占位) | 38→34 | 源即占位 | 消毒命中:2 |
| sanitized-private-205 | constellation-pack | 仅剩骨架(源即占位) | 36→32 | 源即占位 | 消毒命中:2 |
| sanitized-private-204 | constellation-pack | 仅剩骨架(源即占位) | 38→34 | 源即占位 | 消毒命中:2 |
| sanitized-private-203 | utility-tool | 仅剩骨架(源即占位) | 33→29 | 源即占位 | 消毒命中:2 |
| sanitized-private-202 | author-workflow | 仅剩骨架(源即占位) | 32→32 | 源即占位 | 消毒命中:2 |
| sanitized-private-201 | author-workflow | 仅剩骨架(源即占位) | 32→32 | 源即占位 | 消毒命中:2 |
| sanitized-private-200 | author-workflow | 仅剩骨架(源即占位) | 32→32 | 源即占位 | 消毒命中:2 |
| sanitized-private-199 | style-reference | 仅剩骨架(源即占位) | 35→35 | 源即占位 | 消毒命中:2 |
| sanitized-private-198 | quality-guardrail | 仅剩骨架(源即占位) | 30→30 | 源即占位 | 消毒命中:0 |
| sanitized-private-197 | utility-tool | 仅剩骨架(源即占位) | 32→32 | 源即占位 | 消毒命中:0 |
| sanitized-private-195 | utility-tool | 仅剩骨架(源即占位) | 28→28 | 源即占位 | 消毒命中:0 |
| sanitized-private-192 | style-reference | 仅剩骨架(源即占位) | 34→28 | 源即占位 | 消毒命中:2 |
| sanitized-private-191 | author-workflow | 仅剩骨架(源即占位) | 34→28 | 源即占位 | 消毒命中:2 |
| sanitized-private-190 | author-workflow | 仅剩骨架(源即占位) | 34→28 | 源即占位 | 消毒命中:2 |
| sanitized-private-189 | utility-tool | 仅剩骨架(源即占位) | 37→31 | 源即占位 | 消毒命中:2 |
| sanitized-private-188 | utility-tool | 仅剩骨架(源即占位) | 35→29 | 源即占位 | 消毒命中:2 |
| sanitized-private-187 | utility-tool | 仅剩骨架(源即占位) | 34→28 | 源即占位 | 消毒命中:2 |
| sanitized-private-186 | utility-tool | 仅剩骨架(源即占位) | 34→34 | 源即占位 | 消毒命中:0 |
| sanitized-private-185 | author-workflow | 仅剩骨架(源即占位) | 34→28 | 源即占位 | 消毒命中:2 |
| sanitized-private-170 | platform-criteria | 仅剩骨架(源即占位) | 34→34 | 源即占位 | 消毒命中:0 |
| sanitized-private-169 | style-reference | 仅剩骨架(源即占位) | 33→33 | 源即占位 | 消毒命中:0 |
| sanitized-private-167 | author-workflow | 仅剩骨架(源即占位) | 34→34 | 源即占位 | 消毒命中:2 |
| sanitized-private-161 | style-reference | 仅剩骨架(源即占位) | 31→31 | 源即占位 | 消毒命中:0 |
| sanitized-private-158 | style-reference | 仅剩骨架(源即占位) | 30→30 | 源即占位 | 消毒命中:0 |
| sanitized-private-106 | style-reference | 仅剩骨架(源即占位) | 30→30 | 源即占位 | 消毒命中:0 |
| sanitized-private-92 | author-workflow | 仅剩骨架(源即占位) | 40→34 | 源即占位 | 消毒命中:2 |
| sanitized-private-91 | author-workflow | 仅剩骨架(源即占位) | 40→34 | 源即占位 | 消毒命中:2 |
| sanitized-private-90 | author-workflow | 仅剩骨架(源即占位) | 38→32 | 源即占位 | 消毒命中:2 |

## 给重新评估的输入（对应 STOP action「重新评估砍特性分支」）

1. **副本的价值当前≈0**：副本展示字段（标题/描述）可用，但 prompt 主体是占位符；「消毒并启用」运行时特性今天产出的也是同样占位正文。生成侧副本只是把这一现状显式化了。
2. **真正的瓶颈在源数据**：`rawPrivateConfigs` 只有 scorecard 元数据，真实正文从未入库。要「扩过滤器保特性」成立，需先把 44 张候选的真实正文补进治理目录（或确认正文不存在而砍特性）。
3. **与 Safety Sandbox Door 的张力**：tests/prompt-assets-governed.test.ts:845 要求公开目录导出 template 必须为空。副本携带消毒后主体，只能放独立导出（本次用 `SANITIZED_SKILL_COPIES`）规避；若后续走渲染切换，该不变式边界需要产品层面重新拍板。
4. raw-comp-brand-detector 副本（grade F、score 45）不满足 `validateAssetV2` 的 runtime-ready 准入（score<60/grade F）；运行时端点同样不校验——若后续上货架，需要决定准入规则。

## 协调者决定（2026-09-12，主会话）

按计划 STOP action「重新评估砍特性分支」评估后裁定：

1. **Step 4（渲染切换）取消**。前提不成立：候选的 prompt 主体在源目录从未存在（44/45 为占位骨架），切换只会把空心卡推上公开货架。185 的「渲染只消费 sanitized 副本」对**有真实内容的卡**维持既定语义；候选类卡维持现状（不上架）。
2. **Step 1-2 保留**：过滤器单源化 + `SANITIZED_SKILL_COPIES` 独立导出是对运行时先例的诚实显式化（零消费面、新鲜度守卫齐全）。
3. **185 的根因改判**：不是工程问题，是**内容缺失**——`rawPrivateConfigs` 只有 scorecard 元数据。要让「消毒并启用」成为真特性，前置是把 44 张候选的真实正文补进治理目录（内容采购/授权任务）。在此之前运行时特性保持原样（空壳启用，与改动前行为一致，无新增退化）。
4. 附带裁决：raw-comp-brand-detector 副本 grade F/score 45 不满足 runtime-ready 准入（<60），与运行时端点的宽松行为不一致——若未来上架，准入按 `validateAssetV2` 收紧；另行知会产品。
5. Safety Sandbox Door 不变式（公开目录 template 为空）经 `SANITIZED_SKILL_COPIES` 独立导出维持，未被破坏。

状态：Plan 197 = STOP-RESOLVED（Step 1-2 DONE，Step 4 取消有据）；Plan 185 = BLOCKED→**根因改判：内容缺失（CONTENT-GATED）**，工程侧无进一步动作项。
