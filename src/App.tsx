/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from './stores/app-store';
import { useNovelStore } from './stores/novel-store';
import { AppShell } from './components/AppShell';
import { TooltipProvider } from './components/ui/tooltip';
import { PremiumUpgradeModal } from './components/commercial/PremiumUpgradeModal';
import { bindEditorCloseSafety } from './lib/editor-close-handshake';

export default function App() {
  const {
    currentView,
    theme, setTheme,
    setSettingsOpen,
    setWorkspaceFocus,
  } = useAppStore(
    useShallow((state) => ({
      currentView: state.currentView,
      theme: state.theme,
      setTheme: state.setTheme,
      setSettingsOpen: state.setSettingsOpen,
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

  useEffect(() => bindEditorCloseSafety(window, window.inkflow), []);

  return (
    <TooltipProvider>
      <AppShell />
      <PremiumUpgradeModal />
    </TooltipProvider>
  );
}
