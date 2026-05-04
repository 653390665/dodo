import React from 'react';
import { 
  BookOpen, 
  PenTool, 
  Users, 
  Sparkles, 
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { ViewType } from '../types';
import { cn } from '../lib/utils';
import { auth } from '../lib/firebase';
import { User } from 'firebase/auth';
import { motion } from 'motion/react';

interface SidebarProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  user: User;
}

export function Sidebar({ currentView, onNavigate, user }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  const navItems = [
    { id: 'library' as ViewType, label: '我的书库', icon: BookOpen },
    { id: 'editor' as ViewType, label: '创作舞台', icon: PenTool },
    { id: 'world' as ViewType, label: '人物设定', icon: Users },
    { id: 'ai' as ViewType, label: '灵感助手', icon: Sparkles },
  ];

  return (
    <motion.div 
      initial={false}
      animate={{ width: isCollapsed ? 80 : 260 }}
      className="h-full bg-sage-sidebar border-r border-sage-border flex flex-col transition-all duration-300 z-50 shadow-sm"
    >
      {/* Header */}
      <div className="p-6 mb-8 flex items-center justify-between">
        {!isCollapsed && (
          <h2 className="text-2xl font-serif font-bold tracking-tight text-sage-accent">墨影</h2>
        )}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 hover:bg-sage-border rounded-lg text-sage-muted transition-colors"
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group relative",
              currentView === item.id 
                ? "bg-sage-accent text-white shadow-md" 
                : "text-sage-muted hover:bg-sage-border/50 hover:text-sage-text"
            )}
          >
            <item.icon size={20} className={cn(
              "transition-colors",
              currentView === item.id ? "text-white" : "text-sage-muted group-hover:text-sage-text"
            )} />
            {!isCollapsed && (
              <span className="font-medium text-sm">{item.label}</span>
            )}
            {/* Tooltip for collapsed mode */}
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-2 py-1 bg-sage-accent text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[100]">
                {item.label}
              </div>
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sage-border space-y-2">
        {!isCollapsed && (
          <div className="flex items-center gap-3 px-3 py-2">
            <img 
              src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`} 
              alt="Avatar" 
              className="w-10 h-10 rounded-full border border-sage-border shadow-sm"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate leading-tight">{user.displayName || '作者'}</p>
              <p className="text-[10px] text-sage-muted truncate leading-none">创作中...</p>
            </div>
          </div>
        )}
        
        <button 
          onClick={() => auth.signOut()}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-2 text-sage-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-all",
            isCollapsed && "justify-center px-2"
          )}
        >
          <LogOut size={18} />
          {!isCollapsed && <span className="text-sm font-medium">登出</span>}
        </button>
      </div>
    </motion.div>
  );
}
