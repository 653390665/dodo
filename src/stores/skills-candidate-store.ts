import { create } from 'zustand';

/**
 * 能力卡候选簇状态（Plan 195 Phase 2：自 SkillsStudioView 迁出）。
 * setter 镜像 useState 语义（值或函数式更新），迁移不改变调用点行为；
 * 跨作品清空由视图的工作切换 effect 负责（候选簇的会话持久化仍在视图层编排）。
 */
interface SkillsCandidateState {
  candidateCardIds: string[];
  pendingCandidateId: string | null;
  setCandidateCardIds: (value: string[] | ((current: string[]) => string[])) => void;
  setPendingCandidateId: (value: string | null) => void;
}

export const useSkillsCandidateStore = create<SkillsCandidateState>((set) => ({
  candidateCardIds: [],
  pendingCandidateId: null,
  setCandidateCardIds: (value) => set((state) => ({
    candidateCardIds: typeof value === 'function' ? value(state.candidateCardIds) : value,
  })),
  setPendingCandidateId: (value) => set({ pendingCandidateId: value }),
}));
