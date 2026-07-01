import React from 'react';
import { X } from 'lucide-react';
import { StoryCardDeck } from './onboarding/StoryCardDeck';
import { AIAssistant } from './AIAssistant';
import { ErrorBoundary } from './ErrorBoundary';
import type { AssistantLaunchContext, Novel, StoryIdeaCard, StoryPlanningInput } from '../../shared/types';

export function AIAssistantDrawer({
  isOpen,
  onClose,
  onboardingDraft,
  aiDrawerTab,
  setAIDrawerTab,
  handleSelectStoryCard,
  handleCreateDraftFromIdea,
  assistantLaunchContext,
  handleApplyAssistantToContent,
  handleApplyAssistantToSceneBeats,
  handleReplaceAssistantSelection,
  selectedNovel,
}: {
  isOpen: boolean;
  onClose: () => void;
  onboardingDraft: any;
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
  handleApplyAssistantToContent: (text: string) => void;
  handleApplyAssistantToSceneBeats: (text: string) => void;
  handleReplaceAssistantSelection: (text: string) => void;
  selectedNovel?: Novel | null;
}) {
  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/10 backdrop-blur-[2px]"
      />
      <div className="fixed right-0 top-0 z-[70] h-full w-[420px] max-w-[90vw] border-l border-theme-border bg-theme-sidebar shadow-2xl">
        {onboardingDraft ? (
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
                aria-label="关闭 AI 助手"
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
                      const other = onboardingDraft.cards.find((c: any) => c.id !== onboardingDraft.selectedCardId);
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
                    onClose={onClose}
                  />
                </ErrorBoundary>
              </div>
            )}
          </div>
        ) : (
          <ErrorBoundary>
            <AIAssistant
              launchContext={assistantLaunchContext}
              activeNovel={selectedNovel}
              onApplyToContent={handleApplyAssistantToContent}
              onApplyToSceneBeats={handleApplyAssistantToSceneBeats}
              onReplaceSelection={handleReplaceAssistantSelection}
              onClose={onClose}
            />
          </ErrorBoundary>
        )}
      </div>
    </>
  );
}
