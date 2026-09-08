import { create } from 'zustand';

/**
 * 011 状态直传值迁移：编辑器创作意图输入（原 EditorView useState 钻透）。
 * 1:1 语义：无合并整值赋值；与原 useState 一致不随作品切换重置。
 */
export interface UserIntentState {
  userIntent: string;
  setUserIntent: (intent: string) => void;
}

export const useUserIntentStore = create<UserIntentState>((set) => ({
  userIntent: '',
  setUserIntent: (intent) => set({ userIntent: intent }),
}));
