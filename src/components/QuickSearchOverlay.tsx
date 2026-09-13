import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { request } from '../lib/http';
import { listChaptersMetadata } from '../lib/chapter-client';
import type { Novel } from '../../shared/types';

interface SearchHit {
  chapterId: string;
  text: string;
  score: number;
}

interface SearchResponse {
  available: boolean;
  embeddingStatus: string;
  indexed: boolean;
  /** Plan 201：兼容过滤排除比例 > 50% 时为 true（旧代际索引未参与检索） */
  stale: boolean;
  staleExcluded: number;
  hits: SearchHit[];
}

interface QuickSearchOverlayProps {
  novel: Novel;
  onClose: () => void;
  onJump: (chapterId: string) => void;
}

const DEBOUNCE_MS = 300;

/**
 * Plan 194 spike — Cmd+K 相似段落检索面板（最小竖切片）。
 * 只做：query → POST /api/search-similar → 结果列表 → 跳章。
 * embedding 未就绪 / 索引为空时给诚实降级提示（琥珀色语义），不假装空结果。
 */
export function QuickSearchOverlay({ novel, onClose, onJump }: QuickSearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [state, setState] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable' | 'unindexed' | 'error'
  >('idle');
  const [embeddingStatus, setEmbeddingStatus] = useState('');
  const [staleExcluded, setStaleExcluded] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    listChaptersMetadata(novel.id)
      .then((chapters) => {
        if (cancelled) return;
        const map = new Map<string, string>();
        chapters.forEach((chapter) => map.set(chapter.id, chapter.title));
        setTitleMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [novel.id]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return; // 空 query 由派生的 displayState 呈现 idle，不在此同步 setState
    const timer = setTimeout(async () => {
      setState('loading');
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const payload = await request<SearchResponse>('/api/search-similar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ novelId: novel.id, query: trimmed, limit: 8 }),
          signal: controller.signal,
        });
        if (!payload.available) {
          setEmbeddingStatus(payload.embeddingStatus);
          setState('unavailable');
          setStaleExcluded(0);
          setHits([]);
          return;
        }
        if (!payload.indexed) {
          setState('unindexed');
          setStaleExcluded(0);
          setHits([]);
          return;
        }
        setStaleExcluded(payload.stale ? payload.staleExcluded : 0);
        setHits(payload.hits);
        setActiveIndex(0);
        setState('ready');
      } catch {
        if (controller.signal.aborted) return;
        setState('error');
        setHits([]);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, novel.id]);

  const titleFor = (chapterId: string) => titleMap.get(chapterId) || '未知章节';

  // 空 query 派生为 idle，避免在 effect 里同步 setState 清理状态
  const displayState = query.trim() === '' ? ('idle' as const) : state;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && hits[activeIndex]) {
      onJump(hits[activeIndex].chapterId);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="全局语义搜索"
        className="w-full max-w-xl rounded-2xl border border-theme-border bg-theme-bg shadow-xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-theme-border px-4 py-3">
          <Search size={16} className="text-theme-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`在《${novel.title}》中搜索相似段落…`}
            aria-label="语义搜索关键词"
            className="flex-1 bg-transparent text-sm text-theme-text outline-none placeholder:text-theme-muted"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭搜索"
            className="text-theme-muted hover:text-theme-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto" data-testid="quick-search-results">
          {displayState === 'idle' && (
            <p className="px-4 py-6 text-xs text-theme-muted">
              输入关键词，按语义检索本书正文（手写保存与生产写入的章节，非字符串匹配）。
            </p>
          )}
          {displayState === 'loading' && (
            <p className="px-4 py-6 text-xs text-theme-muted">检索中…</p>
          )}
          {displayState === 'unavailable' && (
            <div className="px-4 py-6 text-xs">
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-amber-800">
                语义索引当前不可用（状态：{embeddingStatus || 'unknown'}
                ），暂时无法检索。可先正常写作，索引恢复后重试。
              </p>
            </div>
          )}
          {displayState === 'unindexed' && (
            <div className="px-4 py-6 text-xs">
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-amber-800">
                本书还没有可检索的索引。生产流程接受写入的章节立即入索引；编辑器手写正文在保存后约 1
                分钟内自动入索引，稍后再试。
              </p>
            </div>
          )}
          {displayState === 'error' && (
            <p className="px-4 py-6 text-xs text-rose-600">检索失败，请稍后重试。</p>
          )}
          {displayState === 'ready' && staleExcluded > 0 && (
            <p className="mx-4 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-800">
              检测到 {staleExcluded} 条旧代际索引未参与检索，建议重建索引。
            </p>
          )}
          {displayState === 'ready' && hits.length === 0 && (
            <p className="px-4 py-6 text-xs text-theme-muted">
              索引中没有匹配的段落。模型或索引代际不一致时旧索引会被排除。
            </p>
          )}
          {displayState === 'ready' &&
            hits.map((hit, index) => (
              <button
                key={`${hit.chapterId}-${index}`}
                type="button"
                onClick={() => onJump(hit.chapterId)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`block w-full px-4 py-3 text-left transition-colors ${index === activeIndex ? 'bg-theme-sidebar' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-theme-text">
                    {titleFor(hit.chapterId)}
                  </span>
                  <span className="text-[10px] text-theme-muted">
                    {(hit.score * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-theme-muted whitespace-normal break-words">
                  {hit.text}
                </p>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
