import { create } from 'zustand';
import type { Skill } from '../../shared/types';

/**
 * 技能货架数据状态（Plan 195 切片 C：自 SkillsStudioView 迁出）。
 *
 * savedSkills 是作品无关的全局技能清单（syncSkillFeedbackScores 全量返回），
 * 供货架、包弹窗（needsImport 判定）与候选托盘（resolveDeckCard）共同消费。
 * setter 镜像 useState 语义；挂载期由 useSkillsShelfData 负责加载与订阅，
 * 卸载时 resetForRemount 归零，对齐原 useState 按挂载初始化语义。
 */
interface SkillsShelfState {
  savedSkills: Skill[];
  setSavedSkills: (value: Skill[] | ((current: Skill[]) => Skill[])) => void;
  resetForRemount: () => void;
}

export const useSkillsShelfStore = create<SkillsShelfState>((set) => ({
  savedSkills: [],
  setSavedSkills: (value) =>
    set((state) => ({
      savedSkills: typeof value === 'function' ? value(state.savedSkills) : value,
    })),
  resetForRemount: () => set({ savedSkills: [] }),
}));
