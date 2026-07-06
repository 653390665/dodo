/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from './stores/app-store';
import { useNovelStore } from './stores/novel-store';
import { matchesShortcut, SHORTCUTS } from './lib/keyboard-shortcuts';
import { deriveWorkspaceFocus } from './lib/workspace-nav';
import type { ViewType, WorkspaceNavKey } from '../shared/types';
import { AppShell } from './components/AppShell';
import { TooltipProvider } from './components/ui/tooltip';
import { PremiumUpgradeModal } from './components/commercial/PremiumUpgradeModal';

export default function App() {
  const {
    currentView, setCurrentView,
    theme, setTheme,
    setSettingsOpen,
    setAIAssistantOpen,
    setWorkspaceFocus,
  } = useAppStore(
    useShallow((state) => ({
      currentView: state.currentView,
      setCurrentView: state.setCurrentView,
      theme: state.theme,
      setTheme: state.setTheme,
      setSettingsOpen: state.setSettingsOpen,
      setAIAssistantOpen: state.setAIAssistantOpen,
      setWorkspaceFocus: state.setWorkspaceFocus,
    }))
  );

  const {
    continuationLaunchState,
    setContinuationLaunchState,
  } = useNovelStore(
    useShallow((state) => ({
      continuationLaunchState: state.continuationLaunchState,
      setContinuationLaunchState: state.setContinuationLaunchState,
    }))
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (theme === 'system') setTheme('system'); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, setTheme]);

  useEffect(() => {
    const handleOpenSettings = () => setSettingsOpen(true);
    window.addEventListener('open-settings', handleOpenSettings);
    return () => window.removeEventListener('open-settings', handleOpenSettings);
  }, [setSettingsOpen]);

  useEffect(() => {
    if (currentView === 'editor') setWorkspaceFocus('editor');
    if (currentView === 'world') setWorkspaceFocus('world');
  }, [currentView, setWorkspaceFocus]);

  useEffect(() => {
    if (currentView !== 'editor' && currentView !== 'workspace' && continuationLaunchState) {
      setContinuationLaunchState(null);
    }
  }, [currentView, continuationLaunchState, setContinuationLaunchState]);

  useEffect(() => {
    const viewMap: Record<string, { view: ViewType; navKey?: WorkspaceNavKey }> = {
      view1: { view: 'welcome' },
      view2: { view: 'library' },
      view3: { view: 'workspace', navKey: 'workspace-editor' },
      view4: { view: 'workspace', navKey: 'workspace-world' },
      view5: { view: 'ai' },
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      for (const [id, shortcut] of Object.entries(SHORTCUTS)) {
        if (id in viewMap && matchesShortcut(e, shortcut)) {
          e.preventDefault();
          const target = viewMap[id];
          if (target.view === 'ai') {
             setAIAssistantOpen(true);
             return;
          }
          setWorkspaceFocus(deriveWorkspaceFocus(target.view, target.navKey, useAppStore.getState().workspaceFocus));
          setCurrentView(target.view);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setAIAssistantOpen, setCurrentView, setWorkspaceFocus]);

  return (
    <TooltipProvider>
      <AppShell />
      <PremiumUpgradeModal />
    </TooltipProvider>
  );
}
