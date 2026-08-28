import type { IdeaFragment, Foreshadowing, NarrativePromiseEvidence, NarrativePromisePlan } from '../../../shared/types';
import { deriveForeshadowingCompatibilityStatus, normalizeNarrativePromiseCore, validateNarrativePromisePlan } from '../../../shared/lib/narrative-promise.js';
import { getDb, runInSerializedWriteForGeneration, runInTransaction } from '../db-instance.js';
import { rowToIdeaFragment, ideaFragmentToRow, rowToForeshadowing, foreshadowingToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';
import { getArtifactCore, saveArtifactVersion } from './creative-artifacts.js';

const ideaFragmentCrud = createCrudHelpers<IdeaFragment, ReturnType<typeof ideaFragmentToRow>>({
  tableName: 'idea_fragments',
  rowToEntity: rowToIdeaFragment,
  entityToRow: ideaFragmentToRow,
  insertColumns: ['id', 'novel_id', 'content', 'type', 'status', 'ai_expansion', 'target_chapter_id', 'created_at', 'updated_at'],
  updateColumns: ['content', 'type', 'status', 'ai_expansion', 'target_chapter_id', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'created_at DESC'
});

export function listIdeaFragments(novelId?: string): IdeaFragment[] {
  if (novelId) {
    return getDb().prepare('SELECT * FROM idea_fragments WHERE novel_id = ? OR novel_id IS NULL ORDER BY created_at DESC').all(novelId).map(rowToIdeaFragment);
  }
  return ideaFragmentCrud.list();
}

export function createIdeaFragment(f: IdeaFragment): void {
  ideaFragmentCrud.create(f);
}

export function updateIdeaFragment(id: string, data: Partial<IdeaFragment>): boolean {
  return ideaFragmentCrud.update(id, data);
}

export function deleteIdeaFragment(id: string): void {
  ideaFragmentCrud.delete(id);
}

const foreshadowingCrud = createCrudHelpers<Foreshadowing, ReturnType<typeof foreshadowingToRow>>({
  tableName: 'foreshadowings',
  rowToEntity: rowToForeshadowing,
  entityToRow: foreshadowingToRow,
  insertColumns: ['id', 'novel_id', 'title', 'description', 'status', 'planted_chapter_id', 'payoff_chapter_id', 'related_character_ids', 'notes', 'created_at', 'updated_at'],
  updateColumns: ['title', 'description', 'status', 'planted_chapter_id', 'payoff_chapter_id', 'related_character_ids', 'notes', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'created_at ASC'
});

export function listForeshadowings(novelId: string): Foreshadowing[] {
  return foreshadowingCrud.list(novelId).map(hydrateNarrativeCore);
}

export function getForeshadowing(id: string): Foreshadowing | undefined {
  const value = foreshadowingCrud.get(id);
  return value ? hydrateNarrativeCore(value) : undefined;
}

function hydrateNarrativeCore(foreshadowing: Foreshadowing): Foreshadowing {
  const stored = getArtifactCore(foreshadowing.novelId, 'narrative-promise', foreshadowing.id);
  const core = normalizeNarrativePromiseCore(stored?.core);
  return core && stored ? { ...foreshadowing, narrativeCore: core, coreVersion: stored.version } : foreshadowing;
}

export function saveNarrativePromiseCoreInTransaction(input: {
  novelId: string;
  foreshadowingId: string;
  expectedVersion?: number;
  plan?: NarrativePromisePlan;
  evidenceToAppend?: NarrativePromiseEvidence[];
}): Foreshadowing {
    const currentForeshadowing = foreshadowingCrud.get(input.foreshadowingId);
    if (!currentForeshadowing || currentForeshadowing.novelId !== input.novelId) {
      throw new Error('NARRATIVE_PROMISE_NOT_FOUND');
    }
    const stored = getArtifactCore(input.novelId, 'narrative-promise', input.foreshadowingId);
    if ((stored?.version ?? 0) !== (input.expectedVersion ?? 0)) throw new Error('NARRATIVE_PROMISE_VERSION_STALE');
    const currentCore = normalizeNarrativePromiseCore(stored?.core);
    const plan = input.plan ?? currentCore?.plan;
    if (!plan || validateNarrativePromisePlan(plan).length) throw new Error('NARRATIVE_PROMISE_PLAN_INVALID');
    const evidence = [...(currentCore?.evidence || [])];
    for (const item of input.evidenceToAppend || []) {
      const chapterId = typeof item.chapterId === 'string' ? item.chapterId.trim() : '';
      const quote = typeof item.quote === 'string' ? item.quote.trim() : '';
      const location = typeof item.location === 'string' ? item.location.trim() : '';
      if (!chapterId || !quote || !['plant', 'hint', 'payoff'].includes(item.action) || !Number.isFinite(item.confirmedAt)) continue;
      const duplicate = evidence.some((existing) => existing.chapterId === chapterId
        && existing.action === item.action && existing.quote === quote && (existing.location || '') === location);
      if (!duplicate) evidence.push({ ...item, chapterId, quote, location: location || undefined });
    }
    const core = { schemaVersion: 1 as const, plan, evidence };
    const saved = saveArtifactVersion({
      novelId: input.novelId,
      artifactKind: 'narrative-promise',
      artifactId: input.foreshadowingId,
      expectedVersion: stored?.version ?? 0,
      core,
      provenance: { source: 'narrative-promise-confirmation' },
    });
    const planted = evidence.find((item) => item.action === 'plant');
    const payoff = evidence.find((item) => item.action === 'payoff');
    foreshadowingCrud.update(input.foreshadowingId, {
      status: deriveForeshadowingCompatibilityStatus(evidence),
      plantedChapterId: planted?.chapterId,
      payoffChapterId: payoff?.chapterId,
      coreVersion: saved.version,
      updatedAt: Date.now(),
    });
    return hydrateNarrativeCore(foreshadowingCrud.get(input.foreshadowingId)!);
}

export async function saveNarrativePromiseCore(input: {
  novelId: string;
  foreshadowingId: string;
  databaseGeneration: number;
  expectedVersion?: number;
  plan?: NarrativePromisePlan;
  evidenceToAppend?: NarrativePromiseEvidence[];
}): Promise<Foreshadowing> {
  const guarded = await runInSerializedWriteForGeneration(input.databaseGeneration, () => runInTransaction(() => {
    return saveNarrativePromiseCoreInTransaction(input);
  }));
  if (!guarded.executed) throw new Error('NARRATIVE_PROMISE_GENERATION_STALE');
  return guarded.result;
}

export function createForeshadowing(f: Foreshadowing): void {
  foreshadowingCrud.create(f);
}

export function updateForeshadowing(id: string, data: Partial<Foreshadowing>): void {
  foreshadowingCrud.update(id, data);
}

export function deleteForeshadowing(id: string): void {
  foreshadowingCrud.delete(id);
}
