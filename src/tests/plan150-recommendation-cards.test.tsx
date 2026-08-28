import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useEditorRecommendationCards } from '../lib/hooks/useEditorRecommendationCards';
import { resolveWritingStyle, WritingStyleRequestError } from '../lib/writing-style-client';

describe('useEditorRecommendationCards session state', () => {
  beforeEach(() => sessionStorage.clear());
  const key = (novelId: string, chapterId: string) => `inkflow:recommendation-cards:v1:${encodeURIComponent(novelId)}:${encodeURIComponent(chapterId)}`;

  function setup(novelId: string, chapterId: string) {
    const recordSkillUsageRef = { current: vi.fn().mockResolvedValue(undefined) };
    const hook = renderHook(({ novelId, chapterId }) => useEditorRecommendationCards({
      novelId, chapterId, recordSkillUsageRef,
    }), { initialProps: { novelId, chapterId } });
    return { ...hook, recordSkillUsageRef };
  }

  it('restores per novel and chapter, ignores corrupt storage, and caps normalized ids', async () => {
    sessionStorage.setItem('inkflow:recommendation-cards:v1:n1:c1', JSON.stringify({ stackedIds: [' a ', 'a', '', ...Array.from({ length: 8 }, (_, i) => `s${i}`)], skippedIds: ['x', 'x'] }));
    const { result, rerender } = setup('n1', 'c1');
    expect(result.current.stackedDeconstructionCardIds).toHaveLength(6);
    expect(result.current.skippedAssetIds).toEqual(['x']);
    rerender({ novelId: 'n2', chapterId: 'c1' });
    expect(result.current.stackedDeconstructionCardIds).toEqual([]);
    sessionStorage.setItem('inkflow:recommendation-cards:v1:n2:c1', '{bad');
    await act(async () => {});
    expect(result.current.stackedDeconstructionCardIds).toEqual([]);
  });

  it('reads corrupt JSON during initial initialization and falls back safely', () => {
    sessionStorage.setItem('inkflow:recommendation-cards:v1:n-corrupt:c1', '{not-json');
    const { result } = setup('n-corrupt', 'c1');
    expect(result.current.stackedDeconstructionCardIds).toEqual([]);
    expect(result.current.skippedAssetIds).toEqual([]);
  });

  it('does not reread or reset the same storage key on the initial effect', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    setup('n-read-once', 'c1');
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    getItemSpy.mockRestore();
  });

  it('makes stack, unstack, and skip idempotent and records product events', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { result, recordSkillUsageRef } = setup('n1', 'c1');
    await act(async () => { await result.current.handleStackDeconstructionCard(' card-1 '); });
    await act(async () => { await result.current.handleStackDeconstructionCard('card-1'); });
    await act(async () => { await result.current.handleUnstackDeconstructionCard(' card-1 '); });
    await act(async () => { await result.current.handleUnstackDeconstructionCard('card-1'); });
    await act(async () => { await result.current.handleSkipAsset('card-2'); });
    await act(async () => { await result.current.handleSkipAsset('card-2'); });
    expect(recordSkillUsageRef.current).toHaveBeenCalledTimes(3);
    expect(recordSkillUsageRef.current.mock.calls.map(([action, options]) => [action, options?.notes, options?.skillIds])).toEqual([
      ['accepted', 'stacked:card-1', ['card-1']],
      ['rejected', 'unstacked:card-1', ['card-1']],
      ['rejected', 'skipped:card-2', ['card-2']],
    ]);
    const payloads = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: 'deconstruction_card_stack', stage: 'drafting', novelId: 'n1', chapterId: 'c1', objectId: 'card-1' }),
      expect.objectContaining({ eventName: 'deconstruction_card_unstack', objectId: 'card-1' }),
      expect.objectContaining({ eventName: 'deconstruction_card_skip', objectId: 'card-2' }),
    ]));
    expect(JSON.stringify(payloads)).not.toMatch(/prompt|content|description/);
    fetchSpy.mockRestore();
  });

  it('keeps local state, storage, events, and toast successful when usage recording rejects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const recordSkillUsageRef = { current: vi.fn().mockRejectedValue(new Error('telemetry failed')) };
    const { result } = renderHook(() => useEditorRecommendationCards({ novelId: 'n1', chapterId: 'c1', recordSkillUsageRef }));
    await act(async () => { await expect(result.current.handleStackDeconstructionCard('card-usage-fail')).resolves.toBeUndefined(); });
    expect(result.current.stackedDeconstructionCardIds).toEqual(['card-usage-fail']);
    expect(sessionStorage.getItem(key('n1', 'c1'))).toContain('card-usage-fail');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('encodes each storage key segment to prevent colon collisions', async () => {
    const { result } = setup('novel:a', 'chapter:b');
    await act(async () => { await result.current.handleStackDeconstructionCard('safe-card'); });
    expect(sessionStorage.getItem(key('novel:a', 'chapter:b'))).toContain('safe-card');
    const unencodedCollisionKey = ['inkflow:recommendation-cards:v1', 'novel:a', 'chapter:b'].join(':');
    expect(sessionStorage.getItem(unencodedCollisionKey)).toBeNull();
  });

  it('rejects the seventh stack and skip without changing storage, usage, or events', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { result, recordSkillUsageRef } = setup('n1', 'c1');
    for (let i = 0; i < 6; i++) await act(async () => { await result.current.handleStackDeconstructionCard(`stack-${i}`); });
    const stackedBefore = sessionStorage.getItem('inkflow:recommendation-cards:v1:n1:c1');
    const stackUsageCount = recordSkillUsageRef.current.mock.calls.length;
    const stackEventCount = fetchSpy.mock.calls.length;
    await act(async () => { await result.current.handleStackDeconstructionCard('stack-6'); });
    expect(result.current.stackedDeconstructionCardIds).toHaveLength(6);
    expect(sessionStorage.getItem('inkflow:recommendation-cards:v1:n1:c1')).toBe(stackedBefore);
    expect(recordSkillUsageRef.current).toHaveBeenCalledTimes(stackUsageCount);
    expect(fetchSpy).toHaveBeenCalledTimes(stackEventCount);
    for (let i = 0; i < 6; i++) await act(async () => { await result.current.handleSkipAsset(`skip-${i}`); });
    const before = sessionStorage.getItem('inkflow:recommendation-cards:v1:n1:c1');
    const usageCount = recordSkillUsageRef.current.mock.calls.length;
    const eventCount = fetchSpy.mock.calls.length;
    await act(async () => { await result.current.handleSkipAsset('skip-6'); });
    expect(result.current.skippedAssetIds).toHaveLength(6);
    expect(sessionStorage.getItem('inkflow:recommendation-cards:v1:n1:c1')).toBe(before);
    expect(recordSkillUsageRef.current).toHaveBeenCalledTimes(usageCount);
    expect(fetchSpy).toHaveBeenCalledTimes(eventCount);
    fetchSpy.mockRestore();
  });

  it('restores the original group after switching groups and never exposes raw setters', async () => {
    sessionStorage.setItem('inkflow:recommendation-cards:v1:n1:c1', JSON.stringify({ stackedIds: ['one'], skippedIds: [] }));
    sessionStorage.setItem('inkflow:recommendation-cards:v1:n2:c1', JSON.stringify({ stackedIds: ['two'], skippedIds: [] }));
    const { result, rerender } = setup('n1', 'c1');
    expect(result.current.stackedDeconstructionCardIds).toEqual(['one']);
    rerender({ novelId: 'n2', chapterId: 'c1' });
    await act(async () => { await result.current.handleStackDeconstructionCard('should-not-cross-write'); });
    expect(sessionStorage.getItem('inkflow:recommendation-cards:v1:n2:c1')).not.toContain('one');
    expect(result.current.stackedDeconstructionCardIds).toEqual(['two', 'should-not-cross-write']);
    rerender({ novelId: 'n1', chapterId: 'c1' });
    await act(async () => {});
    expect(result.current.stackedDeconstructionCardIds).toEqual(['one']);
    expect('setSkippedAssetIds' in result.current).toBe(false);
    expect('setStackedDeconstructionCardIds' in result.current).toBe(false);
    expect(useEditorRecommendationCards.toString()).toContain('isSessionStateLoaded');
  });

  it('preserves structured session-card errors from the client', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'UNKNOWN_SESSION_CARD', error: 'invalid', sessionCardId: 'bad-card' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    const scopedRequest = { chapterId: 'chapter-1', databaseGeneration: 7, sessionCardIds: ['bad-card'] };
    await expect(resolveWritingStyle('n1', scopedRequest)).rejects.toMatchObject({
      code: 'UNKNOWN_SESSION_CARD', status: 400, sessionCardId: 'bad-card',
    } satisfies Partial<WritingStyleRequestError>);
    try { await resolveWritingStyle('n1', scopedRequest); } catch (error) { expect(error).toBeInstanceOf(WritingStyleRequestError); }
    vi.restoreAllMocks();
  });

  it('hydrates chapter capability cards and persists stack changes through the chapter boundary', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const onStackedIdsChange = vi.fn().mockResolvedValue(undefined);
    const recordSkillUsageRef = { current: vi.fn().mockResolvedValue(undefined) };
    const { result } = renderHook(() => useEditorRecommendationCards({
      novelId: 'n-persisted',
      chapterId: 'c-persisted',
      recordSkillUsageRef,
      initialStackedIds: ['chapter-card'],
      onStackedIdsChange,
      maxStackedCards: 2,
    }));

    expect(result.current.stackedDeconstructionCardIds).toEqual(['chapter-card']);
    await act(async () => { await result.current.handleStackDeconstructionCard('second-card'); });
    expect(onStackedIdsChange).toHaveBeenCalledWith(['chapter-card', 'second-card']);
    expect(result.current.stackedDeconstructionCardIds).toEqual(['chapter-card', 'second-card']);
    await act(async () => { await result.current.handleStackDeconstructionCard('third-card'); });
    expect(onStackedIdsChange).toHaveBeenCalledTimes(1);
    expect(result.current.stackedDeconstructionCardIds).toEqual(['chapter-card', 'second-card']);
    fetchSpy.mockRestore();
  });
});
