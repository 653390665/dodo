import { type MutableRefObject, useState } from 'react';
import { toast } from '../toast';

/**
 * 推荐卡片操作自定义 Hook 接口参数
 */
interface UseEditorRecommendationCardsArgs {
  /**
   * 记录 Skill 使用情况的 Ref，用以打破 React Hook 的循环依赖链
   */
  recordSkillUsageRef: MutableRefObject<((
    userAction: 'accepted' | 'revised' | 'rejected',
    options?: { fitScore?: number; auditScore?: number; notes?: string; skillIds?: string[] },
  ) => Promise<void>) | null>;
}

/**
 * useEditorRecommendationCards 自定义 Hook
 * 
 * 用于封装和物理拆分编辑器中推荐卡片的 Skip 和 Stack 操作逻辑
 * 减少 EditorView 组件的大小，提升代码可读性与可维护性
 */
export function useEditorRecommendationCards({ recordSkillUsageRef }: UseEditorRecommendationCardsArgs) {
  // 被跳过的推荐素材资产 ID 列表
  const [skippedAssetIds, setSkippedAssetIds] = useState<string[]>([]);
  // 被叠加的拆书推荐卡片 ID 列表
  const [stackedDeconstructionCardIds, setStackedDeconstructionCardIds] = useState<string[]>([]);

  /**
   * 叠加拆书推荐卡片
   * 
   * @param assetId 资产/素材卡片 ID
   */
  const handleStackDeconstructionCard = async (assetId: string) => {
    setStackedDeconstructionCardIds(prev => [...prev, assetId]);
    if (recordSkillUsageRef.current) {
      await recordSkillUsageRef.current('accepted', { notes: `stacked:${assetId}`, skillIds: [assetId] });
    }
    toast('已成功叠加拆书卡，相关素材将融入后续生成上下文', 'success');
  };

  /**
   * 撤销叠加拆书推荐卡片
   * 
   * @param assetId 资产/素材卡片 ID
   */
  const handleUnstackDeconstructionCard = async (assetId: string) => {
    setStackedDeconstructionCardIds(prev => prev.filter(id => id !== assetId));
    if (recordSkillUsageRef.current) {
      await recordSkillUsageRef.current('rejected', { notes: `unstacked:${assetId}`, skillIds: [assetId] });
    }
    toast('已撤销拆书卡叠加', 'info');
  };

  /**
   * 跳过当前推荐资产
   * 
   * @param assetId 资产/素材卡片 ID
   */
  const handleSkipAsset = async (assetId: string) => {
    setSkippedAssetIds(prev => [...prev, assetId]);
    if (recordSkillUsageRef.current) {
      await recordSkillUsageRef.current('rejected', { notes: `skipped:${assetId}`, skillIds: [assetId] });
    }
    toast('已跳过该推荐，自动更换其他推荐', 'info');
  };

  return {
    skippedAssetIds,
    stackedDeconstructionCardIds,
    handleStackDeconstructionCard,
    handleUnstackDeconstructionCard,
    handleSkipAsset,
    setSkippedAssetIds,
    setStackedDeconstructionCardIds,
  };
}
