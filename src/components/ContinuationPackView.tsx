import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Trash2, Upload } from 'lucide-react';

import type { Novel, ContinuationPack } from '../../shared/types';
import { deleteContinuationPack, listContinuationPacks, updateContinuationPack } from '../lib/continuation-client';
import { parseContinuationPack } from '../lib/prompt-client';

interface ContinuationPackViewProps {
  novel: Novel;
  initialActivePackId?: string | null;
}

export function ContinuationPackView({ novel, initialActivePackId = null }: ContinuationPackViewProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [activePack, setActivePack] = useState<ContinuationPack | null>(null);
  const [packs, setPacks] = useState<ContinuationPack[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState('');
  const [editingTask, setEditingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');

  useEffect(() => {
    listContinuationPacks(novel.id).then(setPacks);
  }, [novel.id]);

  useEffect(() => {
    if (!initialActivePackId) return;
    const matchedPack = packs.find((pack) => pack.id === initialActivePackId);
    if (matchedPack) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing derived state from props
      setActivePack(matchedPack);
    }
  }, [initialActivePackId, packs]);

  async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  const handleParsePack = async () => {
    if (files.length === 0) return;
    setIsParsing(true);
    setError('');
    try {
      const documents = await Promise.all(files.map(async (file) => ({
        filename: file.name,
        filedata: await fileToBase64(file),
      })));
      const pack = await parseContinuationPack({ novelId: novel.id, title: `${novel.title} 续写资料包`, documents });
      setActivePack(pack);
      setPacks(prev => [pack, ...prev]);
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsParsing(false);
    }
  };

  const handleApprovePack = async (pack: ContinuationPack) => {
    await updateContinuationPack(pack.id, { status: 'approved' });
    setActivePack({ ...pack, status: 'approved', updatedAt: Date.now() });
    setPacks(prev => prev.map(p => p.id === pack.id ? { ...p, status: 'approved' } : p));
  };

  const handleDeletePack = async (packId: string) => {
    await deleteContinuationPack(packId);
    setActivePack(prev => prev?.id === packId ? null : prev);
    setPacks(prev => prev.filter(p => p.id !== packId));
  };

  const handleStartEditTask = () => {
    if (!activePack) return;
    setTaskDraft(activePack.continuationTask || '');
    setEditingTask(true);
  };

  const handleSaveTask = async () => {
    if (!activePack) return;
    await updateContinuationPack(activePack.id, { continuationTask: taskDraft });
    const updated = { ...activePack, continuationTask: taskDraft, updatedAt: Date.now() };
    setActivePack(updated);
    setPacks(prev => prev.map(p => p.id === activePack.id ? updated : p));
    setEditingTask(false);
  };

  const canApprove = activePack && activePack.canonFacts.length > 0 && activePack.contradictions.length === 0;

  return (
    <div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-serif font-bold text-theme-text">资料包管理</h1>
        <p className="text-sm text-theme-muted mt-1">
          上传世界观、大纲、人物设定、已有正文等资料，整理、审核并切换用于续写的资料包。
        </p>
      </div>

      {/* Upload */}
      <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-6 space-y-4">
        <div className="flex items-center gap-2"><Upload size={18} /><span className="font-bold text-theme-text">上传资料文件</span></div>
        <p className="text-xs text-theme-muted">支持 .txt / .md / .json / .docx，可一次选多个文件。</p>
        <input
          type="file"
          multiple
          accept=".txt,.md,.json,.docx"
          onChange={e => setFiles(Array.from(e.target.files || []))}
          className="block w-full text-sm text-theme-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-theme-sidebar file:text-theme-text hover:file:bg-theme-border/50"
        />
        {files.length > 0 && (
          <div className="text-xs text-theme-muted space-y-1">
            {files.map((f) => <div key={`${f.name}-${f.lastModified}`} className="flex items-center gap-2"><FileText size={12} />{f.name}</div>)}
          </div>
        )}
        <button
          onClick={handleParsePack}
          disabled={files.length === 0 || isParsing}
          className="px-4 py-2 rounded-xl bg-theme-text text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2"
        >
          {isParsing ? <Loader2 size={14} className="animate-spin" /> : null}
          {isParsing ? '解析中...' : '解析资料包'}
        </button>
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>

      {/* Active pack review */}
      {activePack && (
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-theme-text">{activePack.title}</div>
              <div className="text-xs text-theme-muted">
                状态：{activePack.status === 'approved' ? <span className="text-emerald-600">已确认</span> : <span className="text-amber-600">待审核</span>}
              </div>
            </div>
            {activePack.status === 'draft' && (
              <button
                onClick={() => handleApprovePack(activePack)}
                disabled={!canApprove}
                className="px-4 py-2 rounded-xl bg-theme-accent text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2"
              >
                <CheckCircle2 size={14} /> 确认并启用
              </button>
            )}
          </div>

          {activePack.contradictions.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              <div className="font-bold flex items-center gap-1"><AlertTriangle size={12} />发现资料冲突</div>
              {activePack.contradictions.map((c) => (
                <div key={`${c.severity}-${c.summary}`} className="mt-1">- [{c.severity}] {c.summary}</div>
              ))}
              <div className="mt-2 text-amber-600">请解决冲突后再确认启用。</div>
            </div>
          )}

          {activePack.canonFacts.length === 0 && activePack.status === 'draft' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              未识别到任何硬设定事实，无法确认启用。请检查上传资料是否包含世界观或设定信息。
            </div>
          )}

          {activePack.sourceMap && (
            <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 p-4 space-y-2">
              <div className="text-xs font-bold text-theme-text">资料结构地图</div>
              {activePack.sourceMap.sections.slice(0, 6).map((s) => (
                <div key={s.title} className="text-xs text-theme-muted">
                  <span className="font-bold text-theme-text">{s.title}</span>：{s.summary}
                </div>
              ))}
              {activePack.sourceMap.keyConflicts.length > 0 && (
                <div className="mt-2 pt-2 border-t border-theme-border">
                  <div className="text-[10px] font-bold text-amber-600 mb-1">资料间冲突</div>
                  {activePack.sourceMap.keyConflicts.map((c) => (
                    <div key={c} className="text-[10px] text-amber-700">- {c}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activePack.readingQuestions && activePack.readingQuestions.length > 0 && (
            <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 p-4 space-y-2">
              <div className="text-xs font-bold text-theme-text">资料审读问题</div>
              {activePack.readingQuestions.slice(0, 6).map((q, i) => (
                <div key={q.id || i} className="text-xs">
                  <span className="text-theme-accent font-bold">Q{i + 1}.</span>
                  <span className="text-theme-text ml-1">{q.question}</span>
                  <div className="text-[10px] text-theme-muted mt-0.5 ml-4">上下文：{q.context}</div>
                </div>
              ))}
            </div>
          )}

          {activePack.continuationGaps && activePack.continuationGaps.length > 0 && (
            <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 p-4 space-y-2">
              <div className="text-xs font-bold text-theme-text">续写缺口</div>
              {activePack.continuationGaps.slice(0, 5).map((g, i) => (
                <div key={g.id || i} className="rounded-lg border border-theme-border bg-theme-sidebar p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      g.severity === 'high' ? 'bg-red-100 text-red-700' :
                      g.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{g.severity}</span>
                    <span className="text-theme-text font-bold">{g.description}</span>
                  </div>
                  <div className="text-[10px] text-theme-muted mt-1.5">建议方向：{g.suggestedDirection}</div>
                </div>
              ))}
            </div>
          )}

          {/* Continuation Task - always visible and editable */}
          <div className="rounded-xl border border-theme-border bg-theme-sidebar p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-theme-text">续写主任务</div>
              {!editingTask && (
                <button
                  onClick={handleStartEditTask}
                  className="text-[10px] text-theme-accent hover:underline"
                >
                  编辑
                </button>
              )}
            </div>
            <p className="text-[10px] text-theme-muted">
              这批资料导入后，你希望系统续写的主任务方向。将用于分镜预填和自动生产摘要。
            </p>
            {editingTask ? (
              <div className="space-y-2">
                <textarea
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  placeholder="例如：从第三卷高潮处续写，主角团进入秘境后遭遇反派伏击..."
                  className="w-full h-20 bg-theme-sidebar border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/50 resize-none shadow-sm focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
                />
                <div className="flex gap-2">
                  <button onClick={handleSaveTask} className="px-3 py-1.5 rounded-lg bg-theme-accent text-white text-[10px] font-bold">
                    保存
                  </button>
                  <button onClick={() => setEditingTask(false)} className="px-3 py-1.5 rounded-lg bg-theme-sidebar text-theme-text text-[10px] font-bold border border-theme-border">
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-theme-text">
                {activePack?.continuationTask || <span className="text-theme-muted italic">未指定 — 点击编辑添加续写方向</span>}
              </div>
            )}
          </div>

          <details className="text-xs text-theme-muted">
            <summary className="cursor-pointer font-bold">展开结构化上下文</summary>
            <div className="mt-2 space-y-3 ml-4">
              <div><span className="font-bold">硬设定：</span>{activePack.canonFacts.map(f => f.text).join('；') || '无'}</div>
              <div><span className="font-bold">人物状态：</span>{activePack.characterStates.map(c => `${c.name}(${c.currentGoal})`).join('；') || '无'}</div>
              <div><span className="font-bold">剧情位置：</span>{activePack.plotState.currentTimeline} | {activePack.plotState.latestScene}</div>
            </div>
          </details>
        </div>
      )}

      {/* Pack history */}
      {packs.length > 0 && (
        <div className="rounded-2xl border border-theme-border bg-theme-sidebar p-6 space-y-3">
          <div className="font-bold text-theme-text text-sm">已上传资料包</div>
          {packs.map(pack => (
            <button
              key={pack.id}
              onClick={() => setActivePack(pack)}
              className={`block w-full text-left rounded-xl border px-4 py-3 text-xs ${
                activePack?.id === pack.id ? 'border-theme-accent bg-theme-accent/5' : 'border-theme-border hover:bg-theme-sidebar/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{pack.title}</span>
                <div className="flex items-center gap-2">
                  <span className={pack.status === 'approved' ? 'text-emerald-600' : 'text-amber-600'}>
                    {pack.status === 'approved' ? '已确认' : '待审核'}
                  </span>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); handleDeletePack(pack.id); }}
                    className="p-1 rounded hover:bg-red-50 text-theme-muted hover:text-red-500 transition-colors"
                    title="删除资料包"
                    aria-label="删除资料包"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="text-theme-muted mt-1">
                {pack.canonFacts.length} 条设定 · {pack.characterStates.length} 个人物 · {new Date(pack.createdAt).toLocaleDateString('zh-CN')}
              </div>
            </button>
          ))}
          {packs.length === 0 && <div className="text-xs text-theme-muted">暂无资料包，先上传文件并解析，再回来审核或启用。</div>}
        </div>
      )}
    </div>
  );
}
