import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectPreferenceProfile } from '../shared/lib/project-preference-profile.js';
import type { ProjectPreferenceProfile } from '../shared/types/preferences.js';

test('normalizes empty and partial project preference profiles to runtime shape', () => {
  const empty = normalizeProjectPreferenceProfile({});
  assert.deepEqual(empty.tags, []);
  assert.equal(empty.weights.styleWeight, 0.5);
  assert.equal(empty.evidenceCount, 0);

  const tagsOnly = normalizeProjectPreferenceProfile({ tags: ['clean'] });
  assert.deepEqual(tagsOnly.tags, ['clean']);
  assert.deepEqual(tagsOnly.acceptedDimensions, []);

  const partialWeights = normalizeProjectPreferenceProfile({ weights: { styleWeight: 0.9 } });
  assert.equal(partialWeights.weights.styleWeight, 0.9);
  assert.equal(partialWeights.weights.characterWeight, 0.5);
});

test('normalizes malformed fields while preserving extensions', () => {
  const normalized = normalizeProjectPreferenceProfile({
    tags: null,
    weights: null,
    acceptedDimensions: 'style',
    rejectedDimensions: null,
    notes: { value: 'note' },
    evidenceCount: -2,
    writingStyleConfirmation: { mode: 'default', fingerprint: 'fp', confirmedAt: 1 },
    extensionFlag: true,
  });

  assert.deepEqual(normalized.tags, []);
  assert.deepEqual(normalized.acceptedDimensions, []);
  assert.deepEqual(normalized.rejectedDimensions, []);
  assert.deepEqual(normalized.notes, []);
  assert.equal(normalized.weights.styleWeight, 0.5);
  assert.equal(normalized.evidenceCount, 0);
  assert.deepEqual(normalized.writingStyleConfirmation, { mode: 'default', fingerprint: 'fp', confirmedAt: 1 });
  assert.equal((normalized as ProjectPreferenceProfile & { extensionFlag?: boolean }).extensionFlag, true);
});

test('normalizes an explicit v3 capability profile without reviving invalid cards', () => {
  const normalized = normalizeProjectPreferenceProfile({
    capabilityModelVersion: 3,
    capabilityProfile: {
      version: 3,
      activeFlowId: '  flow-1  ',
      projectSkillDeck: {
        mainCardId: ' main ',
        supportCardIds: ['support-a', ' main ', 'support-a', 'support-b', 'support-c', 3],
        updatedAt: -10,
        extension: 'keep',
      },
      favoriteTechniqueIds: [' gold-three ', 'gold-three', '', 4],
      projectTechniqueIds: [' project-technique ', 'project-technique', '', 4],
      guardrailIds: [' default-guardrail ', 'default-guardrail', '', 5],
      migrationPendingIds: [' legacy ', 'legacy', ''],
      extensionFlag: true,
    },
  });

  assert.equal(normalized.capabilityModelVersion, 3);
  assert.equal(normalized.capabilityProfile?.activeFlowId, 'flow-1');
  assert.deepEqual(normalized.capabilityProfile?.projectSkillDeck, {
    mainCardId: 'main',
    supportCardIds: ['support-a', 'support-b', 'support-c'],
    updatedAt: 0,
    extension: 'keep',
  });
  assert.deepEqual(normalized.capabilityProfile?.favoriteTechniqueIds, ['gold-three']);
  assert.deepEqual(normalized.capabilityProfile?.projectTechniqueIds, ['project-technique']);
  assert.deepEqual(normalized.capabilityProfile?.guardrailIds, ['default-guardrail']);
  assert.deepEqual(normalized.capabilityProfile?.migrationPendingIds, ['legacy']);
  assert.equal((normalized.capabilityProfile as { extensionFlag?: boolean })?.extensionFlag, true);
});

test('normalizes capability memberships by source identity and preserves persisted IDs', () => {
  const normalized = normalizeProjectPreferenceProfile({
    capabilityModelVersion: 3,
    capabilityProfile: {
      version: 3,
      projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
      favoriteTechniqueIds: [],
      capabilityMemberships: [
        { sourceId: ' plaza-card ', sourceVersion: ' 2 ', persistedSkillId: ' saved-1 ', sourceType: 'plaza' },
        { sourceId: 'plaza-card', sourceVersion: '2', persistedSkillId: 'saved-other', sourceType: 'plaza' },
        { sourceId: 'book-card', sourceVersion: 1, persistedSkillId: 'saved-book', sourceType: 'book-extracted' },
        { sourceId: 'missing-type', sourceVersion: '1' },
        { sourceId: 'bad', sourceVersion: '1', sourceType: 'unknown' },
      ],
    },
  });
  assert.deepEqual(normalized.capabilityProfile?.capabilityMemberships, [
    { sourceId: 'plaza-card', sourceVersion: '2', persistedSkillId: 'saved-1', sourceType: 'plaza' },
    { sourceId: 'book-card', sourceVersion: '1', persistedSkillId: 'saved-book', sourceType: 'book-extracted' },
  ]);
});

test('preserves an oversized v3 deck so validation can reject it explicitly', () => {
  const normalized = normalizeProjectPreferenceProfile({
    capabilityModelVersion: 3,
    capabilityProfile: {
      version: 3,
      projectSkillDeck: {
        mainCardId: 'main',
        supportCardIds: ['support-a', 'support-b', 'support-c'],
        updatedAt: 1,
      },
      favoriteTechniqueIds: [],
    },
  });

  assert.deepEqual(
    normalized.capabilityProfile?.projectSkillDeck.supportCardIds,
    ['support-a', 'support-b', 'support-c'],
  );
});

test('does not synthesize v3 state while reading a legacy profile', () => {
  const legacy = normalizeProjectPreferenceProfile({
    skillLoadoutSchemaVersion: 2,
    mountedExtension: true,
  });
  assert.equal(legacy.capabilityModelVersion, undefined);
  assert.equal(legacy.capabilityProfile, undefined);
  assert.equal((legacy as ProjectPreferenceProfile & { mountedExtension?: boolean }).mountedExtension, true);
});
