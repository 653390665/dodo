import { create } from 'zustand';

/**
 * 011 Phase 2：主纲内容域状态后端。
 *
 * 写竞态守卫语义（revision 自增 + fetch 侧条件接受）由 useEditorData 承担：
 * - setGlobalOutline：用户编辑路径，revision 自增（使在途 fetch 回写失效）
 * - setGlobalOutlineRaw：fetch 回写路径，不 bump revision
 * - outlineRevision：守卫比较字段，随 setGlobalOutline 自增
 */
export interface OutlineContentState {
  globalOutline: string;
  outlineError: string | null;
  outlineRevision: number;
  setGlobalOutline: (value: string | ((prev: string) => string)) => void;
  setGlobalOutlineRaw: (value: string) => void;
  setOutlineError: (value: string | null) => void;
  resetOutlineContent: () => void;
}

export const useOutlineContentStore = create<OutlineContentState>((set, get) => ({
  globalOutline: '',
  outlineError: null,
  outlineRevision: 0,
  setGlobalOutline: (value) =>
    set((state) => ({
      outlineRevision: state.outlineRevision + 1,
      globalOutline: typeof value === 'function' ? value(state.globalOutline) : value,
    })),
  setGlobalOutlineRaw: (value) => set({ globalOutline: value }),
  setOutlineError: (value) => set({ outlineError: value }),
  resetOutlineContent: () => set({ globalOutline: '', outlineError: null, outlineRevision: get().outlineRevision + 1 }),
}));
