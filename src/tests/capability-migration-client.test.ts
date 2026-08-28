import { describe, expect, it, vi } from 'vitest';
import { applyCapabilityMigration, previewCapabilityMigration, CapabilityMigrationError } from '../lib/capability-migration-client';

describe('capability migration client', () => {
  it('calls preview and apply endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ previewToken: 'token' }), { status: 200 }));
    await previewCapabilityMigration('novel/1', 4);
    expect(fetchMock).toHaveBeenCalledWith('/api/novels/novel%2F1/capabilities/migration/preview', expect.objectContaining({ method: 'POST' }));
    await applyCapabilityMigration('novel/1', 4, 'token');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/novels/novel%2F1/capabilities/migration/apply', expect.objectContaining({ method: 'POST' }));
    fetchMock.mockRestore();
  });

  it('exposes stable server errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'CAPABILITY_MIGRATION_STALE', error: 'stale' }), { status: 409 }));
    await expect(previewCapabilityMigration('n', 1)).rejects.toBeInstanceOf(CapabilityMigrationError);
    vi.restoreAllMocks();
  });
});
