import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { downloadAuthenticatedFile } from '../lib/download-client';

describe('downloadAuthenticatedFile', () => {
  const originalFetch = globalThis.fetch;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:download');
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('forwards bearer auth, creates a Blob, uses the response filename, and revokes the URL', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-token');
      return new Response('database-bytes', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="backup.db"' },
      });
    }) as typeof fetch;

    const anchor = { click: vi.fn(), href: '', download: '' } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor as never);

    vi.useFakeTimers();

    await downloadAuthenticatedFile('/api/db/export-file', {
      headers: { Authorization: 'Bearer test-token' },
      fallbackFilename: 'fallback.db',
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.size).toBe(new TextEncoder().encode('database-bytes').byteLength);
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe('database-bytes');
    expect(anchor.href).toBe('blob:download');
    expect(anchor.download).toBe('backup.db');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  test('rejects non-2xx responses without creating a Blob URL', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

    await expect(downloadAuthenticatedFile('/api/db/export-file')).rejects.toThrow('Unauthorized');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  test('revokes the Blob URL even when triggering the download throws', async () => {
    globalThis.fetch = vi.fn(async () => new Response('database-bytes')) as typeof fetch;
    const anchor = {
      click: vi.fn(() => { throw new Error('click failed'); }),
      href: '',
      download: '',
    } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor as never);

    await expect(downloadAuthenticatedFile('/api/db/export-file')).rejects.toThrow('click failed');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });
});
