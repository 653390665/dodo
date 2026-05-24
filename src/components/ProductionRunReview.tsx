import React, { useEffect, useState } from 'react';import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Play from 'lucide-react/dist/esm/icons/play.js';
import XCircle from 'lucide-react/dist/esm/icons/x-circle.js';
import type { ChapterProductionRun } from '../types';
import { listChapterProductionRuns } from '../lib/chapter-production-db-client';

interface ProductionRunReviewProps {
  run: ChapterProductionRun | null;
  userIntent: string;
  running: boolean;
  applying: boolean;
  error?: string | null;
  novelId?: string;
  beatsSource?: 'fallback' | 'model' | null;
  draftSource?: 'fallback' | 'model' | null;
  auditSource?: 'fallback' | 'model' | null;
  statusMessage?: string | null;
  onIntentChange: (value: string) => void;
  onStart: () => void;
  onApply: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  running: '生产中',
  review_required: '待审核',
  applied: '已写入',
  failed: '失败',
};

export function ProductionRunReview({
  run,
  userIntent,
  running,
  applying,
  error,
  novelId,
  beatsSource,
  draftSource,
  auditSource,
  statusMessage,
  onIntentChange,
  onStart,
  onApply,
}: ProductionRunReviewProps) {
  const issues = run?.continuityReport.issues || [];
  const timelineEvents = run?.continuityReport.proposedPatch.timelineEventsToCreate || [];
  const foreshadowings = run?.continuityReport.proposedPatch.foreshadowingsToCreate || [];
  const [history, setHistory] = useState<ChapterProductionRun[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadHistory = async () => {
    if (!novelId) return;
    setLoadingHistory(true);
    try {
      const runs = await listChapterProductionRuns(novelId);
      setHistory(runs.sort((a, b) => b.createdAt - a.createdAt));
    } catch {
      // Silently fail history load
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [novelId]);

  // Reload history when run status changes to 'applied'
  useEffect(() => {
    if (run?.status === 'applied') {
      loadHistory();
    }
  }, [run?.status]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-theme-border bg-white p-4">
        <div className="text-sm font-bold text-theme-text">单章自动生产</div>
        <p className="mt-1 text-xs leading-5 text-theme-muted">
          生成下一章分镜、正文、文风审计和连续性报告。结果只会进入预览，点击接受后才写入章节和状态账本。
        </p>
        <textarea
          value={userIntent}
          onChange={(event) => onIntentChange(event.target.value)}
          aria-label="生产意图"
          className="mt-3 h-24 w-full resize-none rounded-xl border border-theme-border bg-theme-sidebar/20 p-3 text-sm outline-none focus:border-theme-accent"
        />
        {statusMessage && running ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <Loader2 size={14} className="animate-spin" />
            {statusMessage}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <XCircle size={14} />
            {error}
          </div>
        ) : null}
        {run?.status === 'applied' && !error ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <CheckCircle2 size={14} />
            章节已成功写入，状态账本已更新。可在章节列表中查看新章节。
          </div>
        ) : null}
        <button
          onClick={onStart}
          disabled={running}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-theme-text px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {running ? '生产中...' : '开始生产一章'}
        </button>
      </div>

      {run ? (
        <div className="rounded-2xl border border-theme-border bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-theme-text">生产报告</div>
              <div className="mt-1 text-xs text-theme-muted">状态 {run.status} · 连续性评分 {run.continuityReport.score}/100</div>
            </div>
            <button
              onClick={onApply}
              disabled={applying || run.status !== 'review_required'}
              className="inline-flex items-center gap-2 rounded-xl bg-theme-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              接受并写入
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {run.errorMessage ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                失败原因：{run.errorMessage}
              </div>
            ) : null}
            <section>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-theme-muted">
                分镜
                {beatsSource === 'fallback' && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">保底分镜</span>
                )}
                {beatsSource === 'model' && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">AI 分镜</span>
                )}
              </div>
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-theme-sidebar/25 p-3 text-xs leading-5 text-theme-text">
                {run.sceneBeats}
              </pre>
            </section>
            <section>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-theme-muted">
                正文预览
                {draftSource === 'fallback' && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">保底草稿</span>
                )}
                {draftSource === 'model' && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">AI 正文</span>
                )}
                {running && draftSource && (
                  <span className="inline-flex items-center gap-1 text-[9px] text-theme-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-theme-accent animate-pulse" />
                    接收中...
                  </span>
                )}
              </div>
              <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-theme-sidebar/25 p-3 font-serif text-sm leading-7 text-theme-text">
                {run.draftContent}
              </pre>
            </section>
            <section>
              <div className="text-xs font-bold uppercase tracking-wider text-theme-muted">连续性问题</div>
              <div className="mt-2 space-y-2">
                {issues.length ? issues.map((issue, index) => (
                  <div key={`${issue.category}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertTriangle size={13} />
                      {issue.severity} / {issue.category}
                    </div>
                    <div className="mt-1 leading-5">{issue.message}</div>
                    {issue.suggestedFix ? <div className="mt-1 text-amber-700">建议：{issue.suggestedFix}</div> : null}
                  </div>
                )) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    没有发现明显连续性冲突。
                  </div>
                )}
              </div>
            </section>
            <section>
              <div className="text-xs font-bold uppercase tracking-wider text-theme-muted">建议写入状态账本</div>
              <div className="mt-2 space-y-2 text-xs text-theme-muted">
                {timelineEvents.map((event, index) => (
                  <div key={`timeline-${index}`} className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-2">
                    时间线：[{event.timestamp}] {event.title} - {event.description}
                  </div>
                ))}
                {foreshadowings.map((entry, index) => (
                  <div key={`foreshadow-${index}`} className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-2">
                    新伏笔：{entry.title} - {entry.description}
                  </div>
                ))}
                {!timelineEvents.length && !foreshadowings.length ? (
                  <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-2">
                    本次没有建议新增时间线或伏笔。
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {/* Production history */}
      {novelId ? (
        <div className="rounded-2xl border border-theme-border bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-bold text-theme-text uppercase tracking-wider">生产历史</div>
            <button
              onClick={loadHistory}
              disabled={loadingHistory}
              className="text-[10px] text-theme-muted hover:text-theme-text transition-colors"
            >
              {loadingHistory ? '刷新中...' : '刷新'}
            </button>
          </div>
          {history.length === 0 ? (
            <div className="mt-3 text-xs text-theme-muted">尚无生产记录。输入意图后点击"开始生产一章"。</div>
          ) : (
            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Clock size={12} className="text-theme-muted" />
                      <span className="font-bold text-theme-text">
                        {new Date(item.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                        item.status === 'applied' ? 'bg-emerald-100 text-emerald-700' :
                        item.status === 'failed' ? 'bg-red-100 text-red-700' :
                        item.status === 'review_required' ? 'bg-amber-100 text-amber-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {STATUS_LABELS[item.status] || item.status}
                      </span>
                    </div>
                    <span className="text-theme-muted">{item.continuityReport.score}/100</span>
                  </div>
                  {item.errorMessage ? (
                    <div className="mt-1 text-red-600">{item.errorMessage}</div>
                  ) : null}
                  <div className="mt-1 text-theme-muted line-clamp-2">
                    {item.userIntent || item.sceneBeats?.slice(0, 80) || '无描述'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
