import React from 'react';import Save from 'lucide-react/dist/esm/icons/save.js';

import type { Chapter, ChapterVersion } from '../types';

interface AgentWorkspaceVersionsPanelProps {
  currentChapter: Chapter | null;
  versions: ChapterVersion[];
  onSaveVersion: (author: 'user' | 'writer-agent') => Promise<void>;
  onRestoreVersion: (version: ChapterVersion) => void;
}

export function AgentWorkspaceVersionsPanel({
  currentChapter,
  versions,
  onSaveVersion,
  onRestoreVersion,
}: AgentWorkspaceVersionsPanelProps) {
  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-xs font-bold text-theme-text">章节时光机 (Time Machine)</h3>
          <button
            onClick={() => onSaveVersion('user')}
            disabled={!currentChapter || !currentChapter.content}
            className="text-[10px] bg-theme-text text-white px-2 py-1 rounded shadow-sm hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1"
          >
            <Save size={10} /> 存为快照
          </button>
        </div>
        <p className="text-[10px] text-theme-muted">记录每一次重大的 AI 扩写或用户保存。</p>
      </div>

      <div className="space-y-3 pb-8">
        {versions.slice().sort((a, b) => b.createdAt - a.createdAt).map((version) => (
          <div
            key={version.id}
            className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm relative group overflow-hidden"
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="text-[10px] font-bold text-theme-accent uppercase">
                  {version.author === 'writer-agent' ? '🤖 AI 辅笔' : '👤 手动存档'}
                </div>
                <div className="text-[9px] text-theme-muted">
                  {new Date(version.createdAt).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => onRestoreVersion(version)}
                className="px-2 py-1 bg-theme-bg text-theme-text text-[9px] font-bold rounded border border-theme-border hover:bg-theme-sidebar transition-colors"
              >
                还原此版本
              </button>
            </div>
            <div className="text-[10px] text-theme-muted line-clamp-3 leading-relaxed bg-theme-sidebar/10 p-2 rounded italic">
              {version.content.substring(0, 150)}...
            </div>
            <div className="mt-2 text-[9px] font-medium text-theme-muted/60">
              字数: {version.wordCount}
            </div>
          </div>
        ))}

        {versions.length === 0 && (
          <div className="text-center py-12 text-xs text-theme-muted opacity-50">
            暂无历史版本记录
          </div>
        )}
      </div>
    </div>
  );
}
