import { afterEach, describe, expect, test, vi } from 'vitest';
import { addCardToProjectDeck, buildV3CapabilityProfile, getProjectDeckIds, upsertCapabilityMembership } from '../lib/skills-studio-governance';
import { applyCapabilityConfiguration, previewCapabilityConfiguration } from '../lib/capability-configuration-client';

describe('Plan 158 project capability deck', () => {
  test('creates an explicit project technique set and preserves legacy fallback input', () => {
    const legacy = buildV3CapabilityProfile({ projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: ['legacy-technique'],
      },
    } }, {}).capabilityProfile!;
    expect(legacy.projectTechniqueIds).toEqual(['legacy-technique']);

    const explicit = buildV3CapabilityProfile({ projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: ['favorite-only'],
        projectTechniqueIds: ['project-only'],
      },
    } }, {}).capabilityProfile!;
    expect(explicit.projectTechniqueIds).toEqual(['project-only']);
  });
  test('keeps one main card and at most two support cards', () => {
    let profile = buildV3CapabilityProfile(null, {} ).capabilityProfile!;
    profile = addCardToProjectDeck(profile, 'main').profile;
    profile = addCardToProjectDeck(profile, 'support-1').profile;
    profile = addCardToProjectDeck(profile, 'support-2').profile;
    expect(getProjectDeckIds(profile)).toEqual(['main', 'support-1', 'support-2']);
    expect(addCardToProjectDeck(profile, 'support-3').requiresReplacement).toBe(true);
  });

  test('requires an explicit replacement and preserves the other cards', () => {
    const profile = {
      version: 3 as const,
      projectSkillDeck: { mainCardId: 'main', supportCardIds: ['support-1', 'support-2'], updatedAt: 1 },
      favoriteTechniqueIds: [],
    };
    const result = addCardToProjectDeck(profile, 'new-card', undefined, 'support-1');
    expect(result.requiresReplacement).toBe(false);
    expect(getProjectDeckIds(result.profile)).toEqual(['main', 'support-2', 'new-card']);
  });

  test('keeps a stable source to persisted skill mapping across profile rebuilds', () => {
    const profile = upsertCapabilityMembership(null, {
      sourceId: 'style-card',
      sourceVersion: '3',
      sourceType: 'plaza',
      persistedSkillId: 'saved-style-card',
    });
    const replaced = upsertCapabilityMembership(profile, {
      sourceId: 'style-card',
      sourceVersion: '3',
      sourceType: 'plaza',
      persistedSkillId: 'saved-style-card-v2',
    });
    const rebuilt = buildV3CapabilityProfile({ projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: replaced,
    } }, {}).capabilityProfile!;

    expect(rebuilt.capabilityMemberships).toEqual([{
      sourceId: 'style-card', sourceVersion: '3', sourceType: 'plaza', persistedSkillId: 'saved-style-card-v2',
    }]);
  });

  test('preserves system guardrail candidates across profile rebuilds', () => {
    const rebuilt = buildV3CapabilityProfile({ projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        guardrailIds: ['default-guardrail'],
      },
    } }, { activeFlowId: 'generic-novel-flow' }).capabilityProfile!;

    expect(rebuilt.guardrailIds).toEqual(['default-guardrail']);
    expect(rebuilt.activeFlowId).toBe('generic-novel-flow');
  });
});

describe('Plan 158 capability configuration API', () => {
  afterEach(() => vi.restoreAllMocks());

  test('previews then applies with generation and token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ previewToken: 'preview-1', databaseGeneration: 7 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: { version: 3 }, databaseGeneration: 8 }), { status: 200 }));
    const profile = buildV3CapabilityProfile(null, {}).capabilityProfile!;

    const preview = await previewCapabilityConfiguration('novel-1', 7, profile);
    const result = await applyCapabilityConfiguration('novel-1', 7, preview.previewToken, profile);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/novels/novel-1/capabilities/configuration/preview', expect.objectContaining({ method: 'POST', body: JSON.stringify({ databaseGeneration: 7, capabilityProfile: profile }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/novels/novel-1/capabilities/configuration/apply', expect.objectContaining({ method: 'POST', body: JSON.stringify({ databaseGeneration: 7, previewToken: 'preview-1', capabilityProfile: profile }) }));
    expect(result.databaseGeneration).toBe(8);
  });

  test('preserves server failure as a typed error for draft retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'CAPABILITY_GENERATION_CONFLICT', error: 'generation changed' }), { status: 409 }));
    await expect(previewCapabilityConfiguration('novel-1', 7, buildV3CapabilityProfile(null, {}).capabilityProfile!)).rejects.toMatchObject({ code: 'CAPABILITY_GENERATION_CONFLICT', status: 409 });
  });
});
