# 011 — 内容域键控：loader 保留、状态后端 store 化（分三阶段）

> 生成：2026-09-08。目标：005 完成标准的最后一块（AgentWorkspace props ≤60）。
> 设计原则（侦察结论驱动）：**不动加载器的竞态逻辑，只把状态后端从 useState 换成 store**——
> 消费端直接订阅，props 自然消亡；加载钩子的全部请求序号/代际一致性/revision 守卫逐行保留。

## 现状摘录（漂移检测锚点，HEAD = 写此稿时的 git rev-parse --short HEAD）

```ts
// useEditorData.ts:32-56 —— 每作品加载器，一次装 17 项状态
const [characters, setCharacters] = useState<Character[]>([]);
const [locations, setLocations] = useState<Location[]>([]);
/* … items/factions/powerLevels/timelineEvents/foreshadowings/librarySkills/
   skillUsageRecords/relationships/projectPreferenceProfile/chapters … */
const [globalOutline, setGlobalOutlineRaw] = useState<string>('');
const globalOutlineRevisionRef = useRef(0);

// useEditorData.ts:42-46 —— 用户编辑使 fetch 回写失效（revision 守卫）
const setGlobalOutline = useCallback((value: string | ((prev: string) => string)) => {
  globalOutlineRevisionRef.current += 1;
  setGlobalOutlineRaw(value);
}, []);

// useEditorData.ts:200-206 —— fetch 侧守卫：无在途写、revision 未变才接受远端值
if (
  freshNovel.globalOutline !== undefined
  && revisionAtStart === globalOutlineRevisionRef.current
  && !hasPendingWriteForExactKey(`novel:${novelId}:globalOutline`)
) {
  setGlobalOutlineRaw(freshNovel.globalOutline || '');
}

// useEditorContinuationPacks.ts（56 行）—— 选包域：packs 列表 + 选中 id + launchState 自动同步
```

## 设计决策

**Option B（选定）：单槽 store + 切换时强制 reset。**
不做 per-novelId 键控 map——EditorView 已有成熟的切换重置效应，store 单槽 + reset 语义等价且实现最小。
**关键变体：加载器钩子（useEditorData/useEditorContinuationPacks）原样保留**，仅把
`useState` 后端换成 `store.set`（1:1 语义：两者都是无合并的整值赋值）。
消费端（AgentWorkspace 子树、WritingSurface 等）直接订阅 store，EditorView 删对应透传。

被否决的方案：per-novelId 键控 map（状态生命周期与既有切换重置效应重复，双份失效逻辑易漂移）；
把 useEditorData 整体改写为 store（竞态守卫重写风险高，违反"不动加载逻辑"）。

## 执行状态

| 阶段 | 状态 |
|---|---|
| Phase 1 续写选包域 | ✅（continuation-pack-store，props -3；测试改 store 预置） |
| Phase 2 主纲内容域 | ✅（outline-content-store：globalOutline 值 + setGlobalOutline(revision++)/raw 分离 + setOutlineError；useEditorData 守卫逻辑逐行保留仅换后端；AW/Panel/OutlineTab 订阅；revision 留 store 供 fetch 守卫比较） |
| Phase 3 十个辅助数据集 | ✅（7 个 drilled 域入 store + AW/Panel 订阅；powerLevels/timelineEvents/foreshadowings 仅 EditorView 自用，保留在 hook 内） |
| Phase 4 收尾 | ✅（chapters + projectPreferenceProfile 入 store；Profile 回退语义保持；editor-data.test 补逐用例 store 重置） |

> 经验：OutlineTab 依赖 store 值做 hasOutline 分支——同文件测试需 beforeEach 重置 outline store，按用例语义补种子。

## 分阶段实施

### Phase 1 — 续写选包域（-3 props，风险低）
1. 新建 `src/stores/continuation-pack-store.ts`：`packs: ContinuationPack[]`、
   `selectedContinuationPackId: string`、`setPacks` / `setSelectedContinuationPackId`、
   `resetForNovel(novelId)`。
2. `useEditorContinuationPacks` 内部 useState → store 读写（返回值签名不变，
   EditorView 与 continuation-autostart 测试的调用面不变）。
3. AgentWorkspace / ProductionPanel / ProductionTab 删
   `continuationPacks / selectedContinuationPackId / setSelectedContinuationPackId`
   透传，改订阅 store。
4. EditorView 删三个透传；`useEditorContinuationPacks` 的 launchState 自动同步逻辑不动。

### Phase 2 — 主纲内容域（-3 props，含写竞守卫迁移）
1. `useEditorData` 内：`globalOutline/outlineError` 两 state 与
   `globalOutlineRevisionRef`、`setGlobalOutline`（revision++ 包装）迁入
   `editor-data-store` 的大纲切片：`{ globalOutline, outlineError, outlineRevision,
   setGlobalOutline（含 revision++）、setOutlineError、setGlobalOutlineRawFromFetch（revision 条件判断仍由 hook 计算，store 只存值）、resetForNovel }`。
2. hook 的 fetch 守卫条件（:200-206）逐行保留——只把最终的 `setGlobalOutlineRaw(...)`
   换成 store 写；`revisionAtStart === revision` 改读 store 的 revision 字段。
3. AgentWorkspace（或其下 OutlineTab）与 WritingSurface 直接订阅；
   EditorView 删 `globalOutline / onGlobalOutlineChange / outlineError` 透传，
   自身计算（:279 hasWorldBibleData、:629 novel 合并、:759 outlineChars）改订阅。

### Phase 3 — 辅助数据集（-10 props）
1. `editor-data-store` 增加十个数据集切片
   （characters/locations/items/factions/powerLevels/timelineEvents/foreshadowings/
   librarySkills/skillUsageRecords/relationships）+ 各自 setter + resetForNovel。
2. `useEditorData` 的 10 个 useState → store 写（:149-158 的条件赋值逐行保留）。
3. AgentWorkspace / WritingSurface / KnowledgePanel 直接订阅；EditorView 删十项透传。

## props 账目

| 阶段 | 删减 | 累计 |
|---|---|---|
| 现状 | — | 81 |
| Phase 1 | -3（packs/selected/setter） | 78 |
| Phase 2 | -3（globalOutline/onGlobalOutlineChange/outlineError） | 75 |
| 实际 Phase 3+4 | -11（7 个 drilled 数据集 + chapters + profile；powerLevels/timelineEvents/foreshadowings 为 EditorView 自用保留） | **70** |
| 剩余 | mountedSkillLoadout（@deprecated）、userIntent/contentRef/generationStatus 等 hook 直传值 | 70；≤60 需 Phase 5（outline 回调/handler 归组或 EditorView 拆分，另立批次评估） |

> ≤60 的最后 3 个：`chapters`（novel-store 化）、`projectPreferenceProfile`（随 Phase 3 的 profile 切片）、
> `stepEvidence`（派生下放）。已在账目内留位，属 Phase 4。

## 每阶段验证门

- `npx tsc --noEmit` → 0
- `npx eslint 改动文件` → 0
- `npx vitest -c vitest.config.frontend.ts run` → 全绿（841+）
- 手工切换两部作品 → 各域数据不串（含 globalOutline 编辑后切换再切回，草稿保留语义与现状一致）

## 边界

- **不改** useEditorData/useEditorContinuationPacks 的请求序号、代际一致性、
  pending-write 键检查等竞态逻辑（只换赋值后端）
- 不动 resolveWritingStyleRequest 留存化链路
- 不引入新依赖；per-novel 键控 map 方案被否决（见设计决策），如实施中发现单槽 reset
  出现跨作品数据闪烁，STOP 并回报，不得自行改用键控 map

## 完成标准

- [ ] 三阶段合并后 AgentWorkspace props ≤ 65（Phase 3 后）
- [ ] grep `globalOutline={|continuationPacks={|characters={` 于 EditorView→AgentWorkspace 透传 = 0
- [ ] 全量测试绿；作品切换无数据串扰（手工确认）

## 维护提示

新的"每作品数据"一律走 editor-data-store 切片 + useEditorData 加载器写入的模式；
禁止再在 EditorView 为子组件新增内容类 props。
