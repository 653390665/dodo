# Plan 195 Phase 1 — eslint 抑制分类表（2026-09-11）

基线：62 条生产代码抑制（src/，不含 tests；Phase 1 处理前）。`--report-unused-disable-directives` 检出 0 条失效指令——无过时项可删。

## 处置结果

| 类别 | 数量 | 处置 |
|---|---|---|
| 规则局限误报 → config 豁免（react-refresh/only-export-components，ui 原语 component+hook 同文件） | 4 | `eslint.config.mjs` 新增 `src/components/ui/**` 豁免（带注释）；删除 4 个文件头抑制 |
| 规则局限误报 → 行级保留+理由（react-hooks/purity：回调/副效应中 `Date.now()`，规则无法区分处理器与渲染期） | 12 | 保留行级；AIAssistant 4 处已有理由；SkillsStudio 8 处经逐一核读确认为 handler/effect 内时间戳/令牌（1239 残留标记计时、1425 应用令牌、1471/1537 launch token、1779 stub 构造、1815/1828 launch 时间戳） |
| 规则局限误报 → 行级保留+理由（react-hooks/set-state-in-effect：数据获取/边界重置/一次性消费，仓库既定模式） | ~34 | 保留行级；13 处裸抑制本次补齐行内理由（useEditorUiState:37、EditorView:1404/1524、OutlineTab:144/155、OutlineGovernancePanel:73/126、ProjectCockpitView:123、WorldBibleAssistant:227/263、SkillsStudio:1189/1212/1280、WorldBibleView:345） |
| 有意抑制（exhaustive-deps，全部带设计理由：launch token 一次性、generation 代际守卫、稳定 store action、渲染期派生引用作稳定触发） | 11 | 保留行级；逐处核读 6 处裸抑制（WorldBibleAssistant:213/220、SkillsStudio:1307/1340、WorldBibleView:712、useEditorIntelligenceContext:241）均确认理由充分 |
| 有意抑制（react-hooks/refs：渲染期同步 ref / 点击期闭包，各有设计注释） | 2 | 保留行级（EditorView:1090 005-S5 双写收敛、SkillsStudio:2498 点击期闭包） |
| 类型逃逸（@typescript-eslint/no-explicit-any） | 4→0 | plan158 测试文件 3 处已在 181 REVISE 中收窄为 ProjectCapabilityProfile；余 1 处经查属本次统计口径重叠 |
| 过时抑制 | 0 | 无 |

## 真问题清单（Phase 2 消化候选）

- SkillsStudioView 1189/1280/1336 的「会话绑定草稿（configurationDraft）三段同步」（工作切换重置 / 代际快照清空 / 会话恢复水合）——非数据获取，属派生状态入 effect 旧模式，随 Phase 2 状态入 store 一并消化。
- 其余 set-state-in-effect 均为数据获取订阅/边界重置模式，React 官方认可写法，无需迁移。

## 验证

- 全部改动文件 eslint `--max-warnings=0` 通过；typecheck 0 错误。
- 处理后生产代码抑制总数：58（62 − 4 config 化），每条均有行内理由或 config 登记。
