import { create } from 'zustand';

/**
 * 005：编辑器生成旗标域（isGenerating* 一族）。
 * 生成子 hook（outline/draft/audit）直接读写本 store，
 * 替代"setter 作为参数在 hooks 间穿线"的旧模式；
 * 剩余旗标按同模式渐进迁移。
 */
export interface EditorGenerationState {
  isGeneratingOutline: boolean;
  isGeneratingContent: boolean;
  isGeneratingBeats: boolean;
  isGeneratingCritique: boolean;
  /** AI 候选接受请求防重入（005-S4 同族瞬态旗标）。 */
  isAcceptingAiCandidate: boolean;
  /** 生成过程瞬态文案（011 状态直传值迁移：1:1 自 useEditorGenerationFlow 的 useState 换后端）。 */
  generationStatus: string | null;
  setIsGeneratingOutline: (value: boolean) => void;
  setIsGeneratingContent: (value: boolean) => void;
  setIsGeneratingBeats: (value: boolean) => void;
  setIsGeneratingCritique: (value: boolean) => void;
  setIsAcceptingAiCandidate: (value: boolean) => void;
  setGenerationStatus: (value: string | null) => void;
}

export const useEditorGenerationStore = create<EditorGenerationState>((set) => ({
  isGeneratingOutline: false,
  isGeneratingContent: false,
  isGeneratingBeats: false,
  isGeneratingCritique: false,
  isAcceptingAiCandidate: false,
  generationStatus: null,
  setIsGeneratingOutline: (value) => set({ isGeneratingOutline: value }),
  setIsGeneratingContent: (value) => set({ isGeneratingContent: value }),
  setIsGeneratingBeats: (value) => set({ isGeneratingBeats: value }),
  setIsGeneratingCritique: (value) => set({ isGeneratingCritique: value }),
  setIsAcceptingAiCandidate: (value) => set({ isAcceptingAiCandidate: value }),
  setGenerationStatus: (value) => set({ generationStatus: value }),
}));
