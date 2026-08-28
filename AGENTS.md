# InkFlow Repository Instructions

## Scope
- Keep machine-wide preferences in `~/.codex/AGENTS.md`.

## Workflow
- Start with read-only analysis when the project or requirement is unclear; inspect the relevant code before editing.
- Think before coding: state assumptions, surface ambiguity, and ask when a risky choice cannot be inferred.
- Make surgical changes: implement only what was requested, touch only the files and lines needed, preserve existing style, and keep diffs small, reviewable, and easy to roll back.
- Prefer one scoped task at a time instead of multi-feature rewrites.
- Define a verifiable success condition for non-trivial changes and loop until the relevant check passes or the blocker is clear; every changed line should trace back to the user's request or to validation required by it.
- Preserve the existing React + TypeScript + Vite + Express + SQLite architecture unless there is a clear reason to change it.

## Safety
- Do not modify secrets, shell profiles, system settings, SSH config, or Git remotes.
- Do not change migrations, infrastructure, deployment settings, or destructive scripts without explicit approval.
- Do not add dependencies without approval.
- Do not disable sandboxing, bypass approvals, or enable network access for this repository without explicit approval.

## Validation
- Add or update tests when behavior changes.
- Run the smallest relevant validation after edits.
- If project metadata is incomplete, inspect the repository and infer the real commands before making changes.

## Technical Invariants (技术不变式)
改动以下领域时，先读对应规范文档再动手：

- **SQLite 备份/导出/导入**（`server/routes/db.ts`）→ `docs/specs/sqlite-backup.md`。不变式：运行中禁止物理拷贝 `data.db`（WAL 下丢最新数据、可损坏主库）；一律 `db.backup()` 快照导出，流结束或异常时同步清理临时文件；仅单例未初始化时允许降级直传。
- **LLM/API Key 状态展示**（`src/lib/llm-availability.ts` 及欢迎页、状态栏）→ `docs/specs/llm-status-honesty.md`。不变式：检测失败统一标记 `'unknown'` 并渲染琥珀色降级视觉与离线指引横幅，状态展示必须诚实。
- **驾驶舱 → 编辑器跨视图路由**（`launchState`）→ `docs/specs/cockpit-routing.md`。不变式：带意图的推荐动作（如 `'cockpit-audit'`/`'cockpit-polish'`）在数据就绪后静默自动执行，而非停留静态面板切换。

## Multi-Agent Development (多 Agent 并发)
- 触发：跨物理边界的多文件 feature、高风险重构、或用户明确要求并发交付时，启用三角色并发模型（Coordinator / Implementer / Gatekeeper），完整流程见 `docs/specs/multi-agent-workflow.md`。
- 豁免：单文件小修、文档、诊断评估类任务由单 Agent 完成，收尾跑一次最小校验（typecheck / 相关测试）。
- 硬性隔离（任何模式适用）：并发测试禁止写入运行中的 `data.db` 生产库（用内存库或独立 `test.db`）；子 Agent 凭证一律继承主会话，命令行不得明文密钥；并发子任务不得修改同一源文件。

## Output
- Communicate in Chinese unless the user explicitly asks otherwise.
- For non-trivial changes, report:
  1. Summary of changes
  2. Files changed
  3. Validation performed
  4. Risks or follow-up work
