import { useEffect, useRef } from 'react';
import { ContinuationPack, ContinuationEditorLaunchState } from '../../../shared/types';
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
    const refreshContinuationPacks = async () => {
      const packs = sortContinuationPacksByRecency(await listContinuationPacks(novelId));
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
    };

    void refreshContinuationPacks();
    return subscribeToChanges(() => {
      void refreshContinuationPacks();
    });
  }, [launchState?.approvedPackId, launchState?.launchToken, novelId]);

  return {
    continuationPacks,
    setContinuationPacks,
    selectedContinuationPackId,
    setSelectedContinuationPackId,
  };
}
