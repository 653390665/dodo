import { toast } from '../lib/toast';
import { logger } from '../lib/client-logger';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Crosshair, Globe, Lightbulb, Loader2, MessageSquare, Plus, Sparkles, Trash2, User } from 'lucide-react';

import { IdeaFragment } from '../../shared/types';
import { listIdeaFragments, createIdeaFragment, updateIdeaFragment, deleteIdeaFragment } from '../lib/idea-client';
import { requireResponseDatabaseGeneration, subscribeToChanges } from '../lib/db-transport';
import { streamIdeaFragment } from '../lib/idea-fragment-stream';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  scene: <Crosshair size={14} />,
  dialogue: <MessageSquare size={14} />,
  character: <User size={14} />,
  plot_hook: <Sparkles size={14} />,
  world: <Globe size={14} />,
};

const TYPE_LABELS: Record<string, string> = {
  scene: '场景',
  dialogue: '对白',
  character: '角色',
  plot_hook: '剧情钩子',
  world: '世界观',
};

interface Props {
  novelId?: string;
  compact?: boolean;
}

export function IdeaFragmentBoard({ novelId, compact }: Props) {
  const [fragments, setFragments] = useState<IdeaFragment[]>([]);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<IdeaFragment['type']>('scene');
  const [expandingIds, setExpandingIds] = useState<Set<string>>(() => new Set());
  const expansionRequestsRef = useRef(new Map<string, { sequence: number; controller: AbortController }>());
  const expansionSequenceRef = useRef(new Map<string, number>());

  const refresh = useCallback(async () => {
    setFragments(await listIdeaFragments(novelId));
  }, [novelId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching with subscription
  useEffect(() => { refresh(); return subscribeToChanges(refresh); }, [novelId, refresh]);

  useEffect(() => () => {
    expansionRequestsRef.current.forEach(({ controller }) => controller.abort());
    expansionRequestsRef.current.clear();
  }, []);

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    const f: IdeaFragment = {
      id: Date.now().toString(),
      novelId,
      content: newContent.trim(),
      type: newType,
      status: 'raw',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await createIdeaFragment(f);
    setNewContent('');
    setFragments(prev => [f, ...prev]);
  };

  const handleExpand = async (f: IdeaFragment) => {
    if (expansionRequestsRef.current.has(f.id)) return;
    const sequence = (expansionSequenceRef.current.get(f.id) || 0) + 1;
    expansionSequenceRef.current.set(f.id, sequence);
    const controller = new AbortController();
    expansionRequestsRef.current.set(f.id, { sequence, controller });
    setExpandingIds((previous) => new Set(previous).add(f.id));

    const isCurrent = () => expansionRequestsRef.current.get(f.id)?.sequence === sequence;
    const originalExpansion = f.aiExpansion || '';
    const originalStatus = f.status;
    setFragments((previous) => previous.map((item) => (
      item.id === f.id ? { ...item, aiExpansion: '' } : item
    )));

    try {
      const res = await fetch('/api/expand-fragment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId, content: f.content, type: f.type }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const databaseGeneration = requireResponseDatabaseGeneration(res);

      await streamIdeaFragment({
        response: res,
        originalExpansion,
        isCurrent,
        onPreview: (text) => setFragments((previous) => previous.map((item) => (
          item.id === f.id ? { ...item, aiExpansion: text, status: originalStatus } : item
        ))),
        onCommit: async (text) => {
          if (!await updateIdeaFragment(f.id, { aiExpansion: text, status: 'expanded' }, databaseGeneration)) {
            throw new Error('灵感碎片已不存在，展开结果未保存。');
          }
          if (isCurrent()) {
            setFragments((previous) => previous.map((item) => (
              item.id === f.id ? { ...item, aiExpansion: text, status: 'expanded' } : item
            )));
          }
        },
      });
    } catch (e) {
      if (isCurrent()) {
        setFragments((previous) => previous.map((item) => (
          item.id === f.id ? { ...item, aiExpansion: originalExpansion, status: originalStatus } : item
        )));
        if (!(e instanceof Error && e.name === 'AbortError')) {
          logger.error('AI 展开失败:', e);
          toast('AI 展开失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
        }
      }
    } finally {
      if (isCurrent()) {
        expansionRequestsRef.current.delete(f.id);
        setExpandingIds((previous) => {
          const next = new Set(previous);
          next.delete(f.id);
          return next;
        });
      }
    }
  };

  const handleDelete = async (id: string) => {
    expansionRequestsRef.current.get(id)?.controller.abort();
    expansionRequestsRef.current.delete(id);
    expansionSequenceRef.current.set(id, (expansionSequenceRef.current.get(id) || 0) + 1);
    await deleteIdeaFragment(id);
    setFragments(prev => prev.filter(f => f.id !== id));
    setExpandingIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Input area */}
      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm space-y-3">
        <div className="flex gap-2">
          {(['scene', 'dialogue', 'character', 'plot_hook', 'world'] as const).map(t => (
            <button
              key={t}
              onClick={() => setNewType(t)}
              className={`text-[10px] px-2 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
                newType === t ? 'bg-theme-accent text-white' : 'bg-theme-sidebar text-theme-muted hover:bg-theme-border'
              }`}
            >
              {TYPE_ICONS[t]} {compact ? '' : TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="随手记下一个灵感碎片..."
            className="flex-1 text-sm px-3 py-2 bg-theme-sidebar/30 border border-theme-border rounded-lg outline-none focus:border-theme-accent transition-colors"
          />
          <button onClick={handleAdd} disabled={!newContent.trim()} className="px-4 py-2 bg-theme-accent text-white rounded-lg text-sm font-bold disabled:opacity-50 hover:opacity-90 transition-all">
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Fragment list */}
      <div className="space-y-3">
        {fragments.map(f => (
          <div
            key={f.id}
            className={`bg-theme-sidebar rounded-xl border shadow-sm overflow-hidden ${
              f.status === 'expanded' ? 'border-theme-accent/30' : 'border-theme-border/40'
            }`}
          >
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-theme-muted">{TYPE_ICONS[f.type]}</span>
                <span className="text-[10px] font-bold text-theme-muted uppercase">{TYPE_LABELS[f.type]}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                  f.status === 'raw' ? 'bg-amber-50 text-amber-700' :
                  f.status === 'expanded' ? 'bg-blue-50 text-blue-700' :
                  'bg-emerald-50 text-emerald-700'
                }`}>
                  {f.status === 'raw' ? '原始' : f.status === 'expanded' ? '已展开' : '已转化'}
                </span>
              </div>
              <p className="text-sm text-theme-text leading-relaxed">{f.content}</p>
              {f.aiExpansion && (
                <div className="mt-3 p-3 bg-theme-sidebar/20 rounded-lg text-xs text-theme-text leading-relaxed whitespace-pre-wrap border-l-2 border-theme-accent">
                  {f.aiExpansion}
                </div>
              )}
            </div>
            <div className="flex border-t border-theme-border/30">
              {f.status === 'raw' && (
                <button
                  onClick={() => handleExpand(f)}
                  disabled={expandingIds.has(f.id)}
                  className="flex-1 py-2 text-xs font-bold text-theme-accent hover:bg-theme-accent/5 transition-colors flex items-center justify-center gap-1.5"
                >
                  {expandingIds.has(f.id) ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  AI 展开
                </button>
              )}
              <button
                onClick={() => handleDelete(f.id)}
                className="flex-1 py-2 text-xs text-theme-muted hover:text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5"
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>
          </div>
        ))}
        {fragments.length === 0 && (
          <div className="text-center py-12 text-xs text-theme-muted opacity-50">
            <Lightbulb size={24} className="mx-auto mb-2 opacity-20" />
            暂无灵感碎片，在上方输入框记录你的脑洞
          </div>
        )}
      </div>
    </div>
  );
}
