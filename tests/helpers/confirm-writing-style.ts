import assert from 'node:assert/strict';
import { getNovel, updateNovel } from '../../server/lib/db.js';
import { resolveWritingStyleRequest } from '../../server/helpers/writing-style-service.js';

export function confirmWritingStyleForTest(novelId: string, continuationPackId?: string): string {
  const resolved = resolveWritingStyleRequest(novelId, continuationPackId ? { continuationPackId } : {});
  const novel = getNovel(novelId);
  assert.ok(novel?.projectPreferenceProfile);
  updateNovel(novelId, { projectPreferenceProfile: {
    ...novel.projectPreferenceProfile,
    writingStyleConfirmation: { mode: resolved.resolution.mode, fingerprint: resolved.resolution.fingerprint, confirmedAt: Date.now() },
  } });
  return resolved.resolution.fingerprint;
}
