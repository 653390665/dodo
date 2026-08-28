import { beforeEach, describe, expect, test } from 'vitest';
import {
  clearLatestCapabilityConfigurationSession,
  clearCapabilityConfigurationSession,
  isCapabilityConfigurationSessionStale,
  loadLatestCapabilityConfigurationSession,
  loadCapabilityConfigurationSession,
  saveCapabilityConfigurationSession,
  type CapabilityConfigurationSession,
} from '../lib/capability-configuration-session';

const session: CapabilityConfigurationSession = {
  version: 1,
  novelId: 'novel-1',
  databaseGeneration: 7,
  baselineToken: 'baseline-1',
  configurationDraft: null,
  candidateCardIds: ['card-1', 'card-1', ''],
  pendingCandidateId: 'card-1',
  activeTab: 'plaza',
  selectedCapability: 'skill-card',
  selectedCategory: 'active-drafting',
  selectedAssetId: 'card-1',
  scrollTop: 240,
  updatedAt: 1,
};

describe('capability configuration session', () => {
  beforeEach(() => sessionStorage.clear());

  test('persists a normalized, context-bound session and restores it for the same generation', () => {
    saveCapabilityConfigurationSession(session);
    expect(loadCapabilityConfigurationSession('novel-1', 7, 'baseline-1')).toMatchObject({
      novelId: 'novel-1',
      databaseGeneration: 7,
      candidateCardIds: ['card-1'],
      selectedAssetId: 'card-1',
    });
  });

  test('rejects a session from another novel, generation, or baseline', () => {
    saveCapabilityConfigurationSession(session);
    expect(loadCapabilityConfigurationSession('novel-2', 7, 'baseline-1')).toBeNull();
    expect(loadCapabilityConfigurationSession('novel-1', 8, 'baseline-1')).toBeNull();
    expect(loadCapabilityConfigurationSession('novel-1', 7, 'baseline-2')).toBeNull();
  });

  test('keeps a mismatched draft readable and marks it stale', () => {
    saveCapabilityConfigurationSession(session);
    const latest = loadLatestCapabilityConfigurationSession('novel-1');
    expect(latest).toMatchObject({ novelId: 'novel-1', databaseGeneration: 7 });
    expect(isCapabilityConfigurationSessionStale(latest!, 8, 'baseline-1')).toBe(true);
    expect(isCapabilityConfigurationSessionStale(latest!, 7, 'baseline-1')).toBe(false);
  });

  test('clears a stale draft explicitly', () => {
    saveCapabilityConfigurationSession(session);
    clearLatestCapabilityConfigurationSession('novel-1');
    expect(loadLatestCapabilityConfigurationSession('novel-1')).toBeNull();
  });

  test('clears only the context-bound session', () => {
    saveCapabilityConfigurationSession(session);
    clearCapabilityConfigurationSession('novel-1', 7, 'baseline-1');
    expect(loadCapabilityConfigurationSession('novel-1', 7, 'baseline-1')).toBeNull();
  });
});
