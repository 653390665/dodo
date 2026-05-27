import type { ContinuationPack } from '../types';

function compareByRecency(a: ContinuationPack, b: ContinuationPack): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
  return b.createdAt - a.createdAt;
}

export function sortContinuationPacksByRecency(packs: ContinuationPack[]): ContinuationPack[] {
  return [...packs].sort(compareByRecency);
}

export function getPreferredContinuationPackId(
  packs: ContinuationPack[],
  currentPackId?: string,
): string {
  if (currentPackId && packs.some((pack) => pack.id === currentPackId)) {
    return currentPackId;
  }

  return sortContinuationPacksByRecency(packs)[0]?.id || '';
}
