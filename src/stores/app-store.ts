import { create } from 'zustand';
import type { ViewType, WorkspaceFocus } from '../../shared/types';

type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'inkflow-theme';

function getStoredTheme(): Theme {
  try {
    // 增加 Node/SSR 环境的安全防线
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
    }
  } catch {}
  return 'system';
}

function applyTheme(theme: Theme) {
  // 增加 Node/SSR 环境的安全防线，若在 headless/Node 运行环境中无 window 或 document，静默退场
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  
  const resolved = theme === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = resolved;
}

interface AppState {
  currentView: ViewType;
  workspaceFocus: WorkspaceFocus;
  theme: Theme;
  isSettingsOpen: boolean;
  isAIAssistantOpen: boolean;
  aiDrawerTab: 'cards' | 'chat';
  factoryIntent: { activeSeriesId: string; stepId: string } | null;
  isGlobalPremium: boolean;
  activateGlobalPremium: (code: string) => { success: boolean; error?: string };
  deactivateGlobalPremium: () => void;
  setCurrentView: (v: ViewType) => void;
  setWorkspaceFocus: (f: WorkspaceFocus) => void;
  setTheme: (t: Theme) => void;
  setSettingsOpen: (v: boolean) => void;
  setAIAssistantOpen: (v: boolean) => void;
  setAIDrawerTab: (tab: 'cards' | 'chat') => void;
  setFactoryIntent: (intent: { activeSeriesId: string; stepId: string } | null) => void;
}

const PREMIUM_ACTIVATION_CODES = [
  'DODO-DODO'
];

export const useAppStore = create<AppState>((set) => {
  // 初始化主题
  const initialTheme = getStoredTheme();
  applyTheme(initialTheme);

  // 恢复上次会话：自动侦测并加载用户停留的视图（带有非浏览器环境下的安全隔离）
  let restoredView: ViewType = 'welcome';
  try {
    if (typeof localStorage !== 'undefined') {
      const savedView = localStorage.getItem('inkflow-last-view');
      if (savedView) restoredView = savedView as ViewType;
    }
  } catch {}

  let initialGlobalPremium = false;
  try {
    if (typeof localStorage !== 'undefined') {
      initialGlobalPremium = localStorage.getItem('inkflow-global-premium') === 'true';
    }
  } catch {}

  return {
    currentView: restoredView,
    workspaceFocus: 'editor',
    theme: initialTheme,
    isSettingsOpen: false,
    isAIAssistantOpen: false,
    aiDrawerTab: 'cards',
    factoryIntent: null,
    isGlobalPremium: initialGlobalPremium,
    activateGlobalPremium: (code) => {
      const trimmed = (code || '').trim().toUpperCase();
      if (PREMIUM_ACTIVATION_CODES.includes(trimmed)) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('inkflow-global-premium', 'true');
          }
        } catch {}
        set({ isGlobalPremium: true });
        return { success: true };
      }
      return { success: false, error: '无效的激活码。请检查拼写或输入正确的内测激活码。' };
    },
    deactivateGlobalPremium: () => {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('inkflow-global-premium');
        }
      } catch {}
      set({ isGlobalPremium: false });
    },
    setCurrentView: (currentView) => {
      try { 
        // 增加非浏览器环境下的 LocalStorage 写入安全卫士
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('inkflow-last-view', currentView); 
        }
      } catch {}
      set({ currentView });
    },
    setWorkspaceFocus: (workspaceFocus) => set({ workspaceFocus }),
    setTheme: (theme) => {
      applyTheme(theme);
      try { 
        // 增加非浏览器环境下的 LocalStorage 写入安全卫士
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(THEME_KEY, theme); 
        }
      } catch {}
      set({ theme });
    },
    setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
    setAIAssistantOpen: (isAIAssistantOpen) => set({ isAIAssistantOpen }),
    setAIDrawerTab: (aiDrawerTab) => set({ aiDrawerTab }),
    setFactoryIntent: (factoryIntent) => set({ factoryIntent }),
  };
});
