import { afterEach, describe, expect, test, vi } from 'vitest';
import { confirmWritingStyle, resolveWritingStyle, StyleConfirmationRequiredError } from '../lib/writing-style-client';

afterEach(() => vi.restoreAllMocks());

describe('writing style client', () => {
  test('resolves and confirms a style with the scoped payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ resolution: { resolverVersion: 1, fingerprint: 'fp-1', mode: 'writer-skill', summary: '克制短句', sources: [], allowedModes: ['writer-skill'], warnings: [], confirmed: false }, candidates: [] }), { status: 200 }));

    await resolveWritingStyle('novel-1', {
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      continuationPackId: 'pack-1',
      sessionCardIds: ['card-1'],
      mode: 'writer-skill',
    });
    await confirmWritingStyle('novel-1', {
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      continuationPackId: 'pack-1',
      sessionCardIds: ['card-1'],
      mode: 'writer-skill',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/novels/novel-1/writing-style/resolve', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      continuationPackId: 'pack-1',
      sessionCardIds: ['card-1'],
      mode: 'writer-skill',
    });
  });

  test('exposes resolution and candidates when generation requires confirmation', async () => {
    const resolution = { resolverVersion: 1, fingerprint: 'fp-1', mode: 'default', summary: '系统默认笔调', sources: [], allowedModes: ['default'], warnings: [], confirmed: false };
    const candidates = [{ mode: 'default', fingerprint: 'fp-1', summary: '系统默认笔调', sources: [] }];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ code: 'STYLE_CONFIRMATION_REQUIRED', resolution, candidates }), { status: 409 }));

    const scopedRequest = { chapterId: 'chapter-1', databaseGeneration: 7 };
    await expect(resolveWritingStyle('novel-1', scopedRequest)).rejects.toMatchObject({ code: 'STYLE_CONFIRMATION_REQUIRED' });
    try {
      await resolveWritingStyle('novel-1', scopedRequest);
    } catch (error) {
      expect(error).toBeInstanceOf(StyleConfirmationRequiredError);
      expect((error as StyleConfirmationRequiredError).candidates).toEqual(candidates);
    }
  });
});
