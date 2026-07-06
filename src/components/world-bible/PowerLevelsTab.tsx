import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PowerLevel } from '../../../shared/types';

interface PowerLevelsTabProps {
  powerLevels: PowerLevel[];
  addEntity: (type: 'powerLevel') => void;
  deleteEntity: (type: 'powerLevel', id: string) => void;
  updateEntity: (type: 'powerLevel', id: string, data: Partial<PowerLevel>) => void;
}

export function PowerLevelsTab({
  powerLevels,
  addEntity,
  deleteEntity,
  updateEntity,
}: PowerLevelsTabProps) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-theme-text font-serif">境界/力量体系</h2>
        <button
          onClick={() => addEntity('powerLevel')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"
        >
          <Plus size={16} />
          新增境界
        </button>
      </div>
      <div className="flex flex-col gap-4">
        {powerLevels.map((lvl) => (
          <div
            key={lvl.id}
            className="bg-theme-sidebar p-5 rounded-2xl border border-theme-border/50 shadow-sm flex items-start gap-4 group relative"
          >
            <div className="flex flex-col items-center gap-1 shrink-0 mt-1">
              <div className="flex flex-col items-center gap-1 border border-theme-border/50 rounded-lg p-1 bg-theme-bg/50">
                <span className="text-[10px] text-theme-muted font-bold leading-none">T{lvl.tier}</span>
                <button
                  onClick={() => updateEntity('powerLevel', lvl.id, { tier: Math.max(1, lvl.tier - 1) })}
                  className="text-theme-muted hover:text-theme-accent disabled:opacity-30"
                  aria-label="提升等级"
                >
                  ↑
                </button>
                <button
                  onClick={() => updateEntity('powerLevel', lvl.id, { tier: lvl.tier + 1 })}
                  className="text-theme-muted hover:text-theme-accent disabled:opacity-30"
                  aria-label="降低等级"
                >
                  ↓
                </button>
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-2 relative">
              <button
                onClick={() => deleteEntity('powerLevel', lvl.id)}
                className="absolute top-0 right-0 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"
                aria-label="删除境界"
              >
                <Trash2 size={16} />
              </button>
              <input
                value={lvl.name}
                onChange={(e) => updateEntity('powerLevel', lvl.id, { name: e.target.value })}
                className="font-bold text-xl outline-none w-1/3 bg-transparent focus:bg-theme-sidebar/50 rounded px-1"
                placeholder="境界名称 (例如: 筑基期)"
              />
              <input
                value={lvl.characteristics}
                onChange={(e) => updateEntity('powerLevel', lvl.id, { characteristics: e.target.value })}
                className="text-sm font-medium text-theme-accent outline-none w-3/4 bg-transparent focus:bg-theme-sidebar/50 rounded px-1 -mx-1"
                placeholder="阶段特征 (例如: 寿元三百，可御空飞行)"
              />
              <textarea
                value={lvl.description}
                onChange={(e) => updateEntity('powerLevel', lvl.id, { description: e.target.value })}
                placeholder="详细说明该等级的力量表现、突破条件等..."
                className="text-sm outline-none resize-none h-20 bg-theme-sidebar/10 p-2 rounded-lg border border-theme-border/30 focus:border-theme-border"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
