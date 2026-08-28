import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Play, XCircle } from 'lucide-react';

import type { ChapterProductionRun } from '../../shared/types';
import { listChapterProductionRuns } from '../lib/chapter-production-db-client';
import { ChapterFactCandidateReview } from './ChapterFactCandidateReview';
import { applyChapterFactCandidate, previewChapterFactCandidate } from '../lib/chapter-fact-client';
import type { ChapterFactCandidate } from '../../shared/types/chapter-facts';
import { validateCompleteChapterDraftQuality } from '../../shared/lib/draft-quality';

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
  onStop?: () => void;
  onApply: (runOverride?: ChapterProductionRun) => void;
  showStartAction?: boolean;
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
  auditSource: _auditSource,
  statusMessage,
  onIntentChange,
  onStart,
  onStop,
  onApply,
  showStartAction = true,
}: ProductionRunReviewProps) {
  const [history, setHistory] = useState<ChapterProductionRun[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [confirmingRunId, setConfirmingRunId] = useState<string | null>(null);
  const [factCandidate, setFactCandidate] = useState<ChapterFactCandidate | null>(null);
  const [loadingFactCandidate, setLoadingFactCandidate] = useState(false);
  const [submittingFactCandidate, setSubmittingFactCandidate] = useState(false);
  const submittingFactCandidateRef = useRef(false);
  const [factCandidateError, setFactCandidateError] = useState<string | null>(null);
  const recoveredRun = !running && run?.status === 'running' && !run.draftContent.trim()
    ? history.find((item) => item.status === 'review_required' && Boolean(item.draftContent.trim()))
    : undefined;
  const displayRun = recoveredRun || run;
  const displayRunning = running;
  const issues = displayRun?.continuityReport.issues || [];
  const timelineEvents = displayRun?.continuityReport.proposedPatch.timelineEventsToCreate || [];
  const foreshadowings = displayRun?.continuityReport.proposedPatch.foreshadowingsToCreate || [];
  const effectiveStatus = displayRun?.status;
  const draftQuality = displayRun?.draftContent ? validateCompleteChapterDraftQuality(displayRun.draftContent) : null;
  const auditStatus = displayRun?.continuityReport.auditMeta?.status ?? 'not_run';
  const auditSource = displayRun?.continuityReport.auditMeta?.source;
  const fallbackAudit = auditSource === 'fallback';
  const unknownAuditSource = Boolean(displayRun) && !auditSource;
  const failedAudit = auditStatus === 'fail';
  const auditSourceLabel = auditSource === 'fallback' ? '保底流程' : auditSource === 'model' ? '模型' : '未知';
  const canApply = !running
    && displayRun?.status === 'review_required'
    && displayRun.id === run?.id
    && Boolean(draftQuality?.ok)
    && !fallbackAudit
    && !unknownAuditSource
    && !failedAudit;
  const visibleError = error;
  const visibleRunError = displayRun?.errorMessage;
  const auditNeedsConfirmation = auditStatus === 'unknown' || auditStatus === 'not_run';
  const hasVerifiedScore = (auditStatus === 'pass' || auditStatus === 'fail') && typeof displayRun?.continuityReport.score === 'number' && Number.isFinite(displayRun.continuityReport.score);
  const factCandidateRunId = displayRun?.id;
  const factCandidateRunStatus = displayRun?.status;
  const factCandidateGeneration = displayRun?.continuityReport.databaseGeneration;

  const loadHistory = useCallback(async () => {
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
  }, [novelId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching on mount
    loadHistory();
  }, [novelId, loadHistory]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void loadHistory();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, novelId, loadHistory]);

  // Reload history when run status changes to 'applied'
  useEffect(() => {
    if (displayRun?.status === 'applied') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching on status change
      loadHistory();
    }
  }, [displayRun?.status, loadHistory]);

  useEffect(() => {
    if (!factCandidateRunId || !novelId || factCandidateGeneration === undefined || (factCandidateRunStatus !== 'review_required' && factCandidateRunStatus !== 'applied')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear a previous run's candidate before loading the next one
      setFactCandidate(null);
      return;
    }
    let active = true;
    setLoadingFactCandidate(true);
    setFactCandidateError(null);
    void previewChapterFactCandidate(factCandidateRunId, { novelId, databaseGeneration: factCandidateGeneration })
      .then((candidate) => { if (active) setFactCandidate(candidate); })
      .catch((candidateError: unknown) => { if (active) setFactCandidateError(candidateError instanceof Error ? candidateError.message : '事实候选预览失败'); })
      .finally(() => { if (active) setLoadingFactCandidate(false); });
    return () => { active = false; };
  }, [factCandidateGeneration, factCandidateRunId, factCandidateRunStatus, novelId]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
        <div className="text-sm font-bold text-theme-text">生成一章预览</div>
        <p className="mt-1 text-xs leading-5 text-theme-muted">
          生成下一章分镜、正文、文风审计和连续性报告。结果只会进入预览，点击接受后才写入章节和状态账本。
        </p>
        <textarea
          value={userIntent}
          onChange={(event) => onIntentChange(event.target.value)}
          aria-label="生产意图"
          className="mt-3 h-24 w-full resize-none rounded-xl border border-theme-border bg-theme-sidebar/20 p-3 text-sm outline-none focus:border-theme-accent"
        />
        {statusMessage && displayRunning ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <Loader2 size={14} className="animate-spin" />
            {statusMessage}
          </div>
        ) : null}
        {visibleError ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <XCircle size={14} />
            {visibleError}
          </div>
        ) : null}
        {displayRun?.status === 'applied' && !visibleError ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <CheckCircle2 size={14} />
            章节已成功写入，状态账本已更新。可在章节列表中查看新章节。
          </div>
        ) : null}
        {showStartAction ? (
          <button
            onClick={onStart}
            disabled={displayRunning}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-theme-text px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {displayRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {displayRunning ? '生产中...' : '开始生产一章'}
          </button>
        ) : null}
        {displayRunning && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="取消生产"
            className="mt-3 ml-2 inline-flex items-center gap-2 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
          >
            <XCircle size={15} aria-hidden="true" />
            取消生产
          </button>
        ) : null}
      </div>

      {displayRun ? (
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-theme-text">生产报告</div>
              <div className="mt-1 text-xs text-theme-muted">状态 {effectiveStatus}{hasVerifiedScore ? ` · 连续性评分 ${displayRun.continuityReport.score}/100` : ''}</div>
            </div>
            <button
              onClick={() => {
                if (!canApply || applying) return;
                if (auditNeedsConfirmation && confirmingRunId !== displayRun.id) {
                  setConfirmingRunId(displayRun.id);
                  return;
                }
                onApply(displayRun);
              }}
              disabled={applying || !canApply}
              className="inline-flex items-center gap-2 rounded-xl bg-theme-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              接受并写入
            </button>
          </div>

          {fallbackAudit ? (
            <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              保底草稿未经过模型审稿，不能直接接受并写入。请重试生成模型版本。
            </div>
          ) : null}

          {unknownAuditSource ? (
            <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              正文版本来源未知，不能直接接受并写入。请重新生成模型版本。
            </div>
          ) : null}

          {failedAudit ? (
            <div role="alert" className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
              审稿未通过，当前正文需要精修后重新审阅，不能直接写入。
            </div>
          ) : null}

          {auditNeedsConfirmation && confirmingRunId === displayRun.id && !fallbackAudit ? (
            <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-800">
              本次审计{auditStatus === 'not_run' ? '未运行' : '状态未知'}（来源：{auditSourceLabel}），没有可验证评分。仍要接受预览并写入吗？
              <div className="mt-2 flex gap-2">
                <button type="button" className="rounded-lg border border-theme-border px-2 py-1" onClick={() => setConfirmingRunId(null)}>取消</button>
                <button type="button" className="rounded-lg bg-theme-accent px-2 py-1 text-white" onClick={() => onApply(displayRun)}>确认写入</button>
              </div>
            </div>
          ) : null}

          {auditNeedsConfirmation && confirmingRunId !== displayRun.id && !fallbackAudit ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              审计{auditStatus === 'not_run' ? '未运行' : '状态未知'} · 来源：{auditSourceLabel}
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {visibleRunError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                失败原因：{visibleRunError}
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
                {displayRun.sceneBeats}
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
                {displayRunning && draftSource && (
                  <span className="inline-flex items-center gap-1 text-[9px] text-theme-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-theme-accent animate-pulse" />
                    接收中...
                  </span>
                )}
              </div>
              <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-theme-sidebar/25 p-3 font-serif text-sm leading-7 text-theme-text">
                {displayRun.draftContent}
              </pre>
              {draftQuality && !draftQuality.ok ? (
                <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                  正文候选未通过质量门禁，暂不能写入：{draftQuality.violations.join('；')}
                  {draftQuality.findings.flatMap((finding) => finding.evidence || []).slice(0, 3).map((evidence, index) => (
                    <div key={`quality-evidence-${index}`} className="mt-1 border-l-2 border-red-300 pl-2">
                      {evidence.line ? `第 ${evidence.line} 行：` : ''}“{evidence.snippet}”{evidence.suggestion ? ` 建议：${evidence.suggestion}` : ''}
                    </div>
                  ))}
                </div>
              ) : null}
              {draftQuality?.mechanicalReview?.status === 'pass' ? (
                <div className="mt-2 text-[10px] text-theme-muted" role="status">
                  机械审查 {draftQuality.mechanicalReview.score.toFixed(1)}/{draftQuality.mechanicalReview.threshold}：{draftQuality.mechanicalReview.summary}
                </div>
              ) : null}
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
            {loadingFactCandidate ? <div className="text-xs text-theme-muted">正在加载章节事实候选...</div> : null}
            {factCandidateError ? <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-2 text-xs text-amber-800">{factCandidateError}</div> : null}
            {factCandidate ? <ChapterFactCandidateReview candidate={factCandidate} canConfirm={displayRun?.status === 'applied'} submitting={submittingFactCandidate} onConfirm={(selection) => {
              if (submittingFactCandidateRef.current) return;
              submittingFactCandidateRef.current = true;
              setSubmittingFactCandidate(true);
              void applyChapterFactCandidate({
                novelId: factCandidate.novelId, runId: factCandidate.runId, databaseGeneration: factCandidate.databaseGeneration,
                candidateId: factCandidate.id, manuscriptContentHash: factCandidate.manuscript.contentHash,
                storyMemoryFingerprint: factCandidate.storyMemoryFingerprint, ...selection,
              }).then(() => {
                setLoadingFactCandidate(true);
                setFactCandidateError(null);
                return previewChapterFactCandidate(factCandidate.runId, {
                  novelId: factCandidate.novelId, databaseGeneration: factCandidate.databaseGeneration,
                });
              }).then((nextCandidate) => {
                setFactCandidate(nextCandidate.facts.length ? nextCandidate : null);
              }).catch((candidateError: unknown) => {
                setFactCandidateError(candidateError instanceof Error ? candidateError.message : '事实确认失败');
              }).finally(() => {
                submittingFactCandidateRef.current = false;
                setSubmittingFactCandidate(false);
                setLoadingFactCandidate(false);
              });
            }} /> : null}
          </div>
        </div>
      ) : null}

      {/* Production history */}
      {novelId ? (
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-4">
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
                    <span className="text-theme-muted">
                      {(item.continuityReport.auditMeta?.status === 'pass' || item.continuityReport.auditMeta?.status === 'fail')
                        && typeof item.continuityReport.score === 'number'
                        && Number.isFinite(item.continuityReport.score)
                        ? `${item.continuityReport.score}/100`
                        : '未评分'}
                    </span>
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
