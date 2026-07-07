import { create } from 'zustand';
import type { ViewType, WorkspaceFocus } from '../../shared/types';

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
  factoryIntent: { activeSeriesId: string; stepId: string } | null;
  setCurrentView: (v: ViewType) => void;
  setWorkspaceFocus: (f: WorkspaceFocus) => void;
  setTheme: (t: Theme) => void;
  setSettingsOpen: (v: boolean) => void;
  setAIAssistantOpen: (v: boolean) => void;
  setAIDrawerTab: (tab: 'cards' | 'chat') => void;
  setFactoryIntent: (intent: { activeSeriesId: string; stepId: string } | null) => void;
}

export const useAppStore = create<AppState>((set) => {
  // 初始化主题
  const initialTheme = getStoredTheme();
  applyTheme(initialTheme);

  // Restore session: where did the user leave off?
  let restoredView: ViewType = 'welcome';
  try {
    const savedView = localStorage.getItem('inkflow-last-view');
    if (savedView) restoredView = savedView as ViewType;
  } catch {}

  return {
    currentView: restoredView,
    workspaceFocus: 'editor',
    theme: initialTheme,
    isSettingsOpen: false,
    isAIAssistantOpen: false,
    aiDrawerTab: 'cards',
    factoryIntent: null,
    setCurrentView: (currentView) => {
      try { localStorage.setItem('inkflow-last-view', currentView); } catch {}
      set({ currentView });
    },
    setWorkspaceFocus: (workspaceFocus) => set({ workspaceFocus }),
    setTheme: (theme) => {
      applyTheme(theme);
      try { localStorage.setItem(THEME_KEY, theme); } catch {}
      set({ theme });
    },
    setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
    setAIAssistantOpen: (isAIAssistantOpen) => set({ isAIAssistantOpen }),
    setAIDrawerTab: (aiDrawerTab) => set({ aiDrawerTab }),
    setFactoryIntent: (factoryIntent) => set({ factoryIntent }),
  };
});
