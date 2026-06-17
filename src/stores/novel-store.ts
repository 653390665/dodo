import { create } from 'zustand';
import type { Novel, OnboardingDraftState, SetupTaskKey, AssistantLaunchContext, ContinuationEditorLaunchState } from '../types';

type Updater<T> = T | ((prev: T) => T);

interface NovelState {
  selectedNovel: Novel | null;
  onboardingDraft: OnboardingDraftState | null;
  activeSetupTaskKey: SetupTaskKey | null;
  batchCounter: number;
  assistantLaunchContext: AssistantLaunchContext | null;
  continuationLaunchState: ContinuationEditorLaunchState | null;
  setSelectedNovel: (novel: Updater<Novel | null>) => void;
  setOnboardingDraft: (draft: Updater<OnboardingDraftState | null>) => void;
  setActiveSetupTaskKey: (key: SetupTaskKey | null) => void;
  incrementBatchCounter: () => void;
  setAssistantLaunchContext: (ctx: AssistantLaunchContext | null) => void;
  setContinuationLaunchState: (state: ContinuationEditorLaunchState | null) => void;
}

export const useNovelStore = create<NovelState>((set) => ({
  selectedNovel: null,
  onboardingDraft: null,
  activeSetupTaskKey: null,
  batchCounter: 0,
  assistantLaunchContext: null,
  continuationLaunchState: null,
  setSelectedNovel: (value) => set((s) => ({
    selectedNovel: typeof value === 'function' ? value(s.selectedNovel) : value,
  })),
  setOnboardingDraft: (value) => set((s) => ({
    onboardingDraft: typeof value === 'function' ? value(s.onboardingDraft) : value,
  })),
  setActiveSetupTaskKey: (activeSetupTaskKey) => set({ activeSetupTaskKey }),
  incrementBatchCounter: () => set((s) => ({ batchCounter: s.batchCounter + 1 })),
  setAssistantLaunchContext: (assistantLaunchContext) => set({ assistantLaunchContext }),
  setContinuationLaunchState: (continuationLaunchState) => set({ continuationLaunchState }),
}));
