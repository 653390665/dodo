import React from 'react';import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import PenTool from 'lucide-react/dist/esm/icons/pen-tool.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb.js';
import Wand2 from 'lucide-react/dist/esm/icons/wand-sparkles.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import BookTemplate from 'lucide-react/dist/esm/icons/book-template.js';
import { ViewType, WorkspaceNavKey } from '../types';
import { cn } from '../lib/utils';
import { motion } from '../lib/motion';
import { getSidebarMainItems, isWorkspaceFamilyView } from '../lib/workspace-nav';

interface SidebarProps {
  currentView: ViewType;
  onNavigate: (view: ViewType, navKey?: WorkspaceNavKey) => void;
  user: { uid: string };
  isAIAssistantOpen?: boolean;
}

interface NavItem {
  id: ViewType;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  navKey?: WorkspaceNavKey;
}

export function Sidebar({ currentView, onNavigate, user, isAIAssistantOpen }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  const iconMap: Record<ViewType, NavItem['icon']> = {
    welcome: Sparkles,
    library: BookOpen,
    workspace: PenTool,
    ai: Lightbulb,
    editor: PenTool,
    world: PenTool,
    skills: Wand2,
    factory: BookTemplate,
  };

  const mainItems: NavItem[] = getSidebarMainItems().map((item) => ({
    ...item,
    icon: iconMap[item.id],
  }));

  const exploreItems: NavItem[] = [
    { id: 'factory', label: '拆书工厂', icon: BookTemplate },
    { id: 'skills', label: '技能仓库', icon: Wand2 },
  ];

  const renderNavItem = (item: NavItem) => {
    const isActive = item.id === 'ai' 
      ? isAIAssistantOpen 
      : item.id === 'workspace'
        ? isWorkspaceFamilyView(currentView)
        : currentView === item.id;
    const key = item.navKey || item.id;
    return (
      <button
        key={key}
        onClick={() => onNavigate(item.id, item.navKey)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-[background-color,border-color,box-shadow,color] duration-200 group relative",
          isActive
            ? "bg-white shadow-sm border border-theme-border text-theme-text font-semibold"
            : "text-theme-muted hover:bg-theme-border/30 hover:text-theme-text"
        )}
      >
        <item.icon size={16} className={cn(
          "transition-colors",
          isActive ? "text-theme-text" : "text-theme-muted group-hover:text-theme-text"
        )} />
        {!isCollapsed && (
          <span className="text-sm">{item.label}</span>
        )}
        {isCollapsed && (
          <div className="absolute left-full ml-4 px-2 py-1 bg-theme-text text-white text-[10px] uppercase tracking-wider font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[100]">
            {item.label}
          </div>
        )}
      </button>
    );
  };

  return (
    <motion.div
      initial={false}
      animate={{ width: isCollapsed ? 64 : 240 }}
      className="h-full bg-transparent flex flex-col transition-[width] duration-300 z-50 py-2"
    >
      {/* Header */}
      <div className="px-4 mb-8 flex items-center justify-between">
        {!isCollapsed && (
          <h2 className="text-xl font-serif font-black tracking-tight text-theme-text">INK<span className="text-theme-muted font-light">FLOW</span></h2>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn("p-1.5 hover:bg-theme-border/50 rounded-lg text-theme-muted transition-colors", isCollapsed && "mx-auto")}
        >
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {mainItems.map(renderNavItem)}

        <div className="pt-3 mt-3 border-t border-theme-border/50">
          {!isCollapsed && (
            <div className="px-3 py-1 text-[10px] font-bold text-theme-muted/50 uppercase tracking-wider">
              探索工具
            </div>
          )}
          {exploreItems.map(renderNavItem)}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-3 pb-2 space-y-1">
        <button
          onClick={() => window.dispatchEvent(new Event('open-settings'))}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 text-theme-muted hover:text-theme-text hover:bg-theme-border/30 rounded-lg transition-[background-color,color] duration-200",
            isCollapsed && "justify-center px-2"
          )}
        >
          <Settings size={16} />
          {!isCollapsed && <span className="text-xs font-semibold">设置 (Settings)</span>}
        </button>
      </div>
    </motion.div>
  );
}
