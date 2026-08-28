import { createHash } from 'node:crypto';
import type { ChapterFact, ChapterFactApplyInput, ChapterFactApplyResult, ChapterFactCandidate, ChapterFactKind } from '../../shared/types/chapter-facts.js';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow.js';
import * as db from '../lib/db.js';
import { getDatabaseGeneration, runInSerializedWriteForGeneration } from '../lib/db-instance.js';

type FactPatch = {
  characterUpdates?: Array<{ characterId: string; summaryAppend: string; evidenceQuote?: string }>;
  itemUpdates?: Array<{ itemId: string; descriptionAppend: string; evidenceQuote?: string }>;
  timelineEventsToCreate?: Array<{ title: string; timestamp: string; description: string; statusTag: string; evidenceQuote?: string }>;
  locationUpdates?: Array<{ locationId: string; descriptionAppend: string; evidenceQuote?: string }>;
  powerUpdates?: Array<{ powerLevelId: string; descriptionAppend: string; evidenceQuote?: string }>;
  narrativePromiseCandidates?: Array<{
    targetType: 'existing' | 'discovered'; foreshadowingId?: string; title?: string; description?: string;
    action: 'plant' | 'hint' | 'payoff'; evidenceQuote: string; location?: string;
  }>;
};

export class ChapterFactCandidateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ChapterFactCandidateError';
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function append(current: string, addition: string): string {
  return current && !current.endsWith('\n') ? `${current}\n${addition}` : `${current}${addition}`;
}

function assertOwned<T extends { novelId: string }>(value: T | undefined, novelId: string, label: string): T {
  if (!value || value.novelId !== novelId) throw new ChapterFactCandidateError('CHAPTER_FACT_TARGET_INVALID', `${label}不属于当前作品`);
  return value;
}

function storyMemoryFingerprint(novelId: string): string {
  return hash({
    characters: db.listCharacters(novelId), items: db.listItems(novelId), locations: db.listLocations(novelId),
    powerLevels: db.listPowerLevels(novelId), timelineEvents: db.listTimelineEvents(novelId),
    foreshadowings: db.listForeshadowings(novelId),
  });
}

function factId(kind: ChapterFactKind, targetId: string, value: unknown): string {
  return hash({ kind, targetId, value });
}

function readPatch(value: unknown): FactPatch {
  return value && typeof value === 'object' ? value as FactPatch : {};
}

function findEvidence(manuscript: string, quote: string): { quote: string; start: number; end: number } | undefined {
  const trimmed = quote.trim();
  const start = trimmed ? manuscript.indexOf(trimmed) : -1;
  return start < 0 ? undefined : { quote: trimmed, start, end: start + trimmed.length };
}

function makeFact(
  kind: ChapterFactKind,
  action: ChapterFact['action'],
  target: ChapterFact['target'],
  title: string,
  evidence: { quote: string; start: number; end: number },
  proposedValue: Record<string, unknown>,
  ambiguous = false,
  selectable = true,
  destructive = false,
): ChapterFact {
  return {
    id: factId(kind, target.id, proposedValue), kind, action, target, title, evidence: evidence.quote,
    evidenceSpan: { start: evidence.start, end: evidence.end }, proposedValue, destructive, ambiguous, selectable,
  };
}

export function buildChapterFactCandidate(input: {
  novelId: string;
  runId: string;
  draftContent: string;
  sceneBeats: string;
  databaseGeneration: number;
  targetChapterId?: string;
  proposedPatch: unknown;
}): ChapterFactCandidate {
  if (input.databaseGeneration !== getDatabaseGeneration()) {
    throw new ChapterFactCandidateError('CHAPTER_FACT_GENERATION_STALE', '数据库已变化，请刷新后重试');
  }
  const patch = readPatch(input.proposedPatch);
  const facts: ChapterFact[] = [];

  for (const update of patch.characterUpdates || []) {
    const character = assertOwned(db.getCharacter(update.characterId), input.novelId, '角色');
    const evidence = update.evidenceQuote ? findEvidence(input.draftContent, update.evidenceQuote) : undefined;
    if (evidence) facts.push(makeFact('character', 'append', { kind: 'character', id: character.id, label: character.name }, '角色状态', evidence, { summaryAppend: update.summaryAppend }));
  }
  for (const update of patch.itemUpdates || []) {
    const item = assertOwned(db.getItem(update.itemId), input.novelId, '物品');
    const evidence = update.evidenceQuote ? findEvidence(input.draftContent, update.evidenceQuote) : undefined;
    if (evidence) facts.push(makeFact('item', 'append', { kind: 'item', id: item.id, label: item.name }, '物品状态', evidence, { descriptionAppend: update.descriptionAppend }));
  }
  for (const update of patch.locationUpdates || []) {
    const location = assertOwned(db.listLocations(input.novelId).find((item) => item.id === update.locationId), input.novelId, '地点');
    const evidence = update.evidenceQuote ? findEvidence(input.draftContent, update.evidenceQuote) : undefined;
    if (evidence) facts.push(makeFact('location', 'append', { kind: 'location', id: location.id, label: location.name }, '地点状态', evidence, { descriptionAppend: update.descriptionAppend }));
  }
  for (const update of patch.powerUpdates || []) {
    const power = assertOwned(db.listPowerLevels(input.novelId).find((item) => item.id === update.powerLevelId), input.novelId, '力量体系');
    const evidence = update.evidenceQuote ? findEvidence(input.draftContent, update.evidenceQuote) : undefined;
    if (evidence) facts.push(makeFact('power', 'append', { kind: 'power', id: power.id, label: power.name }, '力量体系状态', evidence, { descriptionAppend: update.descriptionAppend }));
  }
  for (const event of patch.timelineEventsToCreate || []) {
    const proposedValue = { ...event };
    const id = `timeline:${factId('timeline', event.title, proposedValue)}`;
    const evidence = event.evidenceQuote ? findEvidence(input.draftContent, event.evidenceQuote) : undefined;
    if (evidence) facts.push(makeFact('timeline', 'create', { kind: 'timeline', id, label: event.title }, '新增时间线事件', evidence, proposedValue, true));
  }
  for (const promise of patch.narrativePromiseCandidates || []) {
    if (promise.targetType === 'existing' && promise.foreshadowingId) {
      const target = assertOwned(db.getForeshadowing(promise.foreshadowingId), input.novelId, '叙事承诺');
      const evidence = findEvidence(input.draftContent, promise.evidenceQuote);
      if (!evidence) continue;
      facts.push(makeFact('narrative-promise', 'update', { kind: 'narrative-promise', id: target.id, label: target.title }, '叙事承诺证据', evidence, {
        action: promise.action, evidenceQuote: evidence.quote, location: promise.location, chapterId: input.targetChapterId, expectedVersion: target.coreVersion ?? 0,
      }, promise.action === 'payoff', Boolean(input.targetChapterId && target.narrativeCore?.plan), promise.action === 'payoff'));
    } else {
      const evidence = findEvidence(input.draftContent, promise.evidenceQuote);
      if (evidence) facts.push(makeFact('narrative-promise', 'create', { kind: 'narrative-promise', id: `unresolved:${hash(promise)}`, label: promise.title || '待关联叙事承诺' }, '待关联叙事承诺', evidence, { ...promise }, true, false));
    }
  }

  const manuscript = { contentHash: computeChapterWorkflowHash(input.draftContent, input.sceneBeats), evidence: input.draftContent };
  const memoryFingerprint = storyMemoryFingerprint(input.novelId);
  return {
    id: hash({ novelId: input.novelId, runId: input.runId, manuscript, databaseGeneration: input.databaseGeneration, memoryFingerprint, facts }),
    novelId: input.novelId, runId: input.runId, manuscript, databaseGeneration: input.databaseGeneration,
    storyMemoryFingerprint: memoryFingerprint, facts, status: 'pending',
  };
}

export function previewChapterFactCandidate(input: { novelId: string; runId: string; databaseGeneration: number }): ChapterFactCandidate {
  const run = db.getChapterProductionRun(input.runId);
  if (!run || run.novelId !== input.novelId) throw new ChapterFactCandidateError('CHAPTER_FACT_RUN_NOT_FOUND', '生成任务不存在或不属于当前作品');
  if (run.continuityReport.databaseGeneration !== input.databaseGeneration) {
    throw new ChapterFactCandidateError('CHAPTER_FACT_GENERATION_STALE', '生成任务来自旧版本数据库');
  }
  const candidate = buildChapterFactCandidate({
    novelId: input.novelId, runId: run.id, draftContent: run.draftContent, sceneBeats: run.sceneBeats,
    databaseGeneration: input.databaseGeneration, targetChapterId: run.targetChapterId, proposedPatch: run.continuityReport.proposedPatch,
  });
  const decisions = (run.continuityReport as typeof run.continuityReport & { factCandidateDecisions?: { factStatuses?: Record<string, string> } }).factCandidateDecisions;
  if (!decisions?.factStatuses) return candidate;
  return { ...candidate, facts: candidate.facts.filter((fact) => {
    const status = decisions.factStatuses?.[fact.id];
    return status !== 'accepted' && status !== 'rejected';
  }) };
}

function applyFact(fact: ChapterFact, novelId: string): void {
  if (!fact.selectable) throw new ChapterFactCandidateError('CHAPTER_FACT_REVIEW_REQUIRED', '该事实缺少可写入的目标记录');
  if (fact.kind === 'character') {
    const target = assertOwned(db.getCharacter(fact.target.id), novelId, '角色');
    db.updateCharacter(target.id, { summary: append(target.summary || '', String(fact.proposedValue.summaryAppend || '')), updatedAt: Date.now() });
    return;
  }
  if (fact.kind === 'item') {
    const target = assertOwned(db.getItem(fact.target.id), novelId, '物品');
    db.updateItem(target.id, { description: append(target.description || '', String(fact.proposedValue.descriptionAppend || '')), updatedAt: Date.now() });
    return;
  }
  if (fact.kind === 'location') {
    const target = assertOwned(db.listLocations(novelId).find((item) => item.id === fact.target.id), novelId, '地点');
    db.updateLocation(target.id, { description: append(target.description || '', String(fact.proposedValue.descriptionAppend || '')), updatedAt: Date.now() });
    return;
  }
  if (fact.kind === 'power') {
    const target = assertOwned(db.listPowerLevels(novelId).find((item) => item.id === fact.target.id), novelId, '力量体系');
    db.updatePowerLevel(target.id, { description: append(target.description || '', String(fact.proposedValue.descriptionAppend || '')), updatedAt: Date.now() });
    return;
  }
  if (fact.kind === 'timeline') {
    const event = fact.proposedValue;
    if (typeof event.title !== 'string' || typeof event.timestamp !== 'string' || typeof event.description !== 'string') {
      throw new ChapterFactCandidateError('CHAPTER_FACT_INVALID_DATA', '时间线事实数据无效');
    }
    const order = db.listTimelineEvents(novelId).length + 1;
    db.createTimelineEvent({
      id: fact.target.id, novelId, title: event.title, timestamp: event.timestamp, description: event.description,
      ...(typeof event.statusTag === 'string' ? { statusTag: event.statusTag } : {}), order, createdAt: Date.now(), updatedAt: Date.now(),
    });
    return;
  }
  if (fact.kind === 'narrative-promise') {
    const target = assertOwned(db.getForeshadowing(fact.target.id), novelId, '叙事承诺');
    const action = fact.proposedValue.action;
    const quote = fact.proposedValue.evidenceQuote;
    const chapterId = fact.proposedValue.chapterId;
    if ((action !== 'plant' && action !== 'hint' && action !== 'payoff') || typeof quote !== 'string' || !chapterId) {
      throw new ChapterFactCandidateError('CHAPTER_FACT_INVALID_DATA', '叙事承诺缺少可验证正文证据');
    }
    db.saveNarrativePromiseCoreInTransaction({
      novelId, foreshadowingId: target.id, expectedVersion: Number(fact.proposedValue.expectedVersion ?? 0),
      evidenceToAppend: [{ chapterId: String(chapterId), action, quote, location: typeof fact.proposedValue.location === 'string' ? fact.proposedValue.location : undefined, confirmedAt: Date.now() }],
    });
    return;
  }
  throw new ChapterFactCandidateError('CHAPTER_FACT_INVALID_DATA', '不支持的事实类型');
}

export async function applyChapterFactCandidate(input: ChapterFactApplyInput): Promise<ChapterFactApplyResult> {
  const guarded = await runInSerializedWriteForGeneration(input.databaseGeneration, () => db.runInTransaction(() => {
    const run = db.getChapterProductionRun(input.runId);
    if (!run || run.novelId !== input.novelId) throw new ChapterFactCandidateError('CHAPTER_FACT_RUN_NOT_FOUND', '生成任务不存在或不属于当前作品');
    if (run.status !== 'applied' || !run.targetChapterId) {
      throw new ChapterFactCandidateError('CHAPTER_FACT_MANUSCRIPT_NOT_ACCEPTED', '请先接受正文版本，再确认章节事实');
    }
    const chapter = assertOwned(db.getChapter(run.targetChapterId), input.novelId, '已接受章节');
    const acceptedManuscriptHash = computeChapterWorkflowHash(chapter.content, chapter.sceneBeats);
    const candidate = previewChapterFactCandidate({ novelId: input.novelId, runId: input.runId, databaseGeneration: input.databaseGeneration });
    if (candidate.id !== input.candidateId || candidate.manuscript.contentHash !== input.manuscriptContentHash
      || candidate.manuscript.contentHash !== acceptedManuscriptHash || candidate.storyMemoryFingerprint !== input.storyMemoryFingerprint) {
      throw new ChapterFactCandidateError('CHAPTER_FACT_STALE', '正文或故事记忆已变化，请重新预览');
    }
    if (candidate.facts.some((fact) => chapter.content.slice(fact.evidenceSpan.start, fact.evidenceSpan.end) !== fact.evidence)) {
      throw new ChapterFactCandidateError('CHAPTER_FACT_EVIDENCE_STALE', '正文证据已变化，请重新预览');
    }
    const known = new Set(candidate.facts.map((fact) => fact.id));
    const selected = new Set(input.selectedFactIds || []);
    const rejected = new Set(input.rejectedFactIds || []);
    if ((input.factDecisions !== undefined && (input.selectedFactIds !== undefined || input.rejectedFactIds !== undefined))
      || [...selected, ...rejected].some((id) => typeof id !== 'string' || !known.has(id))
      || [...selected].some((id) => rejected.has(id))
      || Object.entries(input.factDecisions || {}).some(([id, decision]) => !known.has(id) || (decision !== 'accepted' && decision !== 'rejected' && decision !== 'pending'))) {
      throw new ChapterFactCandidateError('CHAPTER_FACT_SELECTION_INVALID', '事实选择不属于当前候选');
    }
    const explicitDecisions = Object.fromEntries(candidate.facts.map((fact) => [
      fact.id,
      input.factDecisions?.[fact.id] ?? (selected.has(fact.id) ? 'accepted' : rejected.has(fact.id) ? 'rejected' : 'pending'),
    ])) as Record<string, 'accepted' | 'rejected' | 'pending'>;
    for (const fact of candidate.facts) if (explicitDecisions[fact.id] === 'accepted') applyFact(fact, input.novelId);
    const existingStatuses = (run.continuityReport as typeof run.continuityReport & { factCandidateDecisions?: { factStatuses?: Record<string, string> } }).factCandidateDecisions?.factStatuses || {};
    const factStatuses = { ...existingStatuses, ...explicitDecisions } as Record<string, 'accepted' | 'rejected' | 'pending'>;
    db.updateChapterProductionRun(input.runId, {
      continuityReport: {
        ...run.continuityReport,
        factCandidateDecisions: { candidateId: input.candidateId, factStatuses },
      } as typeof run.continuityReport,
    });
    const workflowMeta = chapter.workflowMeta;
    const ownsWorkflowCandidate = workflowMeta?.factCandidateRunId === input.runId
      || workflowMeta?.factCandidateId === input.candidateId;
    if (workflowMeta && ownsWorkflowCandidate) {
      const remainingCandidate = previewChapterFactCandidate({ novelId: input.novelId, runId: input.runId, databaseGeneration: input.databaseGeneration });
      if (remainingCandidate.facts.length > 0) {
        db.updateChapter(chapter.id, { workflowMeta: { ...workflowMeta, factCandidateId: remainingCandidate.id, factCandidateRunId: input.runId } });
      } else {
        const resolvedWorkflowMeta = { ...workflowMeta };
        delete resolvedWorkflowMeta.factCandidateId;
        delete resolvedWorkflowMeta.factCandidateRunId;
        db.updateChapter(chapter.id, { workflowMeta: resolvedWorkflowMeta });
      }
    }
    return { candidate, factStatuses } as ChapterFactApplyResult;
  }));
  if (!guarded.executed) throw new ChapterFactCandidateError('CHAPTER_FACT_GENERATION_STALE', '数据库已变化，请刷新后重试');
  return guarded.result;
}
