# Plan 181: UX 反馈一致性——弹窗 Esc、导入可取消、失败面板人话、toast 语义、文案清理

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- src/components/WelcomeView.tsx src/components/WorldBibleView.tsx src/components/AIAssistant.tsx src/components/WorldBibleAssistant.tsx src/components/SkillsStudioView.tsx src/components/Library.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: Plan 175（AppShell 全屏文案若已被 174 处理则跳过对应步骤）
- **Category**: ux
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

五类交互一致性问题：WelcomeView 三个自定义弹窗不支持 Esc/遮罩关闭（与其余弹层分裂）；世界书智能导入的全屏遮罩不可取消（abort 链路已存在却没接 UI）；助手失败面板把内部枚举（`reasoning_only`/`finishReason: stop`）原样输出给作者；多处引导性提示误用 error 级红色 toast；残留装饰性英文（'Recent Works' 等）。逐项修复后，弹层交互模型、反馈语义与文案语言恢复一致。

## Current state

相关文件与角色：

- `src/components/SettingsModal.tsx:261-267` — 仓库 Esc 处理先例
- `src/components/WelcomeView.tsx:1061,1193,1361` — 三个裸 `fixed inset-0` 弹窗
- `src/components/WorldBibleView.tsx:1376-1411` — 导入全屏遮罩；`:748-750` 既有 `importControllerRef` AbortController；`:373-380` 卸载时 abort
- `src/components/AIAssistant.tsx:614-618` — 失败面板直出枚举；`WorldBibleAssistant.tsx:571` 同
- `src/components/SkillsStudioView.tsx:1695,1620,1734,1804,1815,1889` — 引导提示走 'error' 通道
- `src/components/Library.tsx:236,421` — 'Recent Works' / 'Inspiration Vault'

现状摘录：

```tsx
// WelcomeView.tsx:1061-1062（另两处 1193/1361 同构，均无 onKeyDown、遮罩无 onClick）
{selectedCardForRec && recResult && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-theme-bg/60 backdrop-blur-md p-4 animate-fade-in">
```

```tsx
// SettingsModal.tsx:262-267 — Esc 先例
useEffect(() => {
  if (!isOpen) return;
  ...
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
```

```tsx
// WorldBibleView.tsx:1376-1378 — 导入遮罩无取消按钮
{isImporting && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md animate-fade-in">
```

```tsx
// AIAssistant.tsx:616-618 — 内部枚举直出
{session.failure.reason && <div className="text-[10px]">原因：{session.failure.reason}</div>}
{session.failure.finishReason && <div className="text-[10px]">finishReason: {session.failure.finishReason}</div>}
```

```tsx
// SkillsStudioView.tsx:1694-1695 — 成功语义误用 error 级
setCandidateCardIds((ids) => ...);
toast('作品卡组已满：已加入候选，替换主/辅卡后生效。', 'error', 6500);
```

toast API（`src/lib/toast.ts:5,33`）：`type ToastType = 'info' | 'success' | 'error'`。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| Lint | `node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**：

- `src/components/WelcomeView.tsx`（三弹窗 Esc/遮罩）
- `src/components/WorldBibleView.tsx`（导入遮罩取消按钮）
- `src/components/AIAssistant.tsx`、`src/components/WorldBibleAssistant.tsx`（失败面板文案映射）
- `src/components/SkillsStudioView.tsx`（仅 toast 级别参数）
- `src/components/Library.tsx`（两处英文文案）
- 相关测试

**Out of scope**：

- `src/lib/toast.ts` 本体（三级语义设计正确，是被绕过）
- 确认单类弹窗的遮罩点击关闭（防误触，只统一 Esc）
- Plan 174 范围的删除确认、Plan 175 范围的导航命名

## Git workflow

每类一次提交；消息如 `fix(ux): welcome modals honor escape key`；完成即提交，不 push。

## Steps

### Step 1: WelcomeView 三弹窗支持 Esc

三个弹窗（`selectedCardForRec`、`showConfirmDetailsModal`、`showGuidedBubble`）各自的关闭 state setter 记为 `closeFn`（找到各弹窗 ✕/取消按钮所调用的 setter）。每处包一层 effect（仿 SettingsModal 先例，简化版）：

```tsx
React.useEffect(() => {
  if (!<openCondition>) return;
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeFn(); };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [<openCondition>]);
```

「生成设定确认单」（确认单类，防误触）不加遮罩点击关闭；另两个弹窗的遮罩 div 加 `onClick={(e) => { if (e.target === e.currentTarget) closeFn(); }}`。引导气泡若无可见 ✕，补一个右上角 X 按钮（lucide `X`，样式抄 WorldBibleAssistant.tsx:570 的 size-7 图标按钮）。

**Verify**: typecheck 0 错误；`grep -c "Escape" src/components/WelcomeView.tsx` ≥3

### Step 2: 导入遮罩可取消

`WorldBibleView.tsx:1376` 遮罩内、进度条下方加：

```tsx
<button
  type="button"
  onClick={() => { importControllerRef.current?.abort(); }}
  className="mt-1 px-4 py-1.5 rounded-lg border border-theme-border text-xs text-theme-muted hover:text-theme-text hover:bg-theme-border/20 transition-colors"
>
  取消导入
</button>
```

然后核对 abort 后的收尾路径：`grep -n "importControllerRef" src/components/WorldBibleView.tsx` 找到 abort 信号的 catch/finally 处理（`ImportAborted` 类错误分支应已有 `setIsImporting(false)`；若没有，在该 catch 中补 `setIsImporting(false); setImportProgress(0);`）。文件头已有 `appConfirm` import 则无需新增。

**Verify**: typecheck 0 错误；`grep -n "取消导入" src/components/WorldBibleView.tsx` 命中

### Step 3: 失败面板枚举映射

两个助手组件文件顶部各加映射表（或放 shared 常量；两处重复可接受，避免为 6 行建模块——以仓库现状口味为准，若 `shared/lib` 已有类似 failure 文案模块则复用）：

```ts
const FAILURE_REASON_COPY: Record<string, string> = {
  no_content: '模型未返回内容',
  reasoning_only: '模型只返回了推理过程，没有可用答案',
  length_exhausted: '输出因长度限制中断',
};
const FINISH_REASON_COPY: Record<string, string> = {
  stop: '正常结束', length: '达到长度上限', content_filter: '内容安全拦截',
};
```

`AIAssistant.tsx:616-618` 与 `WorldBibleAssistant.tsx:571`：`原因：{session.failure.reason}` 改为 `原因：{FAILURE_REASON_COPY[session.failure.reason] ?? '未知原因'}`；`finishReason: {...}` 行改为人话（`结束方式：{FINISH_REASON_COPY[...] ?? session.failure.finishReason}`）。注意 WorldBibleAssistant 顶部已有 reason 的一层翻译，去重后保留一行「原因」。`traceId` 的「诊断编号」行保留。

**Verify**: typecheck 0 错误；`grep -rn "finishReason: {" src/components/AIAssistant.tsx src/components/WorldBibleAssistant.tsx` 无命中

### Step 4: SkillsStudioView toast 语义分级

逐条核对以下行并改级：`:1695`（卡组已满入候选 → 'info'）、`:1620`、`:1734`、`:1804`、`:1815`、`:1889`。判定规则：文案描述「已生效/已加入/将在何时生效」→ 'info' 或 'success'；描述操作失败/请求失败 → 保留 'error'。若某行文案语义在改级后会自相矛盾（如「失败」却用 success），保持原级并在执行报告列出理由。

**Verify**: `grep -n "toast(" src/components/SkillsStudioView.tsx | grep error` 输出条数 ≤ 改前且每条均为真失败；typecheck 0 错误

### Step 5: Library 英文文案

`Library.tsx:236` `'Recent Works'` → `'最近作品'`；`:421` `'Inspiration Vault'` → `'灵感库'`（封面水印装饰，若该处为刻意设计元素则保留英文并加注释说明——以视觉自洽为准，默认替换）。

**Verify**: `grep -n "Recent Works\|Inspiration Vault" src/components/Library.tsx` 无命中

### Step 6: 回归测试

在既有相关测试文件中补两条轻量断言（不强求新文件）：

1. 失败面板：mock session.failure `{ reason: 'reasoning_only', finishReason: 'stop' }` → 渲染 AIAssistant → 断言文本含「推理过程」且不含 `finishReason:`。
2. WelcomeView Esc：渲染并打开 `selectedCardForRec` 弹窗 → `fireEvent.keyDown(window, { key: 'Escape' })` → 断言弹窗关闭（state 或 DOM 消失）。

**Verify**: `npm run test:frontend` → 全绿

## Test plan

见 Step 6；全量回归含 `skills-studio-plan158.test.tsx`（SkillsStudioView 行为级 39 用例，Step 4 不得破坏）。

## Done criteria

- [ ] typecheck 0 错误；`npm run test:frontend` 全绿
- [ ] `grep -c "Escape" src/components/WelcomeView.tsx` ≥3；`grep -n "取消导入" src/components/WorldBibleView.tsx` 命中
- [ ] `grep -rn "finishReason: {" src/components/AIAssistant.tsx` 无命中
- [ ] `grep -n "Recent Works" src/components/Library.tsx` 无命中
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 三弹窗的关闭 setter 不是简单 state（如嵌在多步向导状态机里）——报告弹窗结构。
- abort 导入后既有 catch 会把「用户取消」当错误 toast 出来——找到该分支并报告（修复方式：取消用专用错误码静默返回），改不动则 STOP。
- SkillsStudioView 的 toast 行号因 Plan 158 后续提交漂移 >±20 行——以 `grep -n "作品卡组已满"` 重新定位。

## Maintenance notes

- 新弹窗一律走 Radix AlertDialog（自带 Esc/焦点陷阱）或复用本计划的 effect 模式；评审时把「裸 fixed inset-0 无 Esc」列为拒绝项。
- 失败文案映射与 `docs/specs/llm-status-honesty.md` 的诚实降级精神一致——内部码可以出现在「复制诊断信息」里，不得作为主文案。
- 若 Plan 191 的文案清单后续新增英文残留，按本计划 Step 5 口径处理。
