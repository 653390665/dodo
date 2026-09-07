import { create } from 'zustand';
import type { ChapterProductionRun } from '../../shared/types';

/**
 * 005：生产流程域的全局状态归属。
 *
 * 分工约定："hooks 管副作用（LLM 调用/中断/重试），store 管状态"。
 * useChapterProductionFlow 只是把本地 useState 换成了本 store 的读写，
 * 对外签名不变；006 的统一状态条与各子面板可选择性订阅本 store，
 * 不再依赖 EditorView → AgentWorkspace 的 props 钻孔。
 */
export interface ProductionState {
  productionIntent: string;
  activeProductionRun: ChapterProductionRun | null;
  isProductionRunning: boolean;
  isApplyingProductionRun: boolean;
  productionError: string | null;
  productionBeatsSource: 'fallback' | 'model' | null;
  productionDraftSource: 'fallback' | 'model' | null;
  productionAuditSource: 'fallback' | 'model' | null;
  productionStatusMessage: string | null;
  /** 005-S4：本章期望字数（生成面板用），number | '' 表示未设置。 */
  expectedWordCount: number | '';
  setProductionIntent: (intent: string) => void;
  setActiveProductionRun: (
    run: ChapterProductionRun | null | ((current: ChapterProductionRun | null) => ChapterProductionRun | null),
  ) => void;
  setIsProductionRunning: (running: boolean) => void;
  setIsApplyingProductionRun: (applying: boolean) => void;
  setProductionError: (error: string | null | ((current: string | null) => string | null)) => void;
  setProductionBeatsSource: (source: 'fallback' | 'model' | null) => void;
  setProductionDraftSource: (source: 'fallback' | 'model' | null) => void;
  setProductionAuditSource: (source: 'fallback' | 'model' | null) => void;
  setProductionStatusMessage: (message: string | null) => void;
  setExpectedWordCount: (value: number | '') => void;
  /** 章节/作品切换或一次性清空时使用；字段级更新仍走各自 setter。 */
  resetProductionFlow: () => void;
}

const initialState = {
  productionIntent: '',
  activeProductionRun: null as ChapterProductionRun | null,
  isProductionRunning: false,
  isApplyingProductionRun: false,
  productionError: null as string | null,
  productionBeatsSource: null as 'fallback' | 'model' | null,
  productionDraftSource: null as 'fallback' | 'model' | null,
  productionAuditSource: null as 'fallback' | 'model' | null,
  productionStatusMessage: null as string | null,
  expectedWordCount: '' as number | '',
};

export const useProductionStore = create<ProductionState>((set) => ({
  ...initialState,
  setProductionIntent: (intent) => set({ productionIntent: intent }),
  setActiveProductionRun: (run) => set((state) => ({
    activeProductionRun: typeof run === 'function' ? run(state.activeProductionRun) : run,
  })),
  setIsProductionRunning: (running) => set({ isProductionRunning: running }),
  setIsApplyingProductionRun: (applying) => set({ isApplyingProductionRun: applying }),
  setProductionError: (error) => set((state) => ({
    productionError: typeof error === 'function' ? error(state.productionError) : error,
  })),
  setProductionBeatsSource: (source) => set({ productionBeatsSource: source }),
  setProductionDraftSource: (source) => set({ productionDraftSource: source }),
  setProductionAuditSource: (source) => set({ productionAuditSource: source }),
  setProductionStatusMessage: (message) => set({ productionStatusMessage: message }),
  setExpectedWordCount: (value) => set({ expectedWordCount: value }),
  resetProductionFlow: () => set({ ...initialState }),
}));
