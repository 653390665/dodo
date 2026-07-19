import { useState, useEffect, useRef } from 'react';
import { ContinuationPack, ContinuationEditorLaunchState } from '../../../shared/types';
import { listContinuationPacks } from '../continuation-client';
import { sortContinuationPacksByRecency, getPreferredContinuationPackId } from '../continuation-pack-selection';
import { subscribeToChanges } from '../db-transport';

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
  const [continuationPacks, setContinuationPacks] = useState<ContinuationPack[]>([]);
  const [selectedContinuationPackId, setSelectedContinuationPackId] = useState('');
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
      setSelectedContinuationPackId((current) => {
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
