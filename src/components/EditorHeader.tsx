import React from 'react';import PanelRight from 'lucide-react/dist/esm/icons/panel-right.js';
import Cloud from 'lucide-react/dist/esm/icons/cloud.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import Bot from 'lucide-react/dist/esm/icons/bot.js';
import Minimize2 from 'lucide-react/dist/esm/icons/minimize-2.js';
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import { motion, AnimatePresence } from '../lib/motion';
import { Chapter, Skill } from '../types';
import { cn } from '../lib/utils';

interface EditorHeaderProps {
  currentChapter: Chapter | null;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  isAgentSidebarOpen: boolean;
  onToggleAgentSidebar: () => void;
  isEditorDataLoading: boolean;
  isAnyGenerating: boolean;
  isSyncing: boolean;
  syncSuccess: boolean;
  mountedSkills: Skill[];
  onVolumeNameChange: (newVol: string) => void;
  onTitleChange: (newTitle: string) => void;
}

export function EditorHeader({
  currentChapter,
  isSidebarOpen,
  onToggleSidebar,
  isFullscreen,
  onToggleFullscreen,
  isAgentSidebarOpen,
  onToggleAgentSidebar,
  isEditorDataLoading,
  isAnyGenerating,
  isSyncing,
  syncSuccess,
  mountedSkills,
  onVolumeNameChange,
  onTitleChange,
}: EditorHeaderProps) {
  return (
    <div className={cn(
      "h-14 px-6 border-b flex items-center justify-between transition-all duration-500 z-10",
      isFullscreen
        ? "bg-transparent border-transparent opacity-0 hover:opacity-100"
        : "bg-transparent border-theme-border"
    )}>
      <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? "收起章节列表" : "展开章节列表"}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-theme-border text-xs font-medium text-theme-text hover:bg-theme-sidebar/40 transition-colors"
        >
          <PanelRight size={14} className={cn(!isSidebarOpen && "rotate-180")} />
          {isSidebarOpen ? '收起章节' : '章节列表'}
        </button>
        <div className="h-4 w-px bg-theme-border/50" />
        <div className="flex flex-col min-w-0">
          <label htmlFor="chapter-volume-name" className="sr-only">所属卷</label>
          <input
            id="chapter-volume-name"
            name="chapter-volume-name"
            type="text"
            value={currentChapter?.volumeName || ''}
            onChange={(e) => onVolumeNameChange(e.target.value)}
            className="bg-transparent border-none font-sans text-[10px] text-theme-muted focus-visible:ring-2 focus-visible:ring-theme-accent/30 focus-visible:ring-offset-1 focus-visible:ring-offset-paper w-48 hover:bg-theme-border/30 rounded px-1 -ml-1 transition-colors"
            placeholder="所属卷（默认为正文卷）…"
          />
          <label htmlFor="chapter-title" className="sr-only">章节标题</label>
          <input
            id="chapter-title"
            name="chapter-title"
            type="text"
            value={currentChapter?.title || ''}
            onChange={(e) => onTitleChange(e.target.value)}
            className="bg-transparent border-none font-serif text-lg font-medium focus-visible:ring-2 focus-visible:ring-theme-accent/30 focus-visible:ring-offset-1 focus-visible:ring-offset-paper w-64 text-theme-text px-1 -ml-1 hover:bg-theme-border/30 rounded transition-colors"
            placeholder="章节标题"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <div className="hidden xl:flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/70 border border-theme-border text-[10px] text-theme-muted">
            <BookOpen size={11} className="text-theme-accent" />
            <span className="font-bold text-theme-text">世界观已就位</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/70 border border-theme-border text-[10px] text-theme-muted max-w-[240px] min-w-0">
            <Sparkles size={11} className="text-theme-accent" />
            <span className="shrink-0">挂载技能</span>
            <span className="truncate">
              {mountedSkills.length > 0 ? mountedSkills.map(s => s.name).join(' / ') : '未挂载'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/70 border border-theme-border text-[10px] text-theme-muted">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>AI 核心已连接</span>
          </div>
        </div>
        <AnimatePresence mode="sync">
          {isAnyGenerating ? (
            <motion.div
               key="generating"
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.9 }}
               className="flex items-center gap-2 text-xs font-bold text-theme-accent mr-2 px-3 py-1.5 bg-theme-accent/10 rounded-full"
             >
               <Loader2 size={14} className="animate-spin" />
               AI 响应中…
             </motion.div>
          ) : isSyncing ? (
            <motion.div
              key="syncing"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 text-xs text-theme-muted mr-2 font-mono"
            >
              <Cloud size={14} className="animate-pulse" />
              保存中…
            </motion.div>
          ) : syncSuccess ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 text-xs text-emerald-500 mr-2 font-mono"
            >
              <CheckCircle2 size={14} />
              保存成功
            </motion.div>
          ) : null}
        </AnimatePresence>
        <button
          onClick={onToggleAgentSidebar}
          aria-label={isAgentSidebarOpen ? "收起智能管家" : "展开智能管家"}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            isAgentSidebarOpen
              ? "bg-theme-accent/10 border border-theme-accent/30 text-theme-accent"
              : "bg-theme-accent/5 border border-theme-accent/20 text-theme-accent hover:bg-theme-accent/10"
          )}
          title="智能管家"
        >
          <Bot size={14} />
          {isAgentSidebarOpen ? '收起助手' : 'AI 助手'}
        </button>
        <button
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? "退出全屏模式" : "进入全屏模式"}
          className="p-1.5 rounded-lg text-theme-muted hover:text-theme-text hover:bg-theme-sidebar/40 transition-colors"
          title={isFullscreen ? '退出全屏' : '全屏模式'}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button aria-label="打开设置" className="hidden sm:inline-flex p-2 hover:bg-theme-border/50 rounded-lg text-theme-muted">
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}
