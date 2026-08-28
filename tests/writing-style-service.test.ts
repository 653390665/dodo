import test from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, getDb, getDatabaseGeneration } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { createChapter } from '../server/lib/db/chapters.js';
import { requireWritingStyleConfirmation, resolveWritingStyleRequest, WritingStyleRequestError } from '../server/helpers/writing-style-service.js';
import type { ContinuationPack, Novel, Skill } from '../shared/types.js';

function skill(id: string, version = 1): Skill {
  return {
    id, name: id, description: `${id} description`, style: `${id} style`, pacing: `${id} pacing`,
    stabilityScore: 90, evaluationFeedback: '', version, createdAt: 1,
  } as Skill;
}

function savedCardSkill(id: string, cardType: Skill['deconstructionCardType'], overrides: Partial<Skill> = {}): Skill {
  return {
    ...skill(id),
    name: 'SAVED_CARD_SECRET_NAME',
    description: 'SAVED_CARD_SECRET_DESCRIPTION',
    evaluationFeedback: 'SAVED_CARD_SECRET_FEEDBACK',
    fewShots: ['SAVED_CARD_SECRET_FEWSHOT'],
    sourceBadge: 'book-extracted',
    sourceType: 'book-extracted',
    isRuntimeReady: true,
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    deconstructionCardType: cardType,
    executionScore: 85,
    style: 'saved style rule',
    pacing: 'saved pacing rule',
    worldBuilding: 'saved world rule',
    ...overrides,
  } as Skill;
}

function novel(): Novel {
  return {
    id: 'novel-1', title: 'Novel', authorId: 'author', summary: '', status: 'ongoing',
    mountedSkillIds: ['planner', 'writer', 'critic'],
    mountedSkillLoadout: [
      { slot: 0, skillId: 'planner', weight: 1, lockedDimensions: [] },
      { slot: 1, skillId: 'writer', weight: 1, lockedDimensions: [] },
      { slot: 2, skillId: 'critic', weight: 1, lockedDimensions: [] },
    ],
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      skillLoadoutSchemaVersion: 2, contract: { styleAnchors: ['克制', '短句'] },
    },
    createdAt: 1, updatedAt: 1,
  };
}

function continuationPack(): ContinuationPack {
  return {
    id: 'pack-1', novelId: 'novel-1', title: 'Pack', status: 'approved',
    sourceDocuments: [], canonFacts: [], characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: {
      pov: '第三人称', tense: '过去时', pacing: '紧凑', dialogueDensity: '中等',
      proseTraits: ['克制'], avoidTraits: ['解释过度'], sampleEvidence: '',
    },
    contradictions: [], continuationTask: '', createdAt: 1, updatedAt: 1,
  };
}

test('server style resolver trusts slot 1 and ignores planner/critic changes', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createNovel(novel());
    const first = resolveWritingStyleRequest('novel-1');
    assert.equal(first.resolution.sources.find(source => source.kind === 'writer-skill')?.id, 'writer');
    db.updateSkill('planner', { version: 2, style: 'changed planner' });
    db.updateSkill('critic', { version: 2, style: 'changed critic' });
    assert.equal(resolveWritingStyleRequest('novel-1').resolution.fingerprint, first.resolution.fingerprint);
    db.updateSkill('writer', { version: 2, style: 'changed writer' });
    assert.notEqual(resolveWritingStyleRequest('novel-1').resolution.fingerprint, first.resolution.fingerprint);
  } finally { closeDb(); }
});

test('confirmation requires the provided, stored, and current fingerprints to match', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createNovel(novel());
    const initial = resolveWritingStyleRequest('novel-1');
    assert.throws(() => requireWritingStyleConfirmation(initial), (error) => error instanceof WritingStyleRequestError && error.code === 'STYLE_CONFIRMATION_REQUIRED');
    db.updateNovel('novel-1', { projectPreferenceProfile: {
      ...initial.novel.projectPreferenceProfile!,
      writingStyleConfirmation: { mode: initial.resolution.mode, fingerprint: initial.resolution.fingerprint, confirmedAt: 1 },
    } });
    const confirmed = resolveWritingStyleRequest('novel-1');
    assert.doesNotThrow(() => requireWritingStyleConfirmation(confirmed, confirmed.resolution.fingerprint));
    db.updateSkill('writer', { version: 2 });
    const stale = resolveWritingStyleRequest('novel-1');
    assert.throws(() => requireWritingStyleConfirmation(stale, confirmed.resolution.fingerprint), (error) => error instanceof WritingStyleRequestError && error.code === 'STYLE_CONFIRMATION_REQUIRED');
  } finally { closeDb(); }
});

test('v2 empty loadout never revives legacy mounted skill ids', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('writer'));
    const empty = novel();
    empty.mountedSkillLoadout = [];
    empty.mountedSkillIds = ['writer'];
    db.createNovel(empty);
    const resolved = resolveWritingStyleRequest('novel-1');
    assert.equal(resolved.stageSkills.writer.length, 0);
    assert.equal(resolved.resolution.mode, 'default');
  } finally { closeDb(); }
});

test('session card limit applies before duplicate ids are collapsed', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createNovel(novel());
    assert.throws(
      () => resolveWritingStyleRequest('novel-1', { sessionCardIds: Array(7).fill('duplicate-card') }),
      (error) => error instanceof WritingStyleRequestError && error.code === 'TOO_MANY_SESSION_CARDS',
    );
  } finally { closeDb(); }
});

test('session card failures identify the offending card without exposing content', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic')); db.createNovel(novel());
    assert.throws(
      () => resolveWritingStyleRequest('novel-1', { sessionCardIds: ['missing-card'] }),
      (error) => error instanceof WritingStyleRequestError
        && error.code === 'UNKNOWN_SESSION_CARD'
        && error.sessionCardId === 'missing-card'
        && !('prompt' in error),
    );
  } finally { closeDb(); }
});

test('session card ids are trimmed after the raw six-card limit check', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic')); db.createNovel(novel());
    const resolved = resolveWritingStyleRequest('novel-1', { sessionCardIds: ['  deconstruct-card-pacing  '] });
    assert.match(resolved.writerPrompt, /节奏拆书卡/);
    assert.throws(() => resolveWritingStyleRequest('novel-1', { sessionCardIds: ['   '] }), (error) => error instanceof WritingStyleRequestError && error.code === 'UNKNOWN_SESSION_CARD');
  } finally { closeDb(); }
});

test('active catalog skill-card ids can run as chapter session cards without a saved clone', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic')); db.createNovel(novel());
    const resolved = resolveWritingStyleRequest('novel-1', { sessionCardIds: ['style-ancient-elegance'] });
    assert.equal(resolved.executionSnapshot.overlays[0]?.id, 'style-ancient-elegance');
    assert.equal(resolved.executionSnapshot.overlays[0]?.source, 'plaza');
    assert.match(resolved.writerPrompt, /古典雅韵/);
  } finally { closeDb(); }
});

test('writer prompt freezes the documented source priority and blend responsibilities', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createNovel(novel());
    db.createContinuationPack(continuationPack());

    const writerFirst = resolveWritingStyleRequest('novel-1', { mode: 'writer-skill', continuationPackId: 'pack-1' });
    const packFirst = resolveWritingStyleRequest('novel-1', { mode: 'continuation-pack', continuationPackId: 'pack-1' });
    const blend = resolveWritingStyleRequest('novel-1', { mode: 'blend', continuationPackId: 'pack-1' });

    assert.deepEqual(blend.resolution.allowedModes, ['writer-skill', 'continuation-pack', 'blend']);
    assert.match(writerFirst.writerPrompt, /项目基调 > 主笔能力卡 > 资料包/);
    assert.match(packFirst.writerPrompt, /项目基调 > 资料包 > 主笔能力卡/);
    assert.match(blend.writerPrompt, /资料包负责 POV、时态和避免项/);
    assert.match(blend.writerPrompt, /主笔能力卡负责句法、词汇和意象/);
    assert.match(blend.writerPrompt, /节奏卡作为共同覆盖层/);
  } finally { closeDb(); }
});

test('critic prompt does not receive Writer-only rules while Writer prompt remains unchanged', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner'));
    db.createSkill(skill('writer', 2));
    db.updateSkill('writer', { style: 'WRITER_ONLY_SECRET_RULE', pacing: 'writer pacing' });
    db.createSkill(skill('critic'));
    db.createNovel(novel());

    const resolved = resolveWritingStyleRequest('novel-1');

    assert.match(resolved.writerPrompt, /WRITER_ONLY_SECRET_RULE/);
    assert.doesNotMatch(resolved.criticPrompt, /WRITER_ONLY_SECRET_RULE/);
    assert.doesNotMatch(resolved.executionSnapshot.stagePrompts.critic, /WRITER_ONLY_SECRET_RULE/);
    assert.match(resolved.criticPrompt, /写法契约标准/);
    assert.match(resolved.criticPrompt, /Critic Slot 2 规则/);
  } finally { closeDb(); }
});

test('saved style-card roundtrips into writer overlay with a safe rule projection', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createSkill(savedCardSkill('saved-style', 'style-card'));
    db.createNovel(novel());
    const resolved = resolveWritingStyleRequest('novel-1', { sessionCardIds: ['saved-style'] });
    assert.match(resolved.writerPrompt, /saved style rule/);
    assert.doesNotMatch(resolved.writerPrompt, /SAVED_CARD_SECRET_NAME|SAVED_CARD_SECRET_DESCRIPTION|SAVED_CARD_SECRET_FEWSHOT/);
  } finally { closeDb(); }
});

test('saved worldview-card roundtrips into planner overlay', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createSkill(savedCardSkill('saved-world', 'worldview-card'));
    db.createNovel(novel());
    const resolved = resolveWritingStyleRequest('novel-1', { sessionCardIds: ['saved-world'] });
    assert.match(resolved.plannerPrompt, /saved world rule/);
    assert.doesNotMatch(resolved.plannerPrompt, /SAVED_CARD_SECRET_NAME|SAVED_CARD_SECRET_DESCRIPTION|SAVED_CARD_SECRET_FEWSHOT/);
  } finally { closeDb(); }
});

test('saved session cards are rejected at the earliest applicable governance boundary', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic')); db.createNovel(novel());
    const runtimeCases: Array<[string, Partial<Skill>, string]> = [
      ['low-score', { executionScore: 59 }, 'SESSION_CARD_NOT_RUNTIME_READY'],
      ['wrong-source', { sourceBadge: 'user-uploaded' }, 'SESSION_CARD_NOT_RUNTIME_READY'],
    ];
    for (const [id, overrides, code] of runtimeCases) {
      db.createSkill(savedCardSkill(id, 'style-card', overrides));
      assert.throws(() => resolveWritingStyleRequest('novel-1', { sessionCardIds: [id] }), (error) => error instanceof WritingStyleRequestError && error.code === code);
    }
    const persistenceCases: Array<[string, Partial<Skill>, string]> = [
      ['missing-type', { deconstructionCardType: undefined }, 'SKILL_CARD_TYPE_INVALID'],
      ['invalid-type', { deconstructionCardType: 'not-a-card' as Skill['deconstructionCardType'] }, 'SKILL_CARD_TYPE_INVALID'],
      ['missing-rules', { style: '', pacing: '', vocabulary: [], sentenceStructure: '', imagery: [], bannedWords: [], fewShots: [], characterTraits: '', worldBuilding: '', foreshadowing: '', plotPattern: '', corePatterns: [], bannedElements: [] }, 'SKILL_CARD_RULES_MISSING'],
    ];
    for (const [id, overrides, code] of persistenceCases) {
      assert.throws(() => db.createSkill(savedCardSkill(id, 'style-card', overrides)), new RegExp(code));
    }
  } finally { closeDb(); }
});

test('catalog card wins over a saved skill with the same id and does not leak saved data', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createSkill(skill('legacy-catalog-collision'));
    getDb().prepare('UPDATE skills SET id = ? WHERE id = ?').run('deconstruct-card-pacing', 'legacy-catalog-collision');
    db.createNovel(novel());
    const resolved = resolveWritingStyleRequest('novel-1', { sessionCardIds: ['deconstruct-card-pacing'] });
    assert.doesNotMatch(resolved.writerPrompt, /SAVED_SECRET_STYLE|SAVED_CARD_SECRET_NAME/);
    assert.match(resolved.writerPrompt, /节奏拆书卡/);
  } finally { closeDb(); }
});

test('paid saved session cards require a paid commercial mode when monetization is enabled', () => {
  const previous = process.env.INKFLOW_ENABLE_MONETIZATION;
  process.env.INKFLOW_ENABLE_MONETIZATION = 'true';
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createSkill(savedCardSkill('paid-card', 'style-card', { accessTier: 'paid', sourceType: 'licensed' }));
    db.createNovel(novel());
    assert.throws(() => resolveWritingStyleRequest('novel-1', { sessionCardIds: ['paid-card'] }), (error) => error instanceof WritingStyleRequestError && error.status === 403 && error.code === 'SESSION_CARD_FORBIDDEN');
  } finally {
    closeDb();
    if (previous === undefined) delete process.env.INKFLOW_ENABLE_MONETIZATION;
    else process.env.INKFLOW_ENABLE_MONETIZATION = previous;
  }
});

test('methodChain-only saved card projects only safe structured fields', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createSkill(savedCardSkill('method-only', 'style-card', {
      style: '', pacing: '', vocabulary: [], sentenceStructure: '', imagery: [], bannedWords: [],
      characterTraits: '', worldBuilding: '', foreshadowing: '', plotPattern: '', corePatterns: [], bannedElements: [],
      methodChain: {
        summary: 'safe summary',
        items: [{ question: 'SECRET_QUESTION', answer: 'SECRET_ANSWER', formalization: 'safe formula', steps: ['safe step'], boundary: 'safe boundary' }],
      },
    }));
    db.createNovel(novel());
    const resolved = resolveWritingStyleRequest('novel-1', { sessionCardIds: ['method-only'] });
    assert.match(resolved.writerPrompt, /safe summary|safe formula|safe step|safe boundary/);
    assert.doesNotMatch(resolved.writerPrompt, /SECRET_QUESTION|SECRET_ANSWER|SAVED_CARD_SECRET_FEEDBACK|SAVED_CARD_SECRET_FEWSHOT|SAVED_CARD_SECRET_NAME|SAVED_CARD_SECRET_DESCRIPTION/);
  } finally { closeDb(); }
});

test('saved card types route to their canonical execution stages', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('planner')); db.createSkill(skill('writer')); db.createSkill(skill('critic'));
    db.createNovel(novel());
    const expected: Record<string, string[]> = {
      'worldview-card': ['planner'], 'character-card': ['planner'], 'hook-card': ['planner'], 'conflict-card': ['planner'],
      'style-card': ['writer'], 'pacing-card': ['planner', 'writer'], 'platform-card': ['planner', 'writer'],
    };
    for (const [cardType, stages] of Object.entries(expected)) {
      const id = `route-${cardType}`;
      db.createSkill(savedCardSkill(id, cardType as Skill['deconstructionCardType']));
      const overlays = resolveWritingStyleRequest('novel-1', { sessionCardIds: [id] }).executionSnapshot.overlays;
      assert.deepEqual(overlays[0]?.stages, stages, cardType);
    }
  } finally { closeDb(); }
});

test('v3 empty skill deck does not revive legacy role slots', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(skill('legacy-writer'));
    const current = novel();
    current.mountedSkillIds = ['legacy-writer'];
    current.mountedSkillLoadout = [{ slot: 1, skillId: 'legacy-writer', weight: 1, lockedDimensions: [] }];
    current.projectPreferenceProfile = {
      ...current.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    };
    db.createNovel(current);
    const resolved = resolveWritingStyleRequest(current.id);
    assert.equal(resolved.stageSkills.writer.length, 0);
    assert.equal(resolved.resolution.mode, 'default');
    assert.doesNotMatch(resolved.writerPrompt, /legacy-writer style/);
  } finally { closeDb(); }
});

test('v3 project deck builds one main card, two supports, overlays, and a skill-deck mode', () => {
  closeDb(); initDb(':memory:');
  try {
    for (const [id, type] of [['main-card', 'style-card'], ['support-world', 'worldview-card'], ['support-pacing', 'pacing-card']] as const) {
      db.createSkill(savedCardSkill(id, type));
    }
    db.createNovel({
      ...novel(),
      projectPreferenceProfile: {
        ...novel().projectPreferenceProfile!, capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          projectSkillDeck: { mainCardId: 'main-card', supportCardIds: ['support-world', 'support-pacing'], updatedAt: 1 },
          favoriteTechniqueIds: [],
        },
      },
    });
    const resolved = resolveWritingStyleRequest('novel-1', { sessionCardIds: ['deconstruct-card-pacing'] });
    assert.equal(resolved.resolution.mode, 'skill-deck');
    assert.equal(resolved.resolution.sources.some((source) => source.kind === 'skill-deck'), true);
    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.id, 'main-card');
    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.version, 1);
    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.source, 'book-extracted');
    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.position, 'project-main');
    assert.deepEqual(resolved.executionSnapshot.skillStack.projectSupportCards.map((card) => card.id), ['support-world', 'support-pacing']);
    assert.deepEqual(resolved.executionSnapshot.skillStack.chapterCards.map((card) => card.id), ['deconstruct-card-pacing']);
    assert.equal(resolved.executionSnapshot.skillStack.effectiveCards.length, 4);
    assert.ok(Object.isFrozen(resolved.executionSnapshot.skillStack));
    assert.match(resolved.writerPrompt, /saved style rule|主卡/);
    assert.match(resolved.plannerPrompt, /saved world rule/);
  } finally { closeDb(); }
});

test('v3 planner-only project deck is visible in writing style sources', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(savedCardSkill('world-main', 'worldview-card'));
    const current = novel();
    current.projectPreferenceProfile = {
      ...current.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { mainCardId: 'world-main', supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    };
    db.createNovel(current);
    const resolved = resolveWritingStyleRequest(current.id);
    const source = resolved.resolution.sources.find((entry) => entry.kind === 'skill-deck');
    assert.equal(resolved.resolution.mode, 'skill-deck');
    assert.match(source?.label || '', /作品卡组：世界观拆书卡/);
    assert.match(resolved.resolution.summary, /作品卡组：世界观拆书卡/);
    assert.match(resolved.executionSnapshot.stagePrompts.planner, /saved world rule/);
  } finally { closeDb(); }
});

test('v3 project deck accepts a governed catalog clone without disguising it as a book-extracted card', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(savedCardSkill('catalog-clone', 'style-card', {
      version: 3,
      parentSkillId: 'style-ancient-elegance',
      sourceBadge: 'manual',
      sourceType: 'plaza',
    }));
    const current = novel();
    current.projectPreferenceProfile = {
      ...current.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { mainCardId: 'catalog-clone', supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    };
    db.createNovel(current);
    const resolved = resolveWritingStyleRequest(current.id);
    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.id, 'catalog-clone');
    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.source, 'plaza');
  } finally { closeDb(); }
});

test('v3 project deck accepts active catalog card ids for legacy profile compatibility', () => {
  closeDb(); initDb(':memory:');
  try {
    const current = novel();
    current.projectPreferenceProfile = {
      ...current.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { mainCardId: 'style-ancient-elegance', supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    };
    db.createNovel(current);

    const resolved = resolveWritingStyleRequest(current.id);

    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.id, 'style-ancient-elegance');
    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.source, 'plaza');
    assert.match(resolved.executionSnapshot.stagePrompts.writer, /古典雅韵/);
  } finally { closeDb(); }
});

test('v3 project deck keeps a saved project card clone runnable without needing a catalog row', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill(savedCardSkill('saved-project-card', 'style-card', {
      sourceBadge: 'manual',
      sourceType: 'plaza',
      parentSkillId: 'style-ancient-elegance',
    }));
    const current = novel();
    current.projectPreferenceProfile = {
      ...current.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { mainCardId: 'saved-project-card', supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    };
    db.createNovel(current);

    const resolved = resolveWritingStyleRequest(current.id);

    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.id, 'saved-project-card');
    assert.equal(resolved.executionSnapshot.skillStack.mainCard?.source, 'plaza');
    assert.match(resolved.executionSnapshot.stagePrompts.writer, /saved style rule/);
  } finally { closeDb(); }
});

test('v3 configured guardrails are appended to the execution snapshot', () => {
  closeDb(); initDb(':memory:');
  try {
    const current = novel();
    current.projectPreferenceProfile = {
      ...current.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        guardrailIds: ['square-13'],
      },
    };
    db.createNovel(current);

    const resolved = resolveWritingStyleRequest(current.id);

    assert.equal(resolved.executionSnapshot.guardrails.some((guardrail) => guardrail.id === 'square-13'), true);
    assert.equal(resolved.executionSnapshot.capabilityRefs?.includes('square-13'), true);
    assert.match(resolved.executionSnapshot.stagePrompts.writer, /lwl-文本润色/);
    assert.equal(resolved.executionSnapshot.guardrails.filter((guardrail) => guardrail.id === 'core-slop-shield').length, 1);
  } finally { closeDb(); }
});

test('v3 project cards plus chapter overlays reject an effective stack over six', () => {
  closeDb(); initDb(':memory:');
  try {
    const cards = ['main-card', 'support-one', 'support-two', 'overlay-one', 'overlay-two', 'overlay-three', 'overlay-four'];
    for (const id of cards) db.createSkill(savedCardSkill(id, 'style-card'));
    const base = novel();
    db.createNovel({
      ...base,
      projectPreferenceProfile: {
        ...base.projectPreferenceProfile!, capabilityModelVersion: 3,
        capabilityProfile: {
          version: 3,
          projectSkillDeck: { mainCardId: 'main-card', supportCardIds: ['support-one', 'support-two'], updatedAt: 1 },
          favoriteTechniqueIds: [],
        },
      },
    });
    assert.throws(
      () => resolveWritingStyleRequest('novel-1', { sessionCardIds: ['overlay-one', 'overlay-two', 'overlay-three', 'overlay-four'] }),
      (error) => error instanceof WritingStyleRequestError && error.code === 'TOO_MANY_EFFECTIVE_SKILL_CARDS',
    );
  } finally { closeDb(); }
});

test('project favorite techniques enter the frozen snapshot and chapter techniques are added', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel();
    base.projectPreferenceProfile = {
      ...base.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: ['opening-gold-three'],
        projectTechniqueIds: ['opening-gold-three'],
      },
    };
    db.createNovel(base);
    createChapter({ id: 'chapter-1', novelId: base.id, title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1,
      workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: getDatabaseGeneration(), techniqueIds: [], overlayCardIds: [], updatedAt: 1 } } });
    const withoutChapterTechnique = resolveWritingStyleRequest(base.id, { chapterId: 'chapter-1' });
    assert.equal(withoutChapterTechnique.executionSnapshot.techniques.planner[0]?.id, 'opening-gold-three');
    assert.match(withoutChapterTechnique.executionSnapshot.stagePrompts.planner, /黄金三章|三章/);
    db.updateChapter('chapter-1', { workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: getDatabaseGeneration(), techniqueIds: ['prose-action-booster'], overlayCardIds: [], techniqueVersions: { 'prose-action-booster': 3 }, updatedAt: 2 } } });
    const withChapterTechnique = resolveWritingStyleRequest(base.id, { chapterId: 'chapter-1' });
    assert.equal(withChapterTechnique.executionSnapshot.techniques.planner[0]?.id, 'opening-gold-three');
    assert.equal(withChapterTechnique.executionSnapshot.techniques.writer[0]?.id, 'prose-action-booster');
    assert.match(withChapterTechnique.executionSnapshot.stagePrompts.writer, /动作|场景/);
  } finally { closeDb(); }
});

test('ignores favorites for execution when project techniques are explicitly empty', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel();
    base.projectPreferenceProfile = {
      ...base.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: ['opening-gold-three'],
        projectTechniqueIds: [],
      },
    };
    db.createNovel(base);

    const resolved = resolveWritingStyleRequest(base.id);

    assert.deepEqual(resolved.executionSnapshot.techniques, { planner: [], writer: [], critic: [] });
    assert.doesNotMatch(resolved.writerPrompt, /黄金三章|三章/);
  } finally { closeDb(); }
});

test('project favorite techniques imported from plaza resolve through capability membership', () => {
  closeDb(); initDb(':memory:');
  try {
    db.createSkill({
      ...skill('persisted-mouth-flavor', 3),
      parentSkillId: 'prose-mouth-flavor',
      sourceType: 'plaza',
      sourceBadge: 'manual',
    });
    const base = novel();
    base.projectPreferenceProfile = {
      ...base.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: ['persisted-mouth-flavor'],
        capabilityMemberships: [{
          sourceId: 'prose-mouth-flavor',
          sourceVersion: '3',
          sourceType: 'plaza',
          persistedSkillId: 'persisted-mouth-flavor',
        }],
      },
    };
    db.createNovel(base);

    const resolved = resolveWritingStyleRequest(base.id);

    assert.equal(resolved.executionSnapshot.techniques.writer[0]?.id, 'prose-mouth-flavor');
    assert.match(resolved.executionSnapshot.stagePrompts.writer, /口语化|网文节奏/);
  } finally { closeDb(); }
});

test('v3 flow reads activeFlowId and restores persisted chapter overlays', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel();
    base.projectPreferenceProfile = {
      ...base.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        activeFlowId: 'xiaofeiji-novel-flow',
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    };
    db.createNovel(base);
    createChapter({ id: 'chapter-overlay', novelId: base.id, title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1,
      workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: getDatabaseGeneration(), techniqueIds: [], overlayCardIds: [], updatedAt: 1 } } });
    const withoutOverlay = resolveWritingStyleRequest(base.id, { chapterId: 'chapter-overlay' });
    assert.equal(withoutOverlay.executionSnapshot.skillStack.chapterCards.length, 0);

    db.updateChapter('chapter-overlay', { workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: getDatabaseGeneration(), techniqueIds: [], overlayCardIds: ['deconstruct-card-pacing'], overlayVersions: { 'deconstruct-card-pacing': 'catalog' }, updatedAt: 2 } } });
    const contract = resolveWritingStyleRequest(base.id, { chapterId: 'chapter-overlay' });
    assert.equal(contract.executionSnapshot.flowStep?.activeFlowId, 'xiaofeiji-novel-flow');
    assert.equal(contract.executionSnapshot.skillStack.chapterCards[0]?.id, 'deconstruct-card-pacing');
    assert.notEqual(contract.resolution.fingerprint, withoutOverlay.resolution.fingerprint);
    assert.match(contract.writerPrompt, /节奏拆书卡/);
    assert.match(contract.executionSnapshot.stagePrompts.writer, /节奏拆书卡/);
    assert.equal(contract.executionSnapshot.capabilityRefs?.includes('deconstruct-card-pacing'), true);
  } finally { closeDb(); }
});

test('project techniques inherit across chapters while chapter overlays stay isolated and deduplicated', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel();
    base.projectPreferenceProfile = {
      ...base.projectPreferenceProfile!, capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        projectTechniqueIds: ['prose-action-booster'],
      },
    };
    db.createNovel(base);
    const generation = getDatabaseGeneration();
    createChapter({ id: 'chapter-scope-1', novelId: base.id, title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1,
      workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: generation, techniqueIds: [], overlayCardIds: ['deconstruct-card-pacing'], overlayVersions: { 'deconstruct-card-pacing': 'catalog' }, updatedAt: 1 } } });
    createChapter({ id: 'chapter-scope-2', novelId: base.id, title: '第二章', content: '', order: 2, wordCount: 0, createdAt: 1, updatedAt: 1,
      workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: generation, techniqueIds: [], overlayCardIds: [], updatedAt: 1 } } });

    const first = resolveWritingStyleRequest(base.id, { chapterId: 'chapter-scope-1', databaseGeneration: generation });
    const second = resolveWritingStyleRequest(base.id, {
      chapterId: 'chapter-scope-2',
      databaseGeneration: generation,
      sessionCardIds: ['deconstruct-card-pacing', 'deconstruct-card-pacing'],
    });

    assert.deepEqual(first.executionSnapshot.techniques.writer.map((item) => item.id), ['prose-action-booster']);
    assert.deepEqual(second.executionSnapshot.techniques.writer.map((item) => item.id), ['prose-action-booster']);
    assert.deepEqual(first.executionSnapshot.skillStack.chapterCards.map((card) => card.id), ['deconstruct-card-pacing']);
    assert.deepEqual(second.executionSnapshot.skillStack.chapterCards.map((card) => card.id), ['deconstruct-card-pacing']);
    assert.equal(second.executionSnapshot.skillStack.chapterCards.length, 1, 'repeated one-shot card ids must be idempotent');

    const secondWithoutOneShot = resolveWritingStyleRequest(base.id, { chapterId: 'chapter-scope-2', databaseGeneration: generation });
    assert.deepEqual(secondWithoutOneShot.executionSnapshot.skillStack.chapterCards, [], 'chapter one overlay must not leak into chapter two');
  } finally { closeDb(); }
});

test('chapter capability metadata enforces scope and generation before prompt construction', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel();
    db.createNovel(base);
    db.createNovel({ ...base, id: 'novel-2' });
    createChapter({ id: 'scoped-chapter', novelId: base.id, title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1,
      workflowMeta: { version: 1, capabilityState: { novelId: 'novel-2', techniqueIds: [], overlayCardIds: [], updatedAt: 1 } } });
    assert.throws(() => resolveWritingStyleRequest(base.id, { chapterId: 'scoped-chapter' }), (error) => error instanceof WritingStyleRequestError && error.code === 'CHAPTER_SCOPE_MISMATCH');
    db.updateChapter('scoped-chapter', { workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: getDatabaseGeneration() + 1, techniqueIds: [], overlayCardIds: [], updatedAt: 2 } } });
    assert.throws(() => resolveWritingStyleRequest(base.id, { chapterId: 'scoped-chapter' }), (error) => error instanceof WritingStyleRequestError && error.code === 'DATABASE_GENERATION_STALE');
  } finally { closeDb(); }
});

test('chapter capability metadata rejects stale technique and overlay versions', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel(); db.createNovel(base);
    createChapter({ id: 'versioned-chapter', novelId: base.id, title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1,
      workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: getDatabaseGeneration(), techniqueIds: ['prose-action-booster'], overlayCardIds: [], techniqueVersions: { 'prose-action-booster': '2' }, updatedAt: 1 } } });
    assert.throws(() => resolveWritingStyleRequest(base.id, { chapterId: 'versioned-chapter' }), (error) => error instanceof WritingStyleRequestError && error.code === 'CAPABILITY_VERSION_STALE');
    db.updateChapter('versioned-chapter', { workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: getDatabaseGeneration(), techniqueIds: [], overlayCardIds: ['deconstruct-card-pacing'], overlayVersions: { 'deconstruct-card-pacing': '2' }, updatedAt: 2 } } });
    assert.throws(() => resolveWritingStyleRequest(base.id, { chapterId: 'versioned-chapter' }), (error) => error instanceof WritingStyleRequestError && error.code === 'CAPABILITY_VERSION_STALE');
  } finally { closeDb(); }
});

test('chapter capability metadata rejects non-runtime overlays and stale legacy state', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel(); db.createNovel(base);
    createChapter({ id: 'legacy-chapter', novelId: base.id, title: '第一章', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1,
      workflowMeta: { version: 1, capabilityState: { techniqueIds: [], overlayCardIds: [], updatedAt: 1 } } });
    assert.throws(() => resolveWritingStyleRequest(base.id, { chapterId: 'legacy-chapter' }), (error) => error instanceof WritingStyleRequestError && error.code === 'DATABASE_GENERATION_STALE');
    db.updateChapter('legacy-chapter', { workflowMeta: { version: 1, capabilityState: { novelId: base.id, databaseGeneration: getDatabaseGeneration(), techniqueIds: [], overlayCardIds: ['audit-logical-sanity'], updatedAt: 2 } } });
    assert.throws(() => resolveWritingStyleRequest(base.id, { chapterId: 'legacy-chapter' }), (error) => error instanceof WritingStyleRequestError && error.code === 'CAPABILITY_KIND_INVALID');
  } finally { closeDb(); }
});

test('resolved execution snapshot is frozen at the requested generation', () => {
  closeDb(); initDb(':memory:');
  try {
    const base = novel(); db.createNovel(base);
    const resolved = resolveWritingStyleRequest(base.id, { databaseGeneration: getDatabaseGeneration() });
    assert.equal(Object.isFrozen(resolved.executionSnapshot), true);
    assert.equal(Object.isFrozen(resolved.executionSnapshot.techniques), true);
  } finally { closeDb(); }
});
