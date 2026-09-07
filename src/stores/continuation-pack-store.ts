import { create } from 'zustand';
import type { ContinuationPack } from '../../shared/types';

/**
 * 011 Phase 1：续写选包域状态后端。
 *
 * 加载与自动同步逻辑保留在 useEditorContinuationPacks（请求序号、launchState
 * 消费、按最近排序）；本 store 只是其 useState 的替换后端。
 * AgentWorkspace 子树与状态条相关表面直接订阅，不再经 EditorView 透传。
 */
export interface ContinuationPackState {
  continuationPacks: ContinuationPack[];
  selectedContinuationPackId: string;
  setContinuationPacks: (packs: ContinuationPack[]) => void;
  setSelectedContinuationPackId: (packId: string) => void;
  setSelectedContinuationPackIdUpdatable: (
    update: (current: string) => string,
  ) => void;
}

export const useContinuationPackStore = create<ContinuationPackState>((set) => ({
  continuationPacks: [],
  selectedContinuationPackId: '',
  setContinuationPacks: (packs) => set({ continuationPacks: packs }),
  setSelectedContinuationPackId: (packId) => set({ selectedContinuationPackId: packId }),
  setSelectedContinuationPackIdUpdatable: (update) =>
    set((state) => ({ selectedContinuationPackId: update(state.selectedContinuationPackId) })),
}));
