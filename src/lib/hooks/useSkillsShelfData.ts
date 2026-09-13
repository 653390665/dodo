import { useEffect } from 'react';
import { logger } from '../client-logger';
import { subscribeToChanges } from '../db-transport';
import { syncSkillFeedbackScores } from '../skill-client';
import { useSkillsShelfStore } from '../../stores/skills-shelf-store';

/**
 * 技能货架数据获取（Plan 195 切片 C Step 1：自 SkillsStudioView 迁出）。
 *
 * savedSkills 的加载（syncSkillFeedbackScores）与跨端订阅（subscribeToChanges）
 * 收口在本 hook；乐观更新（创建/消毒后追加卡片）沿用原 setState 调用点，
 * 经返回的 setSavedSkills 镜像 setter 完成行为零变化迁移。
 */
export function useSkillsShelfData() {
  const savedSkills = useSkillsShelfStore((state) => state.savedSkills);
  const setSavedSkills = useSkillsShelfStore((state) => state.setSavedSkills);

  useEffect(() => {
    const refreshSkills = () => {
      syncSkillFeedbackScores()
        .then(setSavedSkills)
        .catch((err) => logger.warn('Failed to load skills:', err));
    };
    refreshSkills();
    return subscribeToChanges(refreshSkills);
  }, [setSavedSkills]);

  // store 生命周期对齐原 useState 的按挂载初始化语义（见 store resetForRemount 注释）。
  useEffect(() => () => useSkillsShelfStore.getState().resetForRemount(), []);

  return { savedSkills, setSavedSkills };
}
