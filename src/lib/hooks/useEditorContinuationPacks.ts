import { useEffect, useRef } from 'react';
import type { ContinuationEditorLaunchState } from '../../../shared/types';
import { listContinuationPacks } from '../continuation-client';
import { sortContinuationPacksByRecency, getPreferredContinuationPackId } from '../continuation-pack-selection';
import { subscribeToChanges } from '../db-transport';
import { useContinuationPackStore } from '../../stores/continuation-pack-store';

/**
 * Custom hook managing the fetched continuation packs and current pack selection.
 *
 * Extracts data synchronization, launch token consumption, and recency sorting logic
 * out of the main EditorView.
 */
export function useEditorContinuationPacks(
  novelId: string,
  launchState: ContinuationEditorLaunchState | null | undefined
) {
  // 011 Phase 1：状态后端换 store；加载与同步逻辑逐行保留
  const continuationPacks = useContinuationPackStore((state) => state.continuationPacks);
  const setContinuationPacks = useContinuationPackStore((state) => state.setContinuationPacks);
  const selectedContinuationPackId = useContinuationPackStore((state) => state.selectedContinuationPackId);
  const setSelectedContinuationPackId = useContinuationPackStore((state) => state.setSelectedContinuationPackId);
  const setSelectedContinuationPackIdUpdatable = useContinuationPackStore((state) => state.setSelectedContinuationPackIdUpdatable);
  const hasConsumedContinuationPackSelectionRef = useRef(false);

  // Reset pack selection consumed state on launch token or novel change
  useEffect(() => {
    hasConsumedContinuationPackSelectionRef.current = false;
  }, [launchState?.launchToken, novelId]);

  // Synchronize continuation packs and selection from db & launch state
  useEffect(() => {
    // 178：换书过期守卫——慢响应到达时若 effect 已清理（换书）则丢弃，防止 A 书资料包写入 B 书。
    let cancelled = false;
    const refreshContinuationPacks = async () => {
      try {
        const packs = sortContinuationPacksByRecency(await listContinuationPacks(novelId));
        if (cancelled) return;
        setContinuationPacks(packs);
        setSelectedContinuationPackIdUpdatable((current) => {
          if (
            !hasConsumedContinuationPackSelectionRef.current &&
            launchState?.approvedPackId &&
            packs.some((pack) => pack.id === launchState.approvedPackId)
          ) {
            hasConsumedContinuationPackSelectionRef.current = true;
            return launchState.approvedPackId;
          }
          return getPreferredContinuationPackId(packs, current);
        });
      } catch {
        /* 列表刷新失败保留现值 */
      }
    };

    void refreshContinuationPacks();
    const unsubscribe = subscribeToChanges(() => {
      void refreshContinuationPacks();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [launchState?.approvedPackId, launchState?.launchToken, novelId, setContinuationPacks, setSelectedContinuationPackIdUpdatable]);

  return {
    continuationPacks,
    setContinuationPacks,
    selectedContinuationPackId,
    setSelectedContinuationPackId,
  };
}
