import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Faction } from '../../../shared/types';

interface FactionsTabProps {
  factions: Faction[];
  addEntity: (type: 'faction') => void;
  deleteEntity: (type: 'faction', id: string) => void;
  updateEntity: (type: 'faction', id: string, data: Partial<Faction>) => void;
}

export function FactionsTab({
  factions,
  addEntity,
  deleteEntity,
  updateEntity,
}: FactionsTabProps) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-theme-text font-serif">势力设定</h2>
        <button
          onClick={() => addEntity('faction')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"
        >
          <Plus size={16} />
          新增势力
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
        {factions.map((faction) => (
          <div
            key={faction.id}
            className="bg-theme-sidebar p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 group relative"
          >
            <button
              onClick={() => deleteEntity('faction', faction.id)}
              className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"
              aria-label="删除势力"
            >
              <Trash2 size={16} />
            </button>
            <input
              value={faction.name}
              onChange={(e) => updateEntity('faction', faction.id, { name: e.target.value })}
              className="font-bold text-lg outline-none w-1/2 bg-transparent focus:bg-theme-sidebar/50 rounded px-1"
            />
            <div className="flex gap-2">
              <input
                value={faction.leader}
                onChange={(e) => updateEntity('faction', faction.id, { leader: e.target.value })}
                className="text-sm font-bold outline-none w-1/2 bg-theme-sidebar border-b border-theme-border focus:border-theme-accent px-2 py-1 rounded"
                placeholder="首领/重要成员"
              />
              <input
                value={faction.territory}
                onChange={(e) => updateEntity('faction', faction.id, { territory: e.target.value })}
                className="text-sm outline-none w-1/2 bg-theme-sidebar border-b border-theme-border focus:border-theme-accent px-2 py-1 rounded"
                placeholder="据点/势力范围"
              />
            </div>
            <textarea
              value={faction.description}
              onChange={(e) => updateEntity('faction', faction.id, { description: e.target.value })}
              placeholder="势力背景、组织架构、行事风格..."
              className="text-sm outline-none resize-none h-32 bg-theme-sidebar/10 p-3 rounded-xl border border-theme-border/30 focus:border-theme-border mt-2"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
