import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Location } from '../../../shared/types';

interface LocationsTabProps {
  locations: Location[];
  addEntity: (type: 'location') => void;
  deleteEntity: (type: 'location', id: string) => void;
  updateEntity: (type: 'location', id: string, data: Partial<Location>) => void;
}

export function LocationsTab({
  locations,
  addEntity,
  deleteEntity,
  updateEntity,
}: LocationsTabProps) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-theme-text font-serif">地点与副本</h2>
        <button
          onClick={() => addEntity('location')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"
        >
          <Plus size={16} />
          新增地点
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
        {locations.map((loc) => (
          <div
            key={loc.id}
            className="bg-theme-sidebar p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 group relative"
          >
            <button
              onClick={() => deleteEntity('location', loc.id)}
              className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"
              aria-label="删除地点"
            >
              <Trash2 size={16} />
            </button>
            <div className="flex items-center gap-3 pr-10">
              <input
                value={loc.name}
                onChange={(e) => updateEntity('location', loc.id, { name: e.target.value })}
                className="font-bold text-lg outline-none w-1/2 bg-transparent focus:bg-theme-sidebar/50 rounded px-1"
              />
              <span className="text-theme-muted/50">—</span>
              <input
                value={loc.region}
                onChange={(e) => updateEntity('location', loc.id, { region: e.target.value })}
                className="text-sm outline-none w-1/3 bg-transparent text-theme-accent focus:bg-theme-sidebar/50 rounded px-1"
                placeholder="所属区域"
              />
            </div>
            <textarea
              value={loc.description}
              onChange={(e) => updateEntity('location', loc.id, { description: e.target.value })}
              placeholder="环境描写、危险等级、掉落物品、隐藏线索..."
              className="text-sm outline-none resize-none h-32 bg-theme-sidebar/10 p-3 rounded-xl border border-theme-border/30 focus:border-theme-border mt-2"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
