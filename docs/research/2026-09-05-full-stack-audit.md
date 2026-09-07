# 全栈审计报告（前端 / 后端 / UX）

> 日期：2026-09-05
> 方法：三路并行审计代理，分别按 `impeccable`+项目 `improve`、`code-review`+`database-optimizer`+`security`、`web-design-guidelines` 方法论执行，扫描约 8.4 万行代码，实测 `~/.inkflow/data.db` 与主题变量
> 状态：批次 1（主题对比度）与批次 2（备份权限/temp 清扫）已于同日实施

## 评分总览

| 维度 | 评分 | 画像 |
|---|---|---|
| 后端+数据 | 7.5/10 | 鉴权/注入防护/事务边界/配额账本超单机工具平均水位，无 P0/P1 |
| 前端工程 | 6.5/10 | TS 纪律极佳（any 零使用），两个 2000+ 行巨石组件 + 三层 props 钻孔 |
| UX/可访问性 | 6.0/10 | 空态引导、错误恢复优于同类均值，深色主题对比度系统性崩坏 |

## 后端（top 发现）

- **[P2→已修] 备份与密钥文件权限 0644**：`~/.inkflow/data.db.bak`、`secure-key.bin` 实测 0644（主库 0600）。修法：backup 落盘后 chmod 0600 + 启动修复存量（`server/lib/db-init.ts:98`）
- **[P2→已修] 启动备份 temp 残留**：`data.db.bak.*.temp` 自 8/9 残留，违反 `specs/sqlite-backup.md` 零残留条目（`db-init.ts:83-91`）
- 正面：鉴权全覆盖无旁路、SQL 全参数化、导入校验防御深度出色、WriteQueue/generation 设计自洽、资源泄漏检查干净
- [P3] race 超时未补 abort（server-llm.ts:792）、Google/OpenAI 超时重试策略不一致、validation 调试日志死代码、baseUrl 未限协议、SSE token 进访问日志

## 前端（top 发现）

- **[P1] props 钻孔三层链**：`EditorView(109 props) → AgentWorkspace(85) → ProductionPanel → ProductionTab(34)`；根因：25 个领域 useState 压在 EditorView 本地未入 store
- **[P1] React.memo 被 7 处内联 props 击穿**（EditorView.tsx:2045-2160），编辑器每击键全树重渲染
- **[P1] 巨石组件**：SkillsStudioView 2750 行、EditorView 2169 行；对照组：book-factory/ 已按 Tab 拆分是正确范例
- [P2] useRef 与 state 双写防重入（isGeneratingContent 等）、product-events-client 4 处 fetch 不查 res.ok、大列表无虚拟化
- [P3] 死模块 ban-word-scanner.ts、useAuditPolishActions 30+ 参数
- 正面：any 零使用、@ts-expect-error 仅 1 处、SSE 统一封装无复制粘贴、eslint 零警告门禁

## UX/可访问性（top 发现）

- **[P0→已修] 深色主题对比度崩坏 94 处**：`bg-theme-accent + text-white` 60 处（~1.75:1）、`bg-theme-text + text-white` 34 处（~1.1:1，激活 Tab 文字不可见）。修法：新增 `--color-theme-accent-contrast` 变量 + `bg-theme-text` 场景改用 `text-theme-bg`
- **[P1] 确认/反馈机制 7 种并存**：AlertDialog / appConfirm / 行内确认条 / toast / 原生 alert×6（hooks/lib 内）/ 原生 confirm 当菜单（EditorStatusBar:46 确定=EPUB 取消=TXT）/ 原生 prompt×1
- **[P1→已修] SkillsStudioView:1614 toast 乱码**（2026-09-05 perl 批量替换引号时引入的回归，审计当场抓获并修复）
- [P1] `dark:` 变体 29 处未接 data-theme、RelationshipGraph 用了不存在的 `--theme-muted` 变量名、375px 左侧双栏无收纳策略、muted 文字用于 9-10px 小字（512 处）
- [P2] ProductionRunReview 历史加载失败被静默吞掉、PlanningTab 重置进度无确认、SVG 图谱无文本替代
- 正面：aria 语义规范且有测试守护、空态普遍有 CTR、错误恢复路径（可重试/冲突检测/字段级报错）优于同类均值

## 与业务诊断的合流

业务维度发现"写法确认 171:6 摩擦"；前端审计找到其结构性帮凶——同一流程的状态分散与 props 钻孔使"确认一次、处处留存"难以实现。两个维度指向同一重构：**production/writingStyle 流程状态收进 zustand store**（同时解性能与激活摩擦，估算 3-5 天，为下一迭代最大战略项）。

## 修复批次

1. ~~主题对比度 P0~~（已实施）
2. ~~备份权限 + temp 清扫~~（已实施）
3. 写法确认留存化 + 领域状态入 store（战略项）
4. 确认机制收敛 appConfirm+toast 双通道（含 hooks/lib 内 8 处原生弹窗）
5. P2/P3 攒批（虚拟化、术语表、dark: 变体、SSE token 日志脱敏等）
