import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { StoryCardDeck } from './onboarding/StoryCardDeck';
import { AIAssistant } from './AIAssistant';
import { ErrorBoundary } from './ErrorBoundary';
import type { AssistantActionPlan, AssistantLaunchContext, AssistantMode, Novel, StoryIdeaCard, StoryPlanningInput, OnboardingDraftState } from '../../shared/types';
import { WorldBibleAssistant } from './WorldBibleAssistant';

export function AIAssistantDrawer({
  isOpen,
  onClose,
  onboardingDraft,
  aiDrawerTab,
  setAIDrawerTab,
  handleSelectStoryCard,
  handleCreateDraftFromIdea,
  assistantLaunchContext,
  continuationPackId,
  handleApplyAssistantToContent,
  handleApplyAssistantToSceneBeats,
  handleReplaceAssistantSelection,
  handleLaunchAssistantSettingCandidate,
  handleStartAssistantCreation,
  selectedNovel,
  assistantMode,
  onAssistantModeChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  onboardingDraft: OnboardingDraftState | null;
  aiDrawerTab: 'cards' | 'chat';
  setAIDrawerTab: (tab: 'cards' | 'chat') => void;
  handleSelectStoryCard: (card: StoryIdeaCard, planning?: StoryPlanningInput) => void;
  handleCreateDraftFromIdea: (args: {
    ideaSeed: string;
    chatContext: string;
    planning: StoryPlanningInput;
    isRefresh?: boolean;
  }) => void;
  assistantLaunchContext: AssistantLaunchContext | null;
  continuationPackId?: string;
  handleApplyAssistantToContent: (text: string) => void;
  handleApplyAssistantToSceneBeats: (text: string) => void;
  handleReplaceAssistantSelection: (text: string) => void;
  handleLaunchAssistantSettingCandidate?: (plan: AssistantActionPlan, seedText: string) => void;
  handleStartAssistantCreation?: (plan: AssistantActionPlan, seedText?: string) => void;
  selectedNovel?: Novel | null;
  assistantMode: AssistantMode;
  onAssistantModeChange: (mode: AssistantMode) => void;
}) {
  // Focus trap, Escape key handler, and Focus restoration for AIAssistantDrawer
  useEffect(() => {
    if (!isOpen) return;
    const previouslyActive = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusableElements = document.querySelectorAll(
          'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex="0"], [contenteditable]'
        );
        const modalElement = document.getElementById('ai-assistant-drawer-container');
        if (!modalElement) return;
        const modalFocusables = Array.from(focusableElements).filter(el =>
          modalElement.contains(el)
        ) as HTMLElement[];

        if (modalFocusables.length === 0) return;
        const first = modalFocusables[0];
        const last = modalFocusables[modalFocusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Auto focus first interactive element
    const modalElement = document.getElementById('ai-assistant-drawer-container');
    if (modalElement) {
      const firstInput = modalElement.querySelector('input, select, textarea, button') as HTMLElement;
      if (firstInput) firstInput.focus();
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyActive && typeof previouslyActive.focus === 'function') {
        previouslyActive.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const showOnboardingDraft = Boolean(onboardingDraft) && !(selectedNovel && assistantMode === 'bible');

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/10 backdrop-blur-[2px]"
      />
      <div
        id="ai-assistant-drawer-container"
        role="dialog"
        aria-modal="true"
        aria-label="智能管家"
        className="fixed right-0 top-0 z-[70] flex h-full min-h-0 w-[420px] max-w-[90vw] flex-col border-l border-theme-border bg-theme-sidebar shadow-2xl"
      >
        {showOnboardingDraft && onboardingDraft ? (
          <div className="h-full flex flex-col">
            <div className="shrink-0 p-4 border-b border-theme-border flex items-center justify-between bg-theme-sidebar">
              <div className="flex gap-2">
                <button
                  onClick={() => setAIDrawerTab('cards')}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                    aiDrawerTab === 'cards' ? 'bg-theme-text text-white' : 'text-theme-muted hover:bg-theme-sidebar'
                  }`}
                >
                  方案卡
                </button>
                <button
                  onClick={() => setAIDrawerTab('chat')}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                    aiDrawerTab === 'chat' ? 'bg-theme-text text-white' : 'text-theme-muted hover:bg-theme-sidebar'
                  }`}
                >
                  灵感对话
                </button>
              </div>
              <button
                onClick={onClose}
                aria-label="关闭智能管家"
                className="p-2 rounded-full text-theme-muted hover:bg-theme-sidebar/50 transition-all"
              >
                <X size={20} />
              </button>
            </div>
            {aiDrawerTab === 'cards' ? (
              <div className="flex-1 overflow-y-auto px-6 py-8 bg-theme-bg/30">
                <StoryCardDeck
                  cards={onboardingDraft.cards}
                  selectedCardId={onboardingDraft.selectedCardId}
                  source={onboardingDraft.source}
                  onSelectCard={handleSelectStoryCard}
                  onMixCard={() => {
                    if (onboardingDraft.cards.length >= 2) {
                      const other = onboardingDraft.cards.find((c) => c.id !== onboardingDraft.selectedCardId);
                      if (other) {
                        handleCreateDraftFromIdea({
                          ideaSeed: `${onboardingDraft.cards[0].hook} + ${other.hook}`,
                          chatContext: onboardingDraft.ideaSeed,
                          planning: onboardingDraft.planning,
                        });
                      }
                    }
                  }}
                  onRefreshBatch={() =>
                    handleCreateDraftFromIdea({
                      ideaSeed: onboardingDraft.ideaSeed,
                      chatContext: onboardingDraft.ideaSeed,
                      planning: onboardingDraft.planning,
                      isRefresh: true,
                    })
                  }
                />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <ErrorBoundary>
                  <AIAssistant
                    launchContext={assistantLaunchContext}
                    activeNovel={selectedNovel}
                    onApplyToContent={handleApplyAssistantToContent}
                    onApplyToSceneBeats={handleApplyAssistantToSceneBeats}
                    onReplaceSelection={handleReplaceAssistantSelection}
                    onLaunchSettingCandidate={handleLaunchAssistantSettingCandidate}
                    onStartCreation={handleStartAssistantCreation}
                    onClose={onClose}
                  />
                </ErrorBoundary>
              </div>
            )}
          </div>
        ) : (
          <ErrorBoundary>
            {selectedNovel && (
              <div className="shrink-0 p-3 border-b border-theme-border flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={assistantMode === 'general'}
                  onClick={() => onAssistantModeChange('general')}
                  className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md ${
                    assistantMode === 'general'
                      ? 'bg-theme-text text-white'
                      : 'text-theme-muted hover:bg-theme-sidebar'
                  }`}
                >
                  作品协作
                </button>
                <button
                  type="button"
                  aria-pressed={assistantMode === 'bible'}
                  onClick={() => onAssistantModeChange('bible')}
                  className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md ${
                    assistantMode === 'bible'
                      ? 'bg-theme-text text-white'
                      : 'text-theme-muted hover:bg-theme-sidebar'
                  }`}
                >
                  设定记忆
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {assistantMode === 'bible' && selectedNovel ? (
                <WorldBibleAssistant novel={selectedNovel} continuationPackId={continuationPackId} onClose={onClose} />
              ) : (
                <AIAssistant
                  launchContext={assistantLaunchContext}
                  activeNovel={selectedNovel}
                  onApplyToContent={handleApplyAssistantToContent}
                  onApplyToSceneBeats={handleApplyAssistantToSceneBeats}
                  onReplaceSelection={handleReplaceAssistantSelection}
                  onLaunchSettingCandidate={handleLaunchAssistantSettingCandidate}
                  onStartCreation={handleStartAssistantCreation}
                  onClose={onClose}
                />
              )}
            </div>
          </ErrorBoundary>
        )}
      </div>
    </>
  );
}
