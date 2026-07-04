import React from 'react';
import { BookOpen, BookTemplate, ChevronLeft, ChevronRight, Lightbulb, PenTool, Settings, Sparkles, Upload, Wand2 } from 'lucide-react';

import { ViewType, WorkspaceNavKey } from '../../shared/types';
import { cn } from '../lib/utils';
import { getSidebarMainItems, isWorkspaceFamilyView } from '../lib/workspace-nav';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/Tooltip';
import { ScrollArea } from './ui/ScrollArea';

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

export function Sidebar({ currentView, onNavigate, user: _user, isAIAssistantOpen }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false,
  );

  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const handleChange = () => setIsCollapsed(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const iconMap: Record<ViewType, NavItem['icon']> = {
    welcome: Sparkles,
    library: BookOpen,
    workspace: PenTool,
    ai: Lightbulb,
    editor: PenTool,
    world: PenTool,
    skills: Wand2,
    factory: BookTemplate,
    'continuation-import': Sparkles,
  };

  const mainItems: NavItem[] = getSidebarMainItems().map((item) => ({
    ...item,
    icon: iconMap[item.id],
  }));

  const exploreItems: NavItem[] = [
    { id: 'factory', label: '拆书工厂', icon: BookTemplate },
    { id: 'skills', label: '技能仓库', icon: Wand2 },
    { id: 'continuation-import', label: '资料续写', icon: Upload },
  ];

  const renderNavItem = (item: NavItem) => {
    const isActive = item.id === 'ai' 
      ? isAIAssistantOpen 
      : item.id === 'workspace'
        ? isWorkspaceFamilyView(currentView)
        : currentView === item.id;
    const key = item.navKey || item.id;
    const button = (
      <button
        onClick={() => onNavigate(item.id, item.navKey)}
        aria-label={item.label}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-[background-color,border-color,box-shadow,color] duration-200 group relative",
          isActive
            ? "bg-theme-sidebar shadow-sm border border-theme-border text-theme-text font-semibold"
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
      </button>
    );

    if (isCollapsed) {
      return (
        <Tooltip key={key}>
          <TooltipTrigger asChild>
            {button}
          </TooltipTrigger>
          <TooltipContent side="right">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <React.Fragment key={key}>{button}</React.Fragment>;
  };

  return (
    <div
      className="h-full bg-transparent flex flex-col transition-[width] duration-300 z-50 py-2"
    >
      {/* Header */}
      <div className="px-4 mb-8 flex items-center justify-between">
        {!isCollapsed && (
          <h2 className="text-xl font-serif font-black tracking-tight text-theme-text">INK<span className="text-theme-muted font-light">FLOW</span></h2>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? "展开侧边栏" : "折叠侧边栏"}
          className={cn("p-1.5 hover:bg-theme-border/50 rounded-lg text-theme-muted transition-colors", isCollapsed && "mx-auto")}
        >
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="主导航" className="flex-1 min-h-0">
        <ScrollArea className="h-full px-3 relative">
          <div className="flex flex-col gap-1 pr-1.5 pb-4">
            {mainItems.map(renderNavItem)}

            <div className="pt-3 mt-3 border-t border-theme-border/50" role="group" aria-label="探索工具">
              {!isCollapsed && (
                <div className="px-3 py-1 text-[10px] font-bold text-theme-muted/50 uppercase tracking-wider">
                  探索工具
                </div>
              )}
              {exploreItems.map(renderNavItem)}
            </div>
          </div>
        </ScrollArea>
      </nav>

      {/* Footer */}
      <div className="px-3 pb-2 flex flex-col gap-1">
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => window.dispatchEvent(new Event('open-settings'))}
                aria-label="系统设置"
                className="w-full flex items-center justify-center gap-3 px-2 py-2 text-theme-muted hover:text-theme-text hover:bg-theme-border/30 rounded-lg transition-[background-color,color] duration-200"
              >
                <Settings size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              系统设置
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={() => window.dispatchEvent(new Event('open-settings'))}
            aria-label="系统设置"
            className="w-full flex items-center gap-3 px-3 py-2 text-theme-muted hover:text-theme-text hover:bg-theme-border/30 rounded-lg transition-[background-color,color] duration-200"
          >
            <Settings size={16} />
            <span className="text-xs font-semibold">设置 (Settings)</span>
          </button>
        )}
      </div>
    </div>
  );
}
