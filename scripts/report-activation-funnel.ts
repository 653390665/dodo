/**
 * Plan 262 E6 · 激活漏斗离线复测（不连数据库）。
 *
 * 用法：
 *   curl -s -H "Authorization: Bearer $TOKEN" \
 *     'http://127.0.0.1:3000/api/product-events/export?days=90' -o /tmp/inkflow-events.json
 *   npx tsx scripts/report-activation-funnel.ts /tmp/inkflow-events.json [--days=90]
 *
 * 口径与 `/api/product-events/metrics` 同源：直接复用 `buildProductEventMetrics()`（纯函数），
 * 不在报告侧二次实现统计定义。
 *
 * 读数纪律（2026-09-24 埋点口径修复后）：
 * - `editor_enter` 每次进入编辑器/刷新都上报（dev 热重载会放大），判读优先看会话口径
 *   `editorEntrySessions`，不只看 `editorEntries`；
 * - `first_content_input` 语义 = 任意章节首次真实手输（2026-09-24 起放宽），旧数据不可与新数据合并比较；
 * - `writing_style_required` 按 `writing-style-required:{novelId}:{fingerprint}` 跨刷新去重；
 * - `distinctObjectIds` 是去重对象数，不是事件条数。
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { buildProductEventMetrics } from '../server/lib/db/product-events.js';
import type { ProductEvent } from '../shared/types/product-events.js';

/** 修复前/后口径分界线（埋点三处修复落地日）。 */
export const INSTRUMENTATION_FIX_CUTOFF_MS = Date.parse('2026-09-24T00:00:00+08:00');

export interface EventRollup {
  eventName: string;
  events: number;
  novels: number;
  sessions: number;
}

export function summarizeEventRollup(events: readonly ProductEvent[]): EventRollup[] {
  const byName = new Map<string, { events: number; novels: Set<string>; sessions: Set<string> }>();
  for (const event of events) {
    const entry = byName.get(event.eventName) ?? {
      events: 0,
      novels: new Set<string>(),
      sessions: new Set<string>(),
    };
    entry.events += 1;
    if (event.novelId) entry.novels.add(event.novelId);
    if (event.sessionId) entry.sessions.add(event.sessionId);
    byName.set(event.eventName, entry);
  }
  return [...byName.entries()]
    .map(([eventName, entry]) => ({
      eventName,
      events: entry.events,
      novels: entry.novels.size,
      sessions: entry.sessions.size,
    }))
    .sort((a, b) => b.events - a.events || a.eventName.localeCompare(b.eventName));
}

function formatRate(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatTime(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

export function renderFunnelReport(events: readonly ProductEvent[], days: number): string {
  const metrics = buildProductEventMetrics([...events], days);
  const rollup = summarizeEventRollup(events);
  const createdAt = events.map((event) => event.createdAt).filter((value) => Number.isFinite(value));
  const from = createdAt.length ? Math.min(...createdAt) : null;
  const to = createdAt.length ? Math.max(...createdAt) : null;
  const novels = new Set(events.map((event) => event.novelId).filter(Boolean) as string[]);
  const sessions = new Set(events.map((event) => event.sessionId).filter(Boolean) as string[]);
  const activation = metrics.writingActivation;
  const legacyEvents = events.filter(
    (event) => typeof event.createdAt === 'number' && event.createdAt < INSTRUMENTATION_FIX_CUTOFF_MS
  ).length;

  const lines: string[] = [];
  lines.push(`# 激活漏斗复测（窗口 ${days} 天）`, '');
  lines.push('## 采样');
  lines.push(`- 事件 ${events.length} 条 / 去重作品 ${novels.size} / 去重会话 ${sessions.size}`);
  lines.push(`- 时间范围 ${formatTime(from)} → ${formatTime(to)}（UTC 打印）`);
  lines.push(
    `- 修复前口径事件 ${legacyEvents} 条（< 2026-09-24）：不可与修复后事件合并比较`
  );
  lines.push('');
  lines.push('## 北星');
  lines.push(
    `- 成章数 acceptedChapters=${metrics.northStar.acceptedChapters}；活跃作品 activeNovels=${metrics.northStar.activeNovels}`
  );
  lines.push('');
  lines.push('## 激活漏斗（作品口径 / 会话口径）');
  lines.push(`- 进入编辑器：作品 ${activation.editorEntries} / 会话 ${activation.editorEntrySessions}`);
  lines.push(`- 首次手写输入：作品 ${activation.firstInputs} / 会话 ${activation.firstInputSessions}`);
  lines.push(`- 保存正文：作品 ${activation.contentSaves}`);
  lines.push(`- 续写跳步：作品 ${activation.continuationSkips}`);
  lines.push(
    `- 进入→首次输入转化：${formatRate(activation.entryToFirstInput.value)}（${activation.entryToFirstInput.numerator}/${activation.entryToFirstInput.denominator}）`
  );
  lines.push('');
  lines.push('## 能力链路');
  lines.push(
    `- 配置完成率：${formatRate(metrics.capabilities.configurationCompletion.value)}（${metrics.capabilities.configurationCompletion.numerator}/${metrics.capabilities.configurationCompletion.denominator}）`
  );
  lines.push(
    `- 预览接受率：${formatRate(metrics.rates.previewAcceptance.value)}（${metrics.rates.previewAcceptance.numerator}/${metrics.rates.previewAcceptance.denominator}）`
  );
  lines.push(`- 去重对象数 distinctObjectIds=${metrics.distinctObjectIds}（不是事件条数）`);
  lines.push('');
  lines.push('## 逐事件（事件 / 作品 / 会话）');
  for (const entry of rollup) {
    lines.push(`- ${entry.eventName}: ${entry.events} / ${entry.novels} / ${entry.sessions}`);
  }
  lines.push('');
  lines.push('## 判读纪律');
  lines.push('- editor_enter 每次进入编辑器/刷新都上报：真实流失优先看会话口径，避免被 dev 热重载放大。');
  lines.push('- first_content_input = 任意章节首次真实手输（2026-09-24 放宽）；旧事件语义不同，不得合并。');
  lines.push('- 样本是操作者狗粮（本机数据）时只能定工程问题，不能定产品 P0；阈值口径待拍板。');
  return lines.join('\n');
}

interface CliOptions {
  file: string;
  days: number;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const file = argv.find((arg) => !arg.startsWith('--'));
  if (!file) {
    throw new Error('用法：npx tsx scripts/report-activation-funnel.ts <export.json|-> [--days=90]');
  }
  const daysArg = argv.find((arg) => arg.startsWith('--days='));
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : 90;
  if (!Number.isFinite(days) || days <= 0) throw new Error(`--days 非法：${daysArg}`);
  return { file, days };
}

function main(): void {
  const { file, days } = parseCliArgs(process.argv.slice(2));
  const raw = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('导出内容不是事件数组：请用 GET /api/product-events/export');
  }
  process.stdout.write(renderFunnelReport(parsed as ProductEvent[], days) + '\n');
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href;
if (invokedDirectly) main();
