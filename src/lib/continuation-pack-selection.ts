import type { ContinuationPack } from '../../shared/types';

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

  const sorted = sortContinuationPacksByRecency(packs);
  const approved = sorted.find((p) => p.status === 'approved');
  if (approved) return approved.id;

  return sorted[0]?.id || '';
}

export function getPreferredContinuationPack(
  packs: ContinuationPack[],
  currentPackId?: string,
): ContinuationPack | null {
  const id = getPreferredContinuationPackId(packs, currentPackId);
  return packs.find((p) => p.id === id) || null;
}
