import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Item } from '../../../shared/types';

interface ItemsTabProps {
  items: Item[];
  addEntity: (type: 'item') => void;
  deleteEntity: (type: 'item', id: string) => void;
  updateEntity: (type: 'item', id: string, data: Partial<Item>) => void;
}

export function ItemsTab({
  items,
  addEntity,
  deleteEntity,
  updateEntity,
}: ItemsTabProps) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-theme-text font-serif">道具与物品</h2>
        <button
          onClick={() => addEntity('item')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"
        >
          <Plus size={16} />
          新增道具
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-6">
        {items.map((item) => (
          <div
            key={item.id}
            className="bg-theme-sidebar p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 group relative"
          >
            <button
              onClick={() => deleteEntity('item', item.id)}
              className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"
              aria-label="删除物品"
            >
              <Trash2 size={16} />
            </button>
            <input
              value={item.name}
              onChange={(e) => updateEntity('item', item.id, { name: e.target.value })}
              className="font-bold text-[17px] outline-none w-3/4 bg-transparent focus:bg-theme-sidebar/50 rounded px-1"
            />
            <input
              value={item.type}
              onChange={(e) => updateEntity('item', item.id, { type: e.target.value })}
              className="text-xs text-theme-accent outline-none w-1/2 bg-theme-accent/10 px-2 py-1 rounded-full text-center focus:bg-theme-accent/20 transition-colors"
              placeholder="道具类型(例如: 法器)"
            />
            <textarea
              value={item.description}
              onChange={(e) => updateEntity('item', item.id, { description: e.target.value })}
              placeholder="作用、来历、使用代价..."
              className="text-sm outline-none resize-none h-28 bg-theme-sidebar/10 p-2 rounded-lg border border-theme-border/30 focus:border-theme-border mt-2"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
