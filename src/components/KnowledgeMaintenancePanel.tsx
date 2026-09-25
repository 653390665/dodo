/**
 * 批次 C · 图谱维护入口（2026-09-26）：World Bible 图谱页的「从资料包重跑摄入」块。
 *
 * 行为约定（与 §5.6 验收一致）：
 * - 一键重跑：调 `runKnowledgeExtract`（幂等；重复执行只跳过已存在的台账/边）；
 * - 覆盖度展示：六项叙事元素 + 伏笔 / 关系边；
 * - 失败回退：只在成功时替换本地 coverage，失败保留旧值并给出可读错误（不做乐观更新）。
 */
import React, { useCallback, useState } from 'react';
import { DatabaseZap, Loader2, RefreshCw } from 'lucide-react';

import {
  KNOWLEDGE_SOURCE_PACK_MISSING,
  lineageCoverageFieldsOf,
  type LineageCoverage,
} from '../../shared/lib/knowledge-capabilities';
import { KnowledgeCapabilityRequestError, runKnowledgeExtract } from '../lib/knowledge-client';
import { toast } from '../lib/toast';

interface Props {
  novelId: string;
  /** 重跑成功后刷新宿主视图（World Bible 已订阅数据库变更，这里兜底直刷）。 */
  onCompleted?: () => void;
}

interface LastRun {
  xigangEntries: number;
  ledgerInserted: number;
  ledgerSkipped: number;
}

function describeKnowledgeRunError(error: unknown): string {
  if (error instanceof KnowledgeCapabilityRequestError) {
    if (error.code === KNOWLEDGE_SOURCE_PACK_MISSING)
      return '未找到续写资料包：请先导入资料包（含逐章细纲）再重跑。';
    if (error.status === 409) return '数据库已更新，本次结果已失效：请刷新后重试。';
    if (error.status === 404) return '作品不存在或已被删除。';
    return error.message || '知识谱系重跑失败，请稍后重试。';
  }
  return error instanceof Error && error.message
    ? error.message
    : '知识谱系重跑失败，请稍后重试。';
}

export function KnowledgeMaintenancePanel({ novelId, onCompleted }: Props) {
  const [running, setRunning] = useState(false);
  const [coverage, setCoverage] = useState<LineageCoverage | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRerun = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await runKnowledgeExtract(novelId);
      const report = result.coverage;
      setCoverage(report.coverage);
      setLastRun({
        xigangEntries: report.xigangEntries,
        ledgerInserted: report.ledgerInserted,
        ledgerSkipped: report.ledgerSkipped,
      });
      toast(
        report.ledgerInserted > 0
          ? `知识谱系已更新：台账新增 ${report.ledgerInserted} 条`
          : '知识谱系已是最新（无重复写入）',
        'success'
      );
      onCompleted?.();
    } catch (caught) {
      const message = describeKnowledgeRunError(caught);
      setError(message);
      toast(message, 'error');
    } finally {
      setRunning(false);
    }
  }, [novelId, onCompleted, running]);

  const narrativeFields = lineageCoverageFieldsOf('narrative');
  const graphFields = lineageCoverageFieldsOf('graph');
  const staleTotal = (coverage?.staleLedger ?? 0) + (coverage?.staleEdges ?? 0);

  return (
    <section
      data-testid="knowledge-maintenance-panel"
      className="shrink-0 rounded-2xl border border-theme-border/30 bg-theme-sidebar/20 p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-bold text-theme-text flex items-center gap-2">
            <DatabaseZap size={15} className="text-theme-accent" />
            <span>资料包知识谱系</span>
          </h3>
          <p className="text-xs text-theme-muted">
            从最近一次导入的续写资料包重跑摄入（细纲 → 伏笔台账 / 实体关系边）。重复执行只跳过已存在的记录。
          </p>
        </div>
        <button
          type="button"
          onClick={handleRerun}
          disabled={running}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-theme-accent text-theme-accent-contrast rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {running ? '正在重跑…' : '从资料包重跑摄入'}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-500">
          重跑失败：{error}
        </p>
      )}

      {lastRun && (
        <p className="text-xs text-theme-muted">
          最近一次：细纲条目 {lastRun.xigangEntries} · 台账新增 {lastRun.ledgerInserted} / 跳过{' '}
          {lastRun.ledgerSkipped}
        </p>
      )}

      {coverage ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            {narrativeFields.map((field) => (
              <div
                key={field.key}
                className="rounded-xl border border-theme-border/30 bg-theme-sidebar/20 px-3 py-2"
              >
                <div className="text-[11px] text-theme-muted">{field.label}</div>
                <div className="text-sm font-bold text-theme-text">{coverage[field.key]}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-theme-muted">
            {graphFields.map((field) => (
              <span key={field.key}>
                {field.label}：<span className="font-bold text-theme-text">{coverage[field.key]}</span>
              </span>
            ))}
          </div>
          {staleTotal > 0 && (
            <p role="status" className="text-[11px] text-amber-500">
              已有 {staleTotal} 行知识失效：章节删除等来源失效只打标不删除（重跑摄入不会清除失效标记）。
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-theme-muted">尚未重跑：点击右侧按钮后显示覆盖度数值。</p>
      )}
    </section>
  );
}
