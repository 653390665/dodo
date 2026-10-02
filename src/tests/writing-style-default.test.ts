import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureWritingStyleConfirmed,
  StyleConfirmationRequiredError,
} from '../lib/writing-style-client';
import { startChapterProductionRun } from '../lib/production-client';
import { resetProductEventOnceMemory } from '../lib/telemetry-once';

const mockRecordProductEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/product-events-client', () => ({
  recordProductEvent: (...args: unknown[]) => mockRecordProductEvent(...args),
}));

type Captured = { path: string; body: Record<string, unknown> };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function resolution(confirmed: boolean, fingerprint = 'fp-auto') {
  return {
    resolution: {
      resolverVersion: 1,
      fingerprint,
      mode: 'default',
      summary: '推荐写法',
      sources: [],
      allowedModes: ['default'],
      warnings: [],
      confirmed,
    },
    fingerprint,
  };
}

function stubFetch(handler: (path: string) => Response | Promise<Response>) {
  const captured: Captured[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as Request).url);
    const path = new URL(raw, 'http://localhost').pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    captured.push({ path, body });
    return handler(path);
  });
  vi.stubGlobal('fetch', fetchMock);
  return captured;
}

describe('Plan 271 W3 · writing style confirmation defaults on', () => {
  beforeEach(() => {
    resetProductEventOnceMemory();
    window.localStorage.clear();
    mockRecordProductEvent.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('auto-confirms the recommended writing style when the resolver has not confirmed it', async () => {
    const captured = stubFetch((path) =>
      path.endsWith('/resolve')
        ? jsonResponse(resolution(false))
        : jsonResponse({ fingerprint: 'fp-auto' })
    );

    const ensured = await ensureWritingStyleConfirmed('novel-1', {
      chapterId: 'ch-1',
      databaseGeneration: 3,
    });

    expect(ensured).toEqual({ fingerprint: 'fp-auto', defaulted: true });
    expect(captured.map((entry) => entry.path)).toEqual([
      '/api/novels/novel-1/writing-style/resolve',
      '/api/novels/novel-1/writing-style/confirm',
    ]);
    expect(captured[1].body).toMatchObject({ chapterId: 'ch-1', databaseGeneration: 3 });
    expect(mockRecordProductEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordProductEvent.mock.calls[0][0]).toMatchObject({
      eventName: 'writing_style_defaulted',
      novelId: 'novel-1',
      chapterId: 'ch-1',
    });
  });

  it('keeps the resolver fingerprint without confirming when it is already confirmed', async () => {
    const captured = stubFetch(() => jsonResponse(resolution(true, 'fp-confirmed')));

    const ensured = await ensureWritingStyleConfirmed('novel-1', {
      chapterId: 'ch-2',
      databaseGeneration: 1,
    });

    expect(ensured).toEqual({ fingerprint: 'fp-confirmed', defaulted: false });
    expect(captured).toHaveLength(1);
    expect(mockRecordProductEvent).not.toHaveBeenCalled();
  });

  it('surfaces a confirmation that cannot be defaulted', async () => {
    stubFetch((path) =>
      path.endsWith('/resolve')
        ? jsonResponse(resolution(false))
        : jsonResponse({ code: 'STYLE_CONFIRMATION_REQUIRED' }, 409)
    );

    await expect(
      ensureWritingStyleConfirmed('novel-1', { chapterId: 'ch-3', databaseGeneration: 1 })
    ).rejects.toBeInstanceOf(StyleConfirmationRequiredError);
  });

  it('sends the defaulted fingerprint with a production run instead of hitting the 409 wall', async () => {
    const captured = stubFetch((path) => {
      if (path.endsWith('/resolve')) return jsonResponse(resolution(false));
      if (path.endsWith('/confirm')) return jsonResponse({ fingerprint: 'fp-auto' });
      return jsonResponse({ run: { id: 'run-1', status: 'running' } });
    });

    await startChapterProductionRun({
      novelId: 'novel-1',
      chapterId: 'ch-4',
      databaseGeneration: 2,
      targetChapterId: 'ch-4',
      userIntent: '续写',
    });

    const startCall = captured.find((entry) => entry.path === '/api/chapter-production-runs/start');
    expect(startCall).toBeDefined();
    expect(startCall?.body.styleConfirmationFingerprint).toBe('fp-auto');
  });

  it('falls back to the confirmation wall when the style resolver is unavailable', async () => {
    const captured = stubFetch((path) => {
      if (path.includes('/writing-style/')) throw new Error('offline');
      return jsonResponse({ run: { id: 'run-1', status: 'running' } });
    });

    await startChapterProductionRun({
      novelId: 'novel-1',
      chapterId: 'ch-5',
      databaseGeneration: 2,
      targetChapterId: 'ch-5',
      userIntent: '续写',
    });

    const startCall = captured.find((entry) => entry.path === '/api/chapter-production-runs/start');
    expect(startCall).toBeDefined();
    expect(startCall?.body.styleConfirmationFingerprint).toBeUndefined();
  });
});
