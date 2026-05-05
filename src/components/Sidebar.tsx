import React from 'react';
import { 
  BookOpen, 
  PenTool, 
  Users, 
  Sparkles,
  Wand2,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  BookTemplate
} from 'lucide-react';
import { ViewType } from '../types';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

interface SidebarProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  user: { uid: string };
}

export function Sidebar({ currentView, onNavigate, user }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  const navItems = [
    { id: 'library' as ViewType, label: '我的书库', icon: BookOpen },
    { id: 'editor' as ViewType, label: '创作舞台', icon: PenTool },
    { id: 'world' as ViewType, label: '设定记忆', icon: Users },
    { id: 'factory' as ViewType, label: '拆书工厂', icon: BookTemplate },
    { id: 'skills' as ViewType, label: '技能仓库', icon: Wand2 },
    { id: 'ai' as ViewType, label: '灵感助手', icon: Sparkles },
  ];

  return (
    <motion.div 
      initial={false}
      animate={{ width: isCollapsed ? 64 : 240 }}
      className="h-full bg-transparent flex flex-col transition-all duration-300 z-50 py-2"
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
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all group relative",
              currentView === item.id 
                ? "bg-white shadow-sm border border-theme-border text-theme-text font-semibold" 
                : "text-theme-muted hover:bg-theme-border/30 hover:text-theme-text"
            )}
          >
            <item.icon size={16} className={cn(
              "transition-colors",
              currentView === item.id ? "text-theme-text" : "text-theme-muted group-hover:text-theme-text"
            )} />
            {!isCollapsed && (
              <span className="text-sm">{item.label}</span>
            )}
            {/* Tooltip for collapsed mode */}
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-2 py-1 bg-theme-text text-white text-[10px] uppercase tracking-wider font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[100]">
                {item.label}
              </div>
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-2 space-y-1">
        <button 
          onClick={() => window.dispatchEvent(new Event('open-settings'))}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 text-theme-muted hover:text-theme-text hover:bg-theme-border/30 rounded-lg transition-all",
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
