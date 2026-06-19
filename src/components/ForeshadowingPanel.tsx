import React, { useState, useEffect, useCallback } from 'react';import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import { Foreshadowing, Chapter } from '../types';
import { listChapters } from '../lib/chapter-client';
import { subscribeToChanges } from '../lib/db-transport';
import { listForeshadowings, createForeshadowing, updateForeshadowing, deleteForeshadowing } from '../lib/foreshadowing-client';

const STATUS_CONFIG = {
  planted: { label: '已埋设', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  hinted: { label: '已暗示', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  payoff: { label: '已回收', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

interface Props {
  novelId: string;
  currentChapterId?: string;
}

export function ForeshadowingPanel({ novelId, currentChapterId }: Props) {
  const [items, setItems] = useState<Foreshadowing[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [filter, setFilter] = useState<'all' | 'planted' | 'hinted' | 'payoff'>('all');
  const [detecting, setDetecting] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await listForeshadowings(novelId));
    setChapters(await listChapters(novelId));
  }, [novelId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching with subscription
  useEffect(() => { refresh(); return subscribeToChanges(refresh); }, [novelId, refresh]);

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    await createForeshadowing({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
      novelId,
      title: newTitle.trim(),
      description: newDesc.trim(),
      status: 'planted',
      relatedCharacterIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setNewTitle(''); setNewDesc(''); setShowAdd(false);
    refresh();
  };

  const handleStatusCycle = async (f: Foreshadowing) => {
    const next: Record<string, Foreshadowing['status']> = { planted: 'hinted', hinted: 'payoff', payoff: 'planted' };
    await updateForeshadowing(f.id, { status: next[f.status] });
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteForeshadowing(id);
    refresh();
  };

  const handleDetect = async () => {
    const targetChapter = currentChapterId
      ? chapters.find(c => c.id === currentChapterId)
      : chapters.find(c => c.content && c.content.trim().length > 0);
    if (!targetChapter || !targetChapter.content?.trim()) {
      alert('没有可分析的章节内容');
      return;
    }
    setDetecting(true);
    try {
      const res = await fetch('/api/detect-foreshadowing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterContent: targetChapter.content,
          chapterTitle: targetChapter.title,
          existingForeshadowings: items.map(i => ({ title: i.title, status: i.status })),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Server returned ${res.status}`);
      }
      const detected = await res.json();
      if (Array.isArray(detected)) {
        for (const d of detected) {
          await createForeshadowing({
            id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
            novelId,
            title: d.title,
            description: d.description,
            status: d.type === 'payoff' ? 'payoff' : 'planted',
            plantedChapterId: targetChapter.id,
            payoffChapterId: d.type === 'payoff' ? targetChapter.id : undefined,
            relatedCharacterIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
      refresh();
    } catch (e) {
      console.error(e);
      alert('AI 扫描失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDetecting(false);
    }
  };

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);
  const stats = {
    planted: items.filter(i => i.status === 'planted').length,
    hinted: items.filter(i => i.status === 'hinted').length,
    payoff: items.filter(i => i.status === 'payoff').length,
  };

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex gap-2">
        {(['all', 'planted', 'hinted', 'payoff'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`text-[10px] px-2.5 py-1 rounded-full font-bold transition-all ${
              filter === s ? 'bg-theme-text text-white' : 'bg-white border border-theme-border text-theme-muted hover:bg-theme-sidebar'
            }`}>
            {s === 'all' ? `全部 ${items.length}` : `${STATUS_CONFIG[s].label} ${stats[s]}`}
          </button>
        ))}
      </div>

      {/* Auto-detect button */}
      <button onClick={handleDetect} disabled={detecting}
        className="w-full py-2 bg-theme-accent/10 text-theme-accent rounded-xl text-xs font-bold hover:bg-theme-accent/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
        {detecting ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        {detecting ? '扫描中...' : 'AI 扫描当前章节伏笔'}
      </button>
      <p className="text-[10px] text-theme-muted/50 text-center mt-1">
        扫描当前章节中可能存在的伏笔线索，自动识别并归类
      </p>

      {/* Add button */}
      {!showAdd && (
        <button onClick={() => setShowAdd(true)}
          className="w-full py-2 border-2 border-dashed border-theme-border rounded-xl text-xs text-theme-muted hover:border-theme-accent hover:text-theme-accent transition-colors flex items-center justify-center gap-2">
          <Plus size={14} /> 手动添加伏笔
        </button>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm space-y-3">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="伏笔标题（如：主角身世之谜）"
            className="w-full text-sm px-3 py-2 bg-theme-sidebar/30 border border-theme-border rounded-lg outline-none focus:border-theme-accent" />
          <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="伏笔描述..."
            className="w-full text-xs px-3 py-2 bg-theme-sidebar/30 border border-theme-border rounded-lg outline-none focus:border-theme-accent resize-none h-20" />
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={!newTitle.trim()} className="flex-1 py-2 bg-theme-accent text-white rounded-lg text-xs font-bold disabled:opacity-50">添加</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-theme-border rounded-lg text-xs text-theme-muted">取消</button>
          </div>
        </div>
      )}

      {/* Foreshadowing list */}
      <div className="space-y-2">
        {filtered.map(f => (
          <div key={f.id}
            className="bg-white rounded-xl border border-theme-border/40 shadow-sm p-3 group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-theme-text truncate">{f.title}</span>
                  <button onClick={() => handleStatusCycle(f)}
                    className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium cursor-pointer hover:opacity-80 transition-opacity ${STATUS_CONFIG[f.status].color}`}
                    title="点击切换状态">
                    {STATUS_CONFIG[f.status].label} ↻
                  </button>
                </div>
                {f.description && <p className="text-[10px] text-theme-muted line-clamp-2 leading-relaxed">{f.description}</p>}
              </div>
              <button onClick={() => handleDelete(f.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-600 transition-all shrink-0">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-xs text-theme-muted opacity-50">
            <Eye size={24} className="mx-auto mb-2 opacity-20" />
            {filter === 'all' ? '暂无伏笔记录，手动添加或使用 AI 扫描' : '该状态下无伏笔'}
          </div>
        )}
      </div>
    </div>
  );
}
