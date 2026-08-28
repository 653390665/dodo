import { create } from 'zustand';
import type { Novel, OnboardingDraftState, SetupTaskKey, AssistantLaunchContext, ContinuationEditorLaunchState, CapabilityLaunchState } from '../../shared/types';

type Updater<T> = T | ((prev: T) => T);

const SELECTED_NOVEL_ID_KEY = 'inkflow-selected-novel-id';

export function getStoredSelectedNovelId(): string | null {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(SELECTED_NOVEL_ID_KEY)
      : null;
  } catch {
    return null;
  }
}

export function clearStoredSelectedNovelId(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SELECTED_NOVEL_ID_KEY);
    }
  } catch {}
}

function storeSelectedNovelId(novel: Novel | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (novel) {
      localStorage.setItem(SELECTED_NOVEL_ID_KEY, novel.id);
    } else {
      localStorage.removeItem(SELECTED_NOVEL_ID_KEY);
    }
  } catch {}
}

interface NovelState {
  selectedNovel: Novel | null;
  onboardingDraft: OnboardingDraftState | null;
  activeSetupTaskKey: SetupTaskKey | null;
  batchCounter: number;
  assistantLaunchContext: AssistantLaunchContext | null;
  continuationLaunchState: ContinuationEditorLaunchState | null;
  capabilityLaunchState: CapabilityLaunchState | null;
  setSelectedNovel: (novel: Updater<Novel | null>) => void;
  setOnboardingDraft: (draft: Updater<OnboardingDraftState | null>) => void;
  setActiveSetupTaskKey: (key: SetupTaskKey | null) => void;
  incrementBatchCounter: () => void;
  setAssistantLaunchContext: (ctx: AssistantLaunchContext | null) => void;
  setContinuationLaunchState: (state: ContinuationEditorLaunchState | null) => void;
  setCapabilityLaunchState: (state: CapabilityLaunchState | null) => void;
  consumeCapabilityLaunch: (launchToken: number) => void;
}

export const useNovelStore = create<NovelState>((set) => ({
  selectedNovel: null,
  onboardingDraft: null,
  activeSetupTaskKey: null,
  batchCounter: 0,
  assistantLaunchContext: null,
  continuationLaunchState: null,
  capabilityLaunchState: null,
  setSelectedNovel: (value) => set((s) => {
    const selectedNovel = typeof value === 'function' ? value(s.selectedNovel) : value;
    storeSelectedNovelId(selectedNovel);
    return { selectedNovel };
  }),
  setOnboardingDraft: (value) => set((s) => ({
    onboardingDraft: typeof value === 'function' ? value(s.onboardingDraft) : value,
  })),
  setActiveSetupTaskKey: (activeSetupTaskKey) => set({ activeSetupTaskKey }),
  incrementBatchCounter: () => set((s) => ({ batchCounter: s.batchCounter + 1 })),
  setAssistantLaunchContext: (assistantLaunchContext) => set({ assistantLaunchContext }),
  setContinuationLaunchState: (continuationLaunchState) => set({ continuationLaunchState }),
  setCapabilityLaunchState: (capabilityLaunchState) => set({ capabilityLaunchState }),
  consumeCapabilityLaunch: (launchToken) => set((state) => (
    state.capabilityLaunchState?.launchToken === launchToken
      ? { capabilityLaunchState: null }
      : state
  )),
}));
