import { create } from 'zustand';
import type { ViewType, WorkspaceFocus } from '../types';

type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'inkflow-theme';

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  } catch {}
  return 'system';
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
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
  setCurrentView: (v: ViewType) => void;
  setWorkspaceFocus: (f: WorkspaceFocus) => void;
  setTheme: (t: Theme) => void;
  setSettingsOpen: (v: boolean) => void;
  setAIAssistantOpen: (v: boolean) => void;
  setAIDrawerTab: (tab: 'cards' | 'chat') => void;
}

export const useAppStore = create<AppState>((set) => {
  // 初始化主题
  const initialTheme = getStoredTheme();
  applyTheme(initialTheme);

  return {
    currentView: 'welcome',
    workspaceFocus: 'editor',
    theme: initialTheme,
    isSettingsOpen: false,
    isAIAssistantOpen: false,
    aiDrawerTab: 'cards',
    setCurrentView: (currentView) => set({ currentView }),
    setWorkspaceFocus: (workspaceFocus) => set({ workspaceFocus }),
    setTheme: (theme) => {
      applyTheme(theme);
      try { localStorage.setItem(THEME_KEY, theme); } catch {}
      set({ theme });
    },
    setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
    setAIAssistantOpen: (isAIAssistantOpen) => set({ isAIAssistantOpen }),
    setAIDrawerTab: (aiDrawerTab) => set({ aiDrawerTab }),
  };
});
