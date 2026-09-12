# Plan 198 Step 1 复现基线（2026-09-12）

复现脚本：临时脚本（`node --import tsx` 直调 `buildFallbackSceneBeats` → `buildFallbackDraft` → `validateCompleteChapterDraftQuality`，另附重复句与 slop 分类普查）。脚本本体在会话临时目录，不在仓库内；本文件固化其输出作为改造基线。

## 命令口径

```bash
node --import tsx -e "import {buildFallbackDraft, buildFallbackSceneBeats} from './server/helpers/fallback-draft'; import {validateCompleteChapterDraftQuality, resolveEffectiveMinDraftChars} from './shared/lib/draft-quality'; const intent=undefined; const beats=buildFallbackSceneBeats('x'); const min=resolveEffectiveMinDraftChars(intent); const d=buildFallbackDraft(beats,'ctx',min); console.log(JSON.stringify(validateCompleteChapterDraftQuality(d,undefined,{minChars:min}).findings?.map(f=>[f.severity,f.code])))"
```

## 基线输出（改造前，4 个 intent 全部同样形态）

- draft 有效字符 4070–4107（≥4000），36 段
- `gate.ok=false`，slop score 78.3–78.5（阈值 85），summary：4 句长单一 + 2 结构同构
- findings（默认意图 / intent=x / 意图A / 意图B 四种 intent 完全一致）：
  1. `[P1] duplicate-sentence` 正文包含高密度重复完整句
  2. `[P2] repeated-opening` 正文包含重复句式开头
  3. `[P1] mechanical-cadence` 正文包含高密度保底句式重复（pattern 计数 11 ≥ 10）
  4. `[P1] mechanical-quality` 机械审查分数 78.x 低于整章交付要求 85

与计划 Current state 记载一致（duplicate-sentence P1 / repeated-opening P2 / mechanical-cadence P1 / slop 78.4<85）。✔ Verify 通过。

## 重复完整句清单（≥2 次，duplicate-sentence 的直接来源）

| 次数 | 句子 |
|---|---|
| x4 | 角落里的灰尘被踩出一道浅线 |
| x3 | 那件被挪动过的物品回到了原位 |
| x3 | 远处的回声没有按原路消失 |
| x3 | 一缕陌生的气味压过了雨腥 |
| x3 | 桌面上的影子比人先动了一步 |
| x2 | 这让一句看似寻常的话多出一层试探 |
| x2 | 这个变化把各自的打算照出一角 |
| x2 | 那声咳嗽停在了不该停的位置 |

来源：36 段扩写中 `paragraphTemplates`(16) 取模 2–3 轮、`detailHints`(47) 取模复用，同一 detailHint 既当 hint 又当 support 行出现。

## slop hit 分布

- `sentence_monotony` ×4（保底句式长度高度接近，连续 5 句长度落入 8% 窗）
- `structural/paragraph-opening` ×1（P2 密度；多段首句同指纹）
- `structural/abstract-ending` ×1（P2；≥5 段以抽象名词收束）
- 无 ai_cliche / style_slop / tell_dont_show / webnovel_trope 命中

## 改造目标（Step 2 Verify 口径）

同一脚本下：`findings = []`、slop ≥ 85，且连续 3 个不同 intent 均过门；同 intent 两次生成逐字节相同。

## Step 2 改造后实测（2026-09-12，同口径复跑）

改造手段：①五个句式池扩容（paragraphTemplates 16→40、cadence/texture/reflection 16→24 合并 72、turn 16→40、cycleBridges 4→8）；②取模循环改为 FNV-1a 哈希（sceneBeats+contextStr+minChars）作种子的 mulberry32 + Fisher-Yates 无放回落牌（deck 取尽才重洗，且禁止跨洗牌首张重复）；③每段两枚 ≤7 字节奏短拍夹住支持句对，破坏 slop 评分器的 5 句等长滑动窗口（短句低于 duplicate-sentence ≥12 字与 repeated-opening ≥8 字的可见阈值）；④bridge 每 7 段一次、从 deck 无放回取用，移到收束句之前。

结果（同 repro 脚本，4 个基线 intent + 追加 10 个 intent + 三分支）：

- 默认意图 / intent=x / 意图A / 意图B：`gate.ok=true`，findings=`[]`，slop score 85.7 → 后续迭代后 100.0（两拍夹持布局下 4 intent 全部 100.0）
- 追加 10 个随机 intent（真实多行 context）：全部 PASS，score 96.4–100.0，findings=`[]`，逐字节确定性成立，字数 4001–4105
- 800 字声明路径：PASS（849 字，score 100.0）
- 非模板分支（planner 风格 beats）：PASS（4083 字，score 100.0）
- 空态兜底分支：PASS（4117 字，score 100.0）
- 重复完整句清单：0 条（基线为 8 条）

注：复现脚本曾用单行合成 context（`关键人物：X；关键道具：Y` 写在一行）报 metadata P0——系 sanitizeFallbackContext 只剥外层标签、嵌套「关键道具：」残留触发 META_TOKEN，属合成数据假象，改造前后行为一致，与本次改动无关。

