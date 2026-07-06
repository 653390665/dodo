import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { TimelineEvent } from '../../../shared/types';

interface TimelineTabProps {
  timelineEvents: TimelineEvent[];
  addEntity: (type: 'timeline') => void;
  deleteEntity: (type: 'timeline', id: string) => void;
  updateEntity: (type: 'timeline', id: string, data: Partial<TimelineEvent>) => void;
}

export function TimelineTab({
  timelineEvents,
  addEntity,
  deleteEntity,
  updateEntity,
}: TimelineTabProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-theme-text font-serif">纪元与时间线</h2>
        <button
          onClick={() => addEntity('timeline')}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-theme-text text-white rounded-xl hover:bg-theme-text/90 shadow-md transition-all"
        >
          <Plus size={16} />
          新增时间节点
        </button>
      </div>
      <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-theme-border before:to-transparent">
        {timelineEvents.map((evt, idx) => (
          <div
            key={evt.id}
            className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group border-none"
          >
            {/* Timeline Dot */}
            <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-theme-accent text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 mx-auto absolute left-0 md:left-1/2 transform -translate-x-0 cursor-move">
              <span className="text-xs font-bold">{idx + 1}</span>
            </div>

            {/* Event Card */}
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] ml-14 md:ml-0 bg-theme-sidebar p-5 rounded-2xl border border-theme-border/50 shadow-sm flex flex-col gap-3 relative transition-all hover:shadow-md hover:border-theme-accent/50 z-10">
              <button
                onClick={() => deleteEntity('timeline', evt.id)}
                className="absolute top-2 right-2 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity bg-red-50 p-2 rounded-lg hover:bg-red-100"
                aria-label="删除历史事件"
              >
                <Trash2 size={16} />
              </button>

              <div className="flex flex-wrap items-center gap-2 pr-8">
                <input
                  value={evt.timestamp}
                  onChange={(e) => updateEntity('timeline', evt.id, { timestamp: e.target.value })}
                  className="font-mono text-sm font-bold text-theme-accent bg-theme-accent/10 px-2 py-1 rounded w-32 outline-none focus:bg-theme-accent/20 transition-colors"
                  placeholder="如: 第一纪元"
                />
                <input
                  value={evt.statusTag || ''}
                  onChange={(e) => updateEntity('timeline', evt.id, { statusTag: e.target.value })}
                  className="font-bold text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded w-24 outline-none focus:ring-1 focus:ring-amber-300"
                  placeholder="状态:进行中"
                />
              </div>

              <input
                value={evt.title}
                onChange={(e) => updateEntity('timeline', evt.id, { title: e.target.value })}
                className="font-bold text-lg outline-none w-full bg-transparent focus:bg-theme-sidebar/50 rounded px-1 -ml-1 mt-1"
                placeholder="大事件名称"
              />

              <textarea
                value={evt.description}
                onChange={(e) => updateEntity('timeline', evt.id, { description: e.target.value })}
                placeholder="事件详细描述、影响、关联人物..."
                className="text-sm outline-none resize-none h-24 bg-theme-sidebar/10 p-3 rounded-xl border border-theme-border/30 focus:border-theme-border leading-relaxed"
              />

              {/* Fast Reorder Actions */}
              <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 flex items-center bg-theme-sidebar shadow-sm border border-theme-border/50 rounded-full px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                <button
                  onClick={() => {
                    if (idx > 0) {
                      const prev = timelineEvents[idx - 1];
                      updateEntity('timeline', evt.id, { order: prev.order });
                      updateEntity('timeline', prev.id, { order: evt.order });
                    }
                  }}
                  className="text-[10px] text-theme-text px-2 py-0.5 hover:bg-theme-sidebar rounded"
                >
                  ↑ 前移
                </button>
                <span className="text-theme-border">|</span>
                <button
                  onClick={() => {
                    if (idx < timelineEvents.length - 1) {
                      const next = timelineEvents[idx + 1];
                      updateEntity('timeline', evt.id, { order: next.order });
                      updateEntity('timeline', next.id, { order: evt.order });
                    }
                  }}
                  className="text-[10px] text-theme-text px-2 py-0.5 hover:bg-theme-sidebar rounded"
                >
                  ↓ 后移
                </button>
              </div>
            </div>
          </div>
        ))}
        {timelineEvents.length === 0 && (
          <div className="text-center py-12 text-theme-muted text-sm italic">
            暂无时间节点，点击“新增时间节点”开始记录。
          </div>
        )}
      </div>
    </div>
  );
}
