import { create } from 'zustand';

/**
 * 005：编辑器生成旗标域（isGenerating* 一族）。
 * 生成子 hook（outline/draft/audit）直接读写本 store，
 * 替代"setter 作为参数在 hooks 间穿线"的旧模式；
 * 剩余旗标按同模式渐进迁移。
 */
export interface EditorGenerationState {
  isGeneratingOutline: boolean;
  setIsGeneratingOutline: (value: boolean) => void;
}

export const useEditorGenerationStore = create<EditorGenerationState>((set) => ({
  isGeneratingOutline: false,
  setIsGeneratingOutline: (value) => set({ isGeneratingOutline: value }),
}));
