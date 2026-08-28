import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildNarrativePromiseImpacts,
  deriveForeshadowingCompatibilityStatus,
  normalizeNarrativePromiseCore,
  validateNarrativePromisePlan,
} from '../shared/lib/narrative-promise.js';
import { buildStoryStateLedger } from '../shared/lib/story-state-ledger.js';
import { buildProductionWriterContext } from '../shared/lib/chapter-production.js';
import type { NarrativePromiseCore, NarrativePromisePlan } from '../shared/types/story-memory.js';
import { closeDb, createForeshadowing, createNovel, getArtifactCore, getForeshadowing, initDb, saveNarrativePromiseCore } from '../server/lib/db.js';
import { advanceDatabaseGeneration, getDatabaseGeneration } from '../server/lib/db-instance.js';

const plan: NarrativePromisePlan = {
  intent: '戒指身份悬念',
  revealConstraint: '本章只能暗示纹章，不能揭示父亲身份',
  plannedPlantRange: { from: 1, to: 1 },
  plannedHintRanges: [{ from: 3, to: 3 }, { from: 6, to: 7 }],
  plannedPayoffRange: { from: 10, to: 12 },
  sourceOutlineNodeIds: ['master-hook-1'],
};

test('plan and manuscript evidence remain separate and produce deterministic impacts', () => {
  const core: NarrativePromiseCore = { schemaVersion: 1, plan, evidence: [] };
  assert.equal(deriveForeshadowingCompatibilityStatus(core.evidence), 'planted');
  assert.notEqual(deriveForeshadowingCompatibilityStatus(core.evidence), 'payoff');
  assert.equal(deriveForeshadowingCompatibilityStatus([{ chapterId: 'c3', action: 'hint', quote: '纹章', confirmedAt: 1 }]), 'hinted');
  assert.deepEqual(buildNarrativePromiseImpacts(core, 5).map((item) => [item.action, item.status]), [
    ['plant', 'overdue'], ['hint', 'deferred'], ['hint', 'scheduled'], ['payoff', 'scheduled'],
  ]);
  const evidenced = { ...core, evidence: [
    { chapterId: 'c1', action: 'plant' as const, quote: '他藏起戒指', confirmedAt: 1 },
    { chapterId: 'c3', action: 'hint' as const, quote: '纹章一闪', confirmedAt: 2 },
    { chapterId: 'c11', action: 'payoff' as const, quote: '父亲留下了戒指', confirmedAt: 3 },
  ] };
  assert.equal(deriveForeshadowingCompatibilityStatus(evidenced.evidence), 'payoff');
  assert.equal(buildNarrativePromiseImpacts(evidenced, 11).at(-1)?.status, 'satisfied');
});

test('plan validation rejects malformed and chronologically reversed windows', () => {
  assert.deepEqual(validateNarrativePromisePlan(plan), []);
  const issues = validateNarrativePromisePlan({
    ...plan,
    intent: '',
    plannedHintRanges: [{ from: 8, to: 7 }, { from: 0, to: 0 }],
    plannedPayoffRange: { from: 2, to: 3 },
    sourceOutlineNodeIds: ['master-hook-1', 'master-hook-1'],
  });
  assert.ok(issues.some((item) => item.code === 'INTENT_REQUIRED'));
  assert.ok(issues.some((item) => item.code === 'RANGE_INVALID'));
  assert.ok(issues.some((item) => item.code === 'SOURCE_OUTLINE_NODE_INVALID'));
  assert.ok(issues.some((item) => item.code === 'WINDOW_ORDER_INVALID'));
  assert.ok(validateNarrativePromisePlan({ ...plan, sourceOutlineNodeIds: [] }).some((item) => item.code === 'SOURCE_OUTLINE_NODE_INVALID'));
  assert.ok(validateNarrativePromisePlan({
    ...plan,
    plannedPlantRange: { from: 1, to: 5 },
    plannedHintRanges: [{ from: 4, to: 6 }],
  }).some((item) => item.code === 'WINDOW_ORDER_INVALID'));
  assert.ok(validateNarrativePromisePlan({
    ...plan,
    plannedPlantRange: { from: 1, to: 3 },
    plannedHintRanges: [{ from: 3, to: 4 }],
  }).some((item) => item.code === 'WINDOW_ORDER_INVALID'));
  assert.equal(normalizeNarrativePromiseCore({
    schemaVersion: 1,
    plan: { intent: '坏数据', plannedHintRanges: 'not-an-array', sourceOutlineNodeIds: [1] },
    evidence: [],
  }), undefined);
  assert.deepEqual(buildNarrativePromiseImpacts({ schemaVersion: 1, plan, evidence: [] }, 8)
    .filter((item) => item.action === 'hint').map((item) => item.status), ['deferred', 'overdue']);
});

test('governed persistence hydrates cores, preserves evidence across plan changes, and derives compatibility status', async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-narrative-promise-')), 'test.db');
  initDb(dbPath);
  try {
    createNovel({ id: 'n1', title: 'N', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
    createForeshadowing({ id: 'f1', novelId: 'n1', title: '戒指', description: '', status: 'planted', relatedCharacterIds: [], createdAt: 1, updatedAt: 1 });
    const planted = await saveNarrativePromiseCore({
      novelId: 'n1', foreshadowingId: 'f1', databaseGeneration: getDatabaseGeneration(), expectedVersion: 0, plan,
      evidenceToAppend: [{ chapterId: 'c1', action: 'plant', quote: '他藏起戒指', location: '第一段', confirmedAt: 10 }],
    });
    assert.equal(planted.coreVersion, 1);
    assert.equal(planted.narrativeCore?.evidence.length, 1);
    assert.equal(getArtifactCore('n1', 'narrative-promise', 'f1')?.version, 1);

    const revised = await saveNarrativePromiseCore({
      novelId: 'n1', foreshadowingId: 'f1', databaseGeneration: getDatabaseGeneration(), expectedVersion: 1,
      plan: { ...plan, revealConstraint: '只揭示纹章来源' },
      evidenceToAppend: [
        { chapterId: ' c1 ', action: 'plant', quote: ' 他藏起戒指 ', location: ' 第一段 ', confirmedAt: 99 },
        { chapterId: 'c11', action: 'payoff', quote: '父亲留下了戒指', confirmedAt: 20 },
      ],
    });
    assert.equal(revised.narrativeCore?.evidence.length, 2);
    assert.equal(revised.status, 'payoff');
    assert.equal(revised.payoffChapterId, 'c11');
    assert.equal(getForeshadowing('f1')?.narrativeCore?.plan.revealConstraint, '只揭示纹章来源');
    createForeshadowing({ id: 'f2', novelId: 'n1', title: '旧字段', description: '', status: 'payoff', relatedCharacterIds: [], plantedChapterId: 'old-plant', payoffChapterId: 'old-payoff', createdAt: 1, updatedAt: 1 });
    const cleared = await saveNarrativePromiseCore({
      novelId: 'n1', foreshadowingId: 'f2', databaseGeneration: getDatabaseGeneration(), expectedVersion: 0, plan,
    });
    assert.equal(cleared.status, 'planted');
    assert.equal(cleared.plantedChapterId, null);
    assert.equal(cleared.payoffChapterId, null);
    await assert.rejects(() => saveNarrativePromiseCore({ novelId: 'n1', foreshadowingId: 'f1', databaseGeneration: getDatabaseGeneration(), expectedVersion: 1, plan }), /VERSION_STALE/);
    await assert.rejects(() => saveNarrativePromiseCore({ novelId: 'other', foreshadowingId: 'f1', databaseGeneration: getDatabaseGeneration(), expectedVersion: 2, plan }), /NOT_FOUND/);
    const staleGeneration = getDatabaseGeneration();
    advanceDatabaseGeneration();
    await assert.rejects(() => saveNarrativePromiseCore({ novelId: 'n1', foreshadowingId: 'f1', databaseGeneration: staleGeneration, expectedVersion: 2, plan }), /GENERATION_STALE/);
  } finally {
    closeDb();
  }
});

test('writer context includes all relevant open promise actions and their reveal constraints', () => {
  const due = { id: 'due', novelId: 'n1', title: '戒指', description: '暗示戒指', status: 'planted' as const, relatedCharacterIds: [], narrativeCore: { schemaVersion: 1 as const, plan, evidence: [] }, createdAt: 1, updatedAt: 1 };
  const future = { ...due, id: 'future', title: '远期秘密', narrativeCore: { ...due.narrativeCore, plan: { ...plan, plannedPlantRange: undefined, plannedHintRanges: [{ from: 20, to: 21 }], plannedPayoffRange: { from: 30, to: 31 } } } };
  const paid = { ...due, id: 'paid', title: '已兑现', status: 'payoff' as const, narrativeCore: { ...due.narrativeCore, evidence: [{ chapterId: 'c2', action: 'payoff' as const, quote: '真相', confirmedAt: 2 }] } };
  const overdue = { ...due, id: 'overdue', title: '旧信', narrativeCore: { ...due.narrativeCore, plan: {
    ...plan, plannedPlantRange: { from: 1, to: 1 }, plannedHintRanges: [{ from: 2, to: 2 }], plannedPayoffRange: { from: 3, to: 3 },
  } } };
  const ledger = buildStoryStateLedger({
    novel: { id: 'n1', title: 'N', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 },
    chapters: [], foreshadowings: [due, future, paid, overdue], currentChapterOrder: 3,
  });
  assert.deepEqual(ledger.openForeshadowings.map((item) => [item.id, item.plannedAction]), [
    ['due', 'plant'], ['due', 'hint'], ['overdue', 'plant'], ['overdue', 'hint'], ['overdue', 'payoff'],
  ]);
  const writer = buildProductionWriterContext(ledger);
  assert.match(writer, /本章hint/);
  assert.match(writer, /本章plant/);
  assert.match(writer, /本章payoff/);
  assert.match(writer, /不能揭示父亲身份/);
  assert.doesNotMatch(writer, /远期秘密|已兑现/);
});
