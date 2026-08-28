import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Plus, Radar, Search } from 'lucide-react';

import type { Chapter, SniffedEntities } from '../../shared/types';

interface AgentWorkspaceTracePanelProps {
  currentChapter: Chapter | null;
  isSniffing: boolean;
  sniffedEntities: SniffedEntities | null;
  onSniffEntities: () => Promise<void>;
  onAddSniffedEntity: (ent: SniffedEntities['newEntities'][number]) => Promise<void>;
  addingEntityNames: string[];
}

export function AgentWorkspaceTracePanel({
  currentChapter,
  isSniffing,
  sniffedEntities,
  onSniffEntities,
  onAddSniffedEntity,
  addingEntityNames,
}: AgentWorkspaceTracePanelProps) {
  return (
    <div className="space-y-6">
      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-xs font-bold text-theme-text flex items-center gap-2">
            <Search size={14} className="text-theme-accent" />
            本章设定嗅探器 (Entity Sniper)
          </h3>
        </div>
        <p className="text-[10px] text-theme-muted leading-relaxed mb-4">
          扫描本章分镜与正文，识别出场人物、地点与道具候选，并与设定库进行比对。
        </p>

        <button
          onClick={onSniffEntities}
          disabled={!currentChapter || isSniffing}
          className="w-full py-2 bg-theme-accent text-white rounded-xl text-[10px] font-bold shadow-sm hover:bg-theme-accent/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSniffing ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
          {isSniffing ? '设定正在巡航中...' : '立即识别本章设定'}
        </button>
      </div>

      {sniffedEntities && (
        <div className="space-y-4 pb-8">
          <div className="bg-theme-sidebar rounded-xl border border-theme-border p-4 shadow-sm">
            <h4 className="text-[10px] font-bold text-theme-text flex items-center gap-1.5 mb-3">
              <CheckCircle2 size={12} className="text-emerald-500" />
              已入库活跃实体 ({sniffedEntities.activeExisting.length})
            </h4>
            {sniffedEntities.activeExisting.length === 0 ? (
              <div className="text-[9px] text-theme-muted italic">本章未提及存量设定。</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {sniffedEntities.activeExisting.map((name) => (
                  <span key={name} className="text-[9px] px-2 py-1 bg-theme-sidebar border border-theme-border rounded hover:bg-theme-border/30 cursor-default transition-colors">
                    {name}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[8px] text-theme-muted mt-3">
              * 这些对象会纳入本章生成参考。
            </p>
          </div>

          <div className="bg-theme-sidebar rounded-xl border border-theme-border p-4 shadow-sm">
            <h4 className="text-[10px] font-bold text-theme-text flex items-center gap-1.5 mb-3">
              <AlertCircle size={12} className="text-amber-500" />
              未记录野生实体 ({sniffedEntities.newEntities.length})
            </h4>
            {sniffedEntities.newEntities.length === 0 ? (
              <div className="text-[9px] text-theme-muted italic">未发现新增“野生”设定。</div>
            ) : (
              <div className="space-y-2.5">
                {sniffedEntities.newEntities.map((ent) => (
                  <div key={`${ent.type}-${ent.name}`} className="flex flex-col gap-1.5 p-2.5 bg-amber-50/50 border border-amber-100 rounded-lg group">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-amber-900">{ent.name}</span>
                      <span className="text-[8px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded uppercase font-bold tracking-wider">
                        {ent.type}
                      </span>
                    </div>
                    <p className="text-[9px] text-amber-800/80 leading-relaxed">
                      上下文：{ent.context}
                    </p>
                    <div className="mt-1 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onAddSniffedEntity(ent)}
                        disabled={addingEntityNames.includes(ent.name)}
                        className="text-[10px] flex items-center gap-1 px-2 py-1 bg-theme-sidebar border border-amber-200 text-amber-700 hover:bg-amber-100 rounded shadow-sm font-bold disabled:opacity-50 transition-colors"
                      >
                        {addingEntityNames.includes(ent.name) ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                        {addingEntityNames.includes(ent.name) ? '正在生成词条...' : '添加到 World Bible'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
