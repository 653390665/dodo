import { describe, expect, it } from 'vitest';
import type { ProjectPreferenceProfile, Skill } from '../../shared/types';
import {
  buildProjectSkillDeckPreview,
  buildProjectSkillDeckUpdatePayload,
  updateProjectSkillDeck,
} from '../components/book-factory/useBookFactory';
import { buildFusionDraft, buildResolvedFusionDraft } from '../lib/skill-fusion';

function skill(id: string, overrides: Partial<Skill> = {}): Skill {
  return {
    id,
    name: id,
    description: '',
    style: `${id} style`,
    pacing: `${id} pacing`,
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 2,
    createdAt: 1,
    primaryDimension: 'style',
    dimensionTags: ['style'],
    deckGroupId: 'deck-1',
    deconstructionCardType: 'style-card',
    evidenceCoverage: 'full-book-stable',
    evidenceMoments: ['opening'],
    sourceBadge: 'book-extracted',
    sourceType: 'plaza',
    ...( {
      isRuntimeReady: true,
      sanitizationStatus: 'runtime-ready',
      runtimeStatus: 'active',
    } as unknown as Partial<Skill>),
    ...overrides,
  };
}

describe('Plan 158 project skill deck', () => {
  it('requires explicit main/support selection by card id', () => {
    const cards = [skill('support-b'), skill('main'), skill('support-a')];
    const unselected = buildProjectSkillDeckPreview(cards, Date.now(), undefined);
    expect(unselected.deck.mainCardId).toBeUndefined();
    const selected = buildProjectSkillDeckPreview(cards, Date.now(), {
      mainCardId: 'main', supportCardIds: ['support-a', 'support-b'],
    });
    expect(selected.deck).toMatchObject({ mainCardId: 'main', supportCardIds: ['support-a', 'support-b'] });
  });

  it('rejects more than two explicit supports instead of truncating', () => {
    const result = buildProjectSkillDeckPreview(
      [skill('main'), skill('a'), skill('b'), skill('c')],
      Date.now(),
      { mainCardId: 'main', supportCardIds: ['a', 'b', 'c'] },
    );
    expect(result.conflicts).toContain('PROJECT_DECK_SUPPORT_LIMIT');
    expect(result.acceptedCards.map((card) => card.id)).toEqual(['main', 'a', 'b', 'c']);
    expect(result.rejectedCards).toHaveLength(0);
  });

  it('does not infer a main card from array order', () => {
    const result = buildProjectSkillDeckPreview([skill('a'), skill('b'), skill('c'), skill('d')]);
    expect(result.deck.mainCardId).toBeUndefined();
    expect(result.acceptedCards).toHaveLength(4);
    expect(result.rejectedCards).toHaveLength(0);
  });
  it('selects one main and at most two supports without stage-slot conflicts', () => {
    const result = buildProjectSkillDeckPreview([
      skill('main'),
      skill('planner-a', { deconstructionCardType: 'worldview-card', primaryDimension: 'world' }),
      skill('planner-b', { deconstructionCardType: 'hook-card', primaryDimension: 'plot' }),
      skill('extra', { deconstructionCardType: 'character-card', primaryDimension: 'character' }),
    ], Date.now(), { mainCardId: 'main', supportCardIds: ['planner-a', 'planner-b'] });

    expect(result.deck).toEqual({
      mainCardId: 'main',
      supportCardIds: ['planner-a', 'planner-b'],
      updatedAt: expect.any(Number),
    });
    expect(result.acceptedCards.map((card) => card.id)).toEqual(['main', 'planner-a', 'planner-b']);
    expect(result.rejectedCards.map((card) => card.id)).toEqual(['extra']);
    expect(result.conflicts).toEqual([]);
  });

  it('writes only v3 capability state and preserves unrelated profile fields', () => {
    const profile = {
      tags: ['keep'],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 4,
      quotaLimits: { generateProseCount: 2 },
    } as ProjectPreferenceProfile;
    const next = updateProjectSkillDeck(profile, {
      mainCardId: 'main',
      supportCardIds: ['support-a', 'support-b'],
      updatedAt: 123,
    });

    expect(next.capabilityModelVersion).toBe(3);
    expect(next.capabilityProfile?.projectSkillDeck).toEqual({
      mainCardId: 'main', supportCardIds: ['support-a', 'support-b'], updatedAt: 123,
    });
    expect(next.quotaLimits).toEqual({ generateProseCount: 2 });
    expect(next.tags).toEqual(['keep']);
  });

  it('rejects invalid profile deck updates instead of bypassing deck validation', () => {
    expect(() => updateProjectSkillDeck(undefined, { mainCardId: '', supportCardIds: [], updatedAt: 1 })).toThrow();
    expect(() => updateProjectSkillDeck(undefined, { mainCardId: 'main', supportCardIds: ['a', 'b', 'c'], updatedAt: 1 })).toThrow();
    expect(() => updateProjectSkillDeck(undefined, { mainCardId: 'main', supportCardIds: ['main'], updatedAt: 1 })).toThrow();
  });

  it('rejects non-deconstruction skills instead of putting techniques into the card deck', () => {
    const result = buildProjectSkillDeckPreview([
      skill('card'),
      skill('technique', { deconstructionCardType: undefined }),
    ]);

    expect(result.acceptedCards.map((card) => card.id)).toEqual(['card']);
    expect(result.rejectedCards.map((card) => card.id)).toEqual(['technique']);
    expect(result.warnings.join(' ')).toMatch(/拆书|作品卡组/);
  });

  it('rejects deconstruction cards that are not runtime-ready', () => {
    const result = buildProjectSkillDeckPreview([
      skill('ready'),
      skill('pending', { isRuntimeReady: false } as unknown as Partial<Skill>),
    ]);

    expect(result.acceptedCards.map((card) => card.id)).toEqual(['ready']);
    expect(result.rejectedCards.map((card) => card.id)).toEqual(['pending']);
  });

  it('rejects cards without an authorized source or executable metadata', () => {
    const result = buildProjectSkillDeckPreview([
      skill('paid', { accessTier: 'paid' }),
      skill('unknown-source', { sourceType: 'unknown' }),
      skill('no-rule', { style: '', pacing: '', corePatterns: [] }),
    ]);
    expect(result.acceptedCards).toHaveLength(0);
    expect(result.rejectedCards.map((card) => card.id)).toEqual(['paid', 'unknown-source', 'no-rule']);
  });

  it('builds a v3-only update payload without legacy mounted fields', () => {
    const payload = buildProjectSkillDeckUpdatePayload(undefined, {
      mainCardId: 'main', supportCardIds: ['support'], updatedAt: 1,
    });
    expect(payload).toHaveProperty('projectPreferenceProfile.capabilityModelVersion', 3);
    expect(payload).not.toHaveProperty('mountedSkillLoadout');
    expect(payload).not.toHaveProperty('mountedSkillIds');
  });

});

describe('Plan 158 resolved skill fusion', () => {
  it('freezes components, dimension owners, resolved rules and lineage without mutating sources', () => {
    const main = skill('main', { style: 'short sentences', primaryDimension: 'style', dimensionTags: ['style', 'plot'] });
    const support = skill('support', {
      version: 4,
      style: 'ornate imagery',
      plotPattern: 'reveal a hidden cost',
      primaryDimension: 'plot',
      dimensionTags: ['plot'],
      sourceType: 'licensed',
    });
    const pending = buildResolvedFusionDraft(main, support, 999);
    expect(pending.status).toBe('rejected');
    expect(pending.conflicts.length).toBeGreaterThan(0);
    expect(pending.conflicts[0]).toContain('融合候选保留主卡作为规则来源');
    const result = buildResolvedFusionDraft(main, support, 999, { confirmConflicts: true });

    expect(result.status).toBe('ready');
    expect(result.risks).toContain('存在维度规则冲突，融合候选保留主卡规则并显示辅卡差异');
    expect(result.draft?.description).toBe('main 为主卡，融合 support 的辅卡特征。');
    expect(result.draft?.fusionMeta?.components).toEqual([
      { skillId: 'main', version: 2 }, { skillId: 'support', version: 4 },
    ]);
    expect(result.draft?.fusionMeta?.dimensionOwners?.style).toBe('main');
    expect(result.draft?.fusionMeta?.dimensionOwners?.plot).toBe('main');
    const frozenRules = JSON.parse(JSON.stringify(result.draft?.fusionMeta?.resolvedRules));
    expect(result.draft?.fusionMeta?.resolvedRules).toMatchObject({
      version: 1,
      dimensions: expect.objectContaining({
        style: expect.objectContaining({ owner: 'main' }),
        plot: expect.objectContaining({ owner: 'main' }),
      }),
      lineage: expect.objectContaining({ mainSkillId: 'main', supportSkillId: 'support' }),
    });
    const lineageSources = (result.draft?.fusionMeta?.resolvedRules?.lineage as { sources: Array<Record<string, unknown>> }).sources;
    expect(lineageSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        skillId: 'main', version: 2, deckGroupId: 'deck-1',
        deconstructionCardType: 'style-card', evidenceCoverage: 'full-book-stable',
        sourceBadge: 'book-extracted', sourceType: 'plaza',
      }),
      expect.objectContaining({
        skillId: 'support', version: 4, deckGroupId: 'deck-1',
        deconstructionCardType: 'style-card', evidenceCoverage: 'full-book-stable',
        sourceBadge: 'book-extracted', sourceType: 'licensed',
      }),
    ]));
    expect(result.draft?.sourceBadge).toBe('fused');
    expect(result.draft?.parentSkillId).toBe('main');
    main.style = 'mutated';
    main.evidenceMoments?.push('late-mid');
    support.fewShots = ['mutated nested source'];
    expect(result.draft?.fusionMeta?.resolvedRules).toEqual(frozenRules);
  });

  it('rejects identical cards instead of silently overwriting a source', () => {
    const result = buildResolvedFusionDraft(skill('same'), skill('same'));
    expect(result.status).toBe('rejected');
    expect(result.errorCode).toBe('FUSION_SAME_SOURCE');
  });

  it('rejects non-runtime-ready or unauthorized fusion sources', () => {
    const result = buildResolvedFusionDraft(skill('main'), skill('support', { accessTier: 'paid' }));
    expect(result.status).toBe('rejected');
  });

  it('rejects techniques and flows instead of treating them as capability cards', () => {
    const technique = skill('technique', { deconstructionCardType: undefined });
    const flow = skill('flow', { deconstructionCardType: undefined, sourceType: 'flow' });
    expect(buildResolvedFusionDraft(skill('main'), technique).status).toBe('rejected');
    expect(buildResolvedFusionDraft(skill('main'), flow).status).toBe('rejected');
  });

  it('does not create a metadata-only fusion when sources have no runtime rules', () => {
    const source = skill('empty', { style: '', pacing: '', dimensionTags: [] });
    const draft = buildFusionDraft(source, skill('empty-support', { style: '', pacing: '', dimensionTags: [] }));
    expect(draft).toBeNull();
    expect(buildResolvedFusionDraft(source, skill('empty-support', { style: '', pacing: '', dimensionTags: [] })).status).toBe('rejected');
  });

  it('rejects unresolved dimension conflicts', () => {
    const result = buildResolvedFusionDraft(
      skill('main', { style: 'short' }),
      skill('support', { style: 'ornate' }),
    );
    expect(result.status).toBe('rejected');
    expect(result.conflicts.length).toBeGreaterThan(0);
  });
});
