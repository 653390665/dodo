import { describe, expect, test } from 'vitest';
import type { ChapterWorkflowMeta, ProjectPreferenceProfile } from '../../shared/types';
import {
  buildChapterCapabilityWorkflowMeta,
  getChapterOverlayCapacity,
} from '../lib/chapter-capability-state';

describe('chapter capability state', () => {
  test('preserves workflow evidence while updating normalized techniques and overlays', () => {
    const current: ChapterWorkflowMeta = {
      version: 1,
      lastAudit: { status: 'pass', contentHash: 'hash', completedAt: 10, source: 'model' },
      capabilityState: { techniqueIds: ['old'], overlayCardIds: ['old-card'], updatedAt: 1 },
    };
    const next = buildChapterCapabilityWorkflowMeta(current, {
      techniqueIds: [' gold ', 'gold', ''],
      overlayCardIds: [' card-a ', 'card-a', 'card-b'],
      updatedAt: 20,
    });

    expect(next.lastAudit).toEqual(current.lastAudit);
    expect(next.capabilityState).toEqual({
      techniqueIds: ['gold'],
      overlayCardIds: ['card-a', 'card-b'],
      updatedAt: 20,
    });
  });

  test('reserves the six-card runtime budget for the project deck', () => {
    const profile = {
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: {
          mainCardId: 'main',
          supportCardIds: ['support', 'main', 'support-2'],
          updatedAt: 1,
        },
        favoriteTechniqueIds: [],
      },
    } as unknown as ProjectPreferenceProfile;
    expect(getChapterOverlayCapacity(profile)).toBe(3);
    expect(getChapterOverlayCapacity(undefined)).toBe(6);
  });

  test('persists scope, generation, and asset versions when supplied', () => {
    const next = buildChapterCapabilityWorkflowMeta(undefined, {
      techniqueIds: ['gold'],
      overlayCardIds: ['card'],
      novelId: 'novel-1',
      databaseGeneration: 7,
      techniqueVersions: { gold: '3' },
      overlayVersions: { card: 2 },
    });
    expect(next.capabilityState).toMatchObject({
      novelId: 'novel-1', databaseGeneration: 7,
      techniqueVersions: { gold: '3' }, overlayVersions: { card: 2 },
    });
  });
});
