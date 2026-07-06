import { useState, useCallback, useEffect } from 'react';
import { AgentTab } from '../../../shared/types';

/**
 * Custom hook managing basic UI states of the editor (sidebar, fullscreen, agent sidebar).
 *
 * Sinking these UI states out of the main EditorView reduces the parent component's
 * state count and local complexity, keeping EditorView focused on core business flows.
 */
export function useEditorUiState(novelId: string) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedVolumes, setExpandedVolumes] = useState<string[]>(['正文卷']);
  const [isAgentSidebarOpen, setIsAgentSidebarOpen] = useState(false);
  const [agentTab, setAgentTab] = useState<AgentTab>('context');

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const toggleAgentSidebar = useCallback(() => {
    setIsAgentSidebarOpen((prev) => !prev);
  }, []);

  const toggleVolume = useCallback((vName: string) => {
    setExpandedVolumes((prev) =>
      prev.includes(vName) ? prev.filter((v) => v !== vName) : [...prev, vName]
    );
  }, []);

  // Reset agent sidebar when active novel changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsAgentSidebarOpen(false);
  }, [novelId]);

  return {
    isFullscreen,
    setIsFullscreen,
    isSidebarOpen,
    setIsSidebarOpen,
    expandedVolumes,
    setExpandedVolumes,
    isAgentSidebarOpen,
    setIsAgentSidebarOpen,
    agentTab,
    setAgentTab,
    toggleSidebar,
    toggleFullscreen,
    toggleAgentSidebar,
    toggleVolume,
  };
}
