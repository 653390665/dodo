import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImportedNovelDraft,
  canApproveContinuationImportPack,
  resolveContinuationImportTargetMode,
} from '../src/lib/continuation-import-flow';
import type { ContinuationPack, Novel } from '../shared/types';

function buildNovel(id: string): Novel {
  return {
    id,
    title: `Novel ${id}`,
    authorId: 'author-1',
    summary: 'summary',
    status: 'ongoing',
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildPack(overrides: Partial<ContinuationPack> = {}): ContinuationPack {
  return {
    id: 'pack-1',
    novelId: 'novel-1',
    title: '测试资料包',
    status: 'draft',
    sourceDocuments: [],
    canonFacts: [],
    characterStates: [],
    plotState: {
      currentTimeline: '第一卷',
      latestScene: '城门夜雨',
      unresolvedHooks: [],
      immediateConflict: '追兵逼近',
      nextLikelyMove: '潜入内城',
    },
    styleProfile: {
      pov: '第三人称',
      tense: '过去时',
      pacing: '紧推进',
      dialogueDensity: '中等',
      proseTraits: [],
      avoidTraits: [],
      sampleEvidence: '',
    },
    contradictions: [],
    continuationTask: '继续推进剧情',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test('resolveContinuationImportTargetMode defaults to new when no novels exist', () => {
  assert.equal(resolveContinuationImportTargetMode([]), 'new');
});

test('resolveContinuationImportTargetMode defaults to existing when novels exist', () => {
  assert.equal(resolveContinuationImportTargetMode([buildNovel('novel-1')]), 'existing');
});

test('buildImportedNovelDraft removes trailing pack suffix from title', () => {
  assert.deepEqual(buildImportedNovelDraft('星火计划资料包'), {
    title: '星火计划',
    summary: '由资料包「星火计划」导入创建，用于资料驱动续写。',
  });
});

test('buildImportedNovelDraft falls back when title is empty', () => {
  assert.deepEqual(buildImportedNovelDraft(''), {
    title: '导入续写作品',
    summary: '由资料包导入创建，用于资料驱动续写。',
  });
});

test('canApproveContinuationImportPack allows any canon facts without high contradictions', () => {
  const pack = buildPack({
    canonFacts: [
      { id: 'fact-1', priority: 'soft', category: 'world', text: '设定', evidence: '原文' },
    ],
  });

  assert.equal(canApproveContinuationImportPack(pack), true);
});

test('canApproveContinuationImportPack rejects packs with high contradictions', () => {
  const pack = buildPack({
    canonFacts: [
      { id: 'fact-1', priority: 'hard', category: 'world', text: '设定', evidence: '原文' },
    ],
    contradictions: [
      {
        id: 'contradiction-1',
        severity: 'high',
        summary: '矛盾',
        conflictingEvidence: ['A', 'B'],
        suggestedResolution: '处理',
      },
    ],
  });

  assert.equal(canApproveContinuationImportPack(pack), false);
});
