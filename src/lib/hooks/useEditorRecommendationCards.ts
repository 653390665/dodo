import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../toast';
import { recordProductEvent } from '../product-events-client';

/**
 * 推荐卡片操作自定义 Hook 接口参数
 */
interface UseEditorRecommendationCardsArgs {
  novelId: string;
  chapterId?: string;
  initialStackedIds?: string[];
  maxStackedCards?: number;
  onStackedIdsChange?: (ids: string[]) => Promise<void> | void;
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
export const MAX_SESSION_CARDS = 6;

function normalizeIds(value: unknown, limit = MAX_SESSION_CARDS): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string').map(id => id.trim()).filter(Boolean))].slice(0, limit);
}

type SessionState = { key: string; stackedIds: string[]; skippedIds: string[] };

function readStoredState(key: string, initialStackedIds: string[] | undefined, limit: number): { stackedIds: string[]; skippedIds: string[] } {
  const initial = normalizeIds(initialStackedIds, limit);
  if (initialStackedIds !== undefined) return { stackedIds: initial, skippedIds: [] };
  if (typeof window === 'undefined' || !window.sessionStorage) return { stackedIds: initial, skippedIds: [] };
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) || '{}') as { stackedIds?: unknown; skippedIds?: unknown };
    return { stackedIds: normalizeIds(parsed.stackedIds, limit), skippedIds: normalizeIds(parsed.skippedIds) };
  } catch {
    return { stackedIds: initial, skippedIds: [] };
  }
}

export function useEditorRecommendationCards({
  novelId,
  chapterId,
  initialStackedIds,
  maxStackedCards = MAX_SESSION_CARDS,
  onStackedIdsChange,
  recordSkillUsageRef,
}: UseEditorRecommendationCardsArgs) {
  const stackLimit = Math.max(0, Math.min(MAX_SESSION_CARDS, Math.floor(maxStackedCards)));
  const storageKey = useMemo(() => `inkflow:recommendation-cards:v1:${encodeURIComponent(novelId)}:${encodeURIComponent(chapterId || 'none')}`, [novelId, chapterId]);
  const initialStackedSignature = normalizeIds(initialStackedIds, stackLimit).join('\u0000');
  const [sessionState, setSessionState] = useState<SessionState>(() => ({ key: storageKey, ...readStoredState(storageKey, initialStackedIds, stackLimit) }));
  const stackedRef = useRef(sessionState.key === storageKey ? sessionState.stackedIds : []);
  const skippedRef = useRef(sessionState.key === storageKey ? sessionState.skippedIds : []);

  useEffect(() => {
    if (sessionState.key === storageKey) return;
    const stored = readStoredState(storageKey, initialStackedIds, stackLimit);
    stackedRef.current = stored.stackedIds;
    skippedRef.current = stored.skippedIds;
    // Reset the single external session state when the novel/chapter key changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionState({ key: storageKey, ...stored });
  }, [initialStackedSignature, initialStackedIds, sessionState.key, stackLimit, storageKey]);

  const persist = useCallback((stacked: string[], skipped: string[]) => {
    try { window.sessionStorage.setItem(storageKey, JSON.stringify({ stackedIds: stacked, skippedIds: skipped })); } catch { /* storage is optional */ }
  }, [storageKey]);

  const isSessionStateLoaded = sessionState.key === storageKey;
  const visibleStackedIds = isSessionStateLoaded ? sessionState.stackedIds : [];
  const visibleSkippedIds = isSessionStateLoaded ? sessionState.skippedIds : [];

  /**
   * 将拆书推荐卡加入本章使用。
   */
  const handleStackDeconstructionCard = async (assetId: string) => {
    if (!isSessionStateLoaded) return;
    const id = assetId.trim();
    if (!id || stackedRef.current.includes(id)) return;
    if (stackedRef.current.length >= stackLimit) { toast(`本章最多使用 ${stackLimit} 张拆书卡`, 'info'); return; }
    const next = [...stackedRef.current, id];
    try {
      await onStackedIdsChange?.(next);
    } catch {
      toast('拆书卡保存失败，未改变本章配置', 'error');
      return;
    }
    stackedRef.current = next;
    setSessionState({ key: storageKey, stackedIds: next, skippedIds: skippedRef.current });
    persist(next, skippedRef.current);
    if (recordSkillUsageRef.current) {
      void recordSkillUsageRef.current('accepted', { notes: `stacked:${id}`, skillIds: [id] }).catch(() => {});
    }
    void recordProductEvent({ eventName: 'deconstruction_card_stack', stage: 'drafting', result: 'success', novelId, chapterId, objectId: id });
    toast('已加入本章使用卡，相关素材将融入后续生成上下文', 'success');
  };

  /**
   * 将拆书推荐卡移出本章使用。
   */
  const handleUnstackDeconstructionCard = async (assetId: string) => {
    if (!isSessionStateLoaded) return;
    const id = assetId.trim();
    if (!stackedRef.current.includes(id)) return;
    const next = stackedRef.current.filter(existing => existing !== id);
    try {
      await onStackedIdsChange?.(next);
    } catch {
      toast('拆书卡保存失败，未改变本章配置', 'error');
      return;
    }
    stackedRef.current = next;
    setSessionState({ key: storageKey, stackedIds: next, skippedIds: skippedRef.current });
    persist(next, skippedRef.current);
    if (recordSkillUsageRef.current) {
      void recordSkillUsageRef.current('rejected', { notes: `unstacked:${id}`, skillIds: [id] }).catch(() => {});
    }
    void recordProductEvent({ eventName: 'deconstruction_card_unstack', stage: 'drafting', result: 'success', novelId, chapterId, objectId: id });
    toast('已移出本章使用卡', 'info');
  };

  const removeStackedDeconstructionCard = useCallback(async (assetId: string) => {
    if (!isSessionStateLoaded) return;
    const id = assetId.trim();
    if (!stackedRef.current.includes(id)) return;
    const next = stackedRef.current.filter(existing => existing !== id);
    try {
      await onStackedIdsChange?.(next);
    } catch {
      toast('拆书卡保存失败，未改变本章配置', 'error');
      return;
    }
    stackedRef.current = next;
    setSessionState({ key: storageKey, stackedIds: next, skippedIds: skippedRef.current });
    persist(next, skippedRef.current);
  }, [isSessionStateLoaded, onStackedIdsChange, persist, storageKey]);

  /**
   * 跳过当前推荐资产
   * 
   * @param assetId 资产/素材卡片 ID
   */
  const handleSkipAsset = async (assetId: string) => {
    if (!isSessionStateLoaded) return;
    const id = assetId.trim();
    if (!id || skippedRef.current.includes(id)) return;
    if (skippedRef.current.length >= MAX_SESSION_CARDS) { toast('最多保留 6 张跳过卡', 'info'); return; }
    const next = [...skippedRef.current, id];
    skippedRef.current = next;
    setSessionState({ key: storageKey, stackedIds: stackedRef.current, skippedIds: next });
    persist(stackedRef.current, next);
    if (recordSkillUsageRef.current) {
      void recordSkillUsageRef.current('rejected', { notes: `skipped:${id}`, skillIds: [id] }).catch(() => {});
    }
    void recordProductEvent({ eventName: 'deconstruction_card_skip', stage: 'drafting', result: 'success', novelId, chapterId, objectId: id });
    toast('已跳过该推荐，自动更换其他推荐', 'info');
  };

  return {
    skippedAssetIds: visibleSkippedIds,
    stackedDeconstructionCardIds: visibleStackedIds,
    handleStackDeconstructionCard,
    handleUnstackDeconstructionCard,
    removeStackedDeconstructionCard,
    handleSkipAsset,
    isSessionStateLoaded,
  };
}
