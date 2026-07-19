import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, Loader2 } from 'lucide-react';

import { Chapter, PacingData } from '../../shared/types';
import { listChapters } from '../lib/chapter-client';
import { subscribeToChanges } from '../lib/db-transport';
import { startWorldJob } from '../lib/world-job-client';

interface Props {
  novelId: string;
}

export function PacingDashboard({ novelId }: Props) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [pacing, setPacing] = useState<PacingData[]>([]);
  const [loading, setLoading] = useState(false);
  const analyzeControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => setChapters(await listChapters(novelId)), [novelId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching with subscription
  useEffect(() => { refresh(); return subscribeToChanges(refresh); }, [novelId, refresh]);
  useEffect(() => () => analyzeControllerRef.current?.abort(), []);

  const handleAnalyze = async () => {
    const withContent = chapters.filter(c => c.content && c.content.trim().length > 0);
    if (withContent.length === 0) {
      alert('没有可分析的章节内容');
      return;
    }
    setLoading(true);
    analyzeControllerRef.current?.abort();
    const controller = new AbortController();
    analyzeControllerRef.current = controller;
    try {
      const MAX_CHAPTERS = 50;
      const slice = withContent.slice(-MAX_CHAPTERS);
      const { result } = await startWorldJob<{ chapters: Partial<PacingData>[] }>(
        '/api/analyze-pacing',
        { novelId, chapters: slice },
        {},
        controller.signal,
      );
      const raw = result.chapters;
      const enriched: PacingData[] = raw.map(r => {
        const ch = slice.find(c => c.id === r.chapterId);
        return {
          chapterId: r.chapterId || '',
          chapterTitle: ch?.title || '',
          order: ch?.order || 0,
          wordCount: ch?.wordCount || 0,
          tensionScore: r.tensionScore || 0,
          payoffCount: r.payoffCount || 0,
          emotionLabel: r.emotionLabel || '',
          suggestion: r.suggestion,
        };
      });
      setPacing(enriched);
    } catch (e) {
      if (controller.signal.aborted) return;
      alert('AI 分析失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (analyzeControllerRef.current === controller) {
        analyzeControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const avgTension = pacing.length > 0 ? Math.round(pacing.reduce((s, p) => s + p.tensionScore, 0) / pacing.length) : 0;
  const totalPayoffs = pacing.reduce((s, p) => s + p.payoffCount, 0);

  return (
    <div className="space-y-4">
      {/* Summary card */}
      {pacing.length > 0 && (
        <div className="bg-theme-text text-white p-4 rounded-2xl shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={16} className="text-theme-accent" />
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">节奏总览</span>
          </div>
          <div className="flex gap-4">
            <div>
              <div className="text-2xl font-black text-theme-accent">{avgTension}</div>
              <div className="text-[9px] opacity-50 uppercase">平均张力</div>
            </div>
            <div className="w-px bg-theme-sidebar/10" />
            <div>
              <div className="text-2xl font-black text-emerald-400">{totalPayoffs}</div>
              <div className="text-[9px] opacity-50 uppercase">总爽点数</div>
            </div>
            <div className="w-px bg-theme-sidebar/10" />
            <div>
              <div className="text-2xl font-black text-blue-400">{pacing.length}</div>
              <div className="text-[9px] opacity-50 uppercase">已诊断章</div>
            </div>
          </div>
        </div>
      )}

      {/* Analyze button */}
      <button onClick={handleAnalyze} disabled={loading}
        className="w-full py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />}
        {loading ? '分析中...' : pacing.length > 0 ? '重新分析节奏' : 'AI 节奏诊断'}
      </button>

      {/* Tension bar chart */}
      {pacing.length > 0 && (
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-4">张力曲线</h3>
          <div className="space-y-2">
            {pacing.map(p => {
              const chapter = chapters.find(c => c.id === p.chapterId);
              return (
                <div key={p.chapterId} className="flex items-center gap-3">
                  <span className="text-[9px] text-theme-muted w-16 truncate text-right">
                    {chapter?.title || '?'}
                  </span>
                  <div className="flex-1 h-5 bg-theme-sidebar/30 rounded-full overflow-hidden relative">
                    <div
                      className={`h-full rounded-full ${
                        p.tensionScore >= 70 ? 'bg-red-400' :
                        p.tensionScore >= 40 ? 'bg-amber-400' :
                        'bg-blue-400'
                      }`}
                    />
                  </div>
                  <span className="text-[9px] font-bold w-8 text-right">{p.tensionScore}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Emotion labels */}
      {pacing.length > 0 && (
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider mb-3">情绪分布</h3>
          <div className="flex flex-wrap gap-1.5">
            {pacing.map(p => (
              <span key={p.chapterId}
                className="text-[9px] px-2 py-1 bg-theme-sidebar rounded-full text-theme-text font-medium border border-theme-border">
                {p.emotionLabel} x{p.payoffCount}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {pacing.filter(p => p.suggestion).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider px-1">节奏建议</h3>
          {pacing.filter(p => p.suggestion).map(p => {
            const chapter = chapters.find(c => c.id === p.chapterId);
            return (
              <div key={p.chapterId} className="bg-amber-50/50 p-3 rounded-xl border border-amber-100 text-[10px] text-amber-900 leading-relaxed">
                <span className="font-bold">{chapter?.title}：</span>{p.suggestion}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
