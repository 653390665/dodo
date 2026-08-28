import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  acceptCanonPatch,
  activateOutline,
  archiveOutline,
  createOutline,
  listOutlines,
  rejectCanonPatch,
  subscribeToOutlineGovernanceChanges,
} from '../lib/outline-client';

const artifact = { id: 'o/1', novelId: 'novel/1', level: 'master', scope: {}, content: 'x', source: 'ai-proposal', status: 'candidate' };
afterEach(() => vi.restoreAllMocks());

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('outline client', () => {
  test('list encodes novel ID and filters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([]));
    await listOutlines('novel/一', { level: 'chapter', status: 'candidate' });
    expect(fetchMock).toHaveBeenCalledWith('/api/novels/novel%2F%E4%B8%80/outlines?level=chapter&status=candidate', undefined);
  });

  test('list can carry generation for activation readback', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([artifact]));
    await listOutlines('n1', {}, 7);
    expect(fetchMock).toHaveBeenCalledWith('/api/novels/n1/outlines?generation=7', undefined);
  });

  test('writes include generation/source and emit only matching novel', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(artifact, 201))
      .mockResolvedValueOnce(response({ archivedIds: [], demotedIds: [] }))
      .mockResolvedValueOnce(response({ archived: true }));
    const events: string[] = [];
    const unsubscribe = subscribeToOutlineGovernanceChanges((event) => events.push(event.novelId));
    await createOutline('novel/1', { level: 'master', scope: {}, content: 'x', source: 'ai-proposal', databaseGeneration: 7 });
    await activateOutline('novel/1', 'o/1', 7);
    await archiveOutline('other', 'o/1', 7);
    unsubscribe();
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ source: 'ai-proposal', databaseGeneration: 7 });
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ databaseGeneration: 7 });
    expect(events).toEqual(['novel/1', 'novel/1', 'other']);
  });

  test('canon accept/reject encode IDs and return action result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        status: 'accepted', fingerprint: 'fp',
        acceptedOutlineRefs: [{ kind: 'master-outline', id: 'outline-1', version: 1 }],
      }))
      .mockResolvedValueOnce(response({ status: 'rejected' }));
    await expect(acceptCanonPatch('n/1', 'p/1', 7)).resolves.toEqual({
      status: 'accepted', fingerprint: 'fp',
      acceptedOutlineRefs: [{ kind: 'master-outline', id: 'outline-1', version: 1 }],
    });
    await expect(rejectCanonPatch('n/1', 'p/1', 7)).resolves.toEqual({ status: 'rejected' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/novels/n%2F1/canon-patches/p%2F1/accept');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/novels/n%2F1/canon-patches/p%2F1/reject');
  });

  test('non-2xx yields stable error and does not emit', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ code: 'OUTLINE_GENERATION_STALE', error: 'stale' }, 409));
    const events: string[] = [];
    const unsubscribe = subscribeToOutlineGovernanceChanges((event) => events.push(event.novelId));
    await expect(activateOutline('n1', 'o1', 3)).rejects.toMatchObject({ code: 'OUTLINE_GENERATION_STALE', status: 409 });
    unsubscribe();
    expect(events).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
