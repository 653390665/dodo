import { describe, expect, test } from 'vitest';

import { resolveEditorCapabilityLaunch } from '../lib/capability-launch';

describe('editor capability launch resolution', () => {
  test('rejects a launch for another novel or chapter', () => {
    expect(resolveEditorCapabilityLaunch({
      novelId: 'novel-2', launchToken: 1, action: 'use-overlay', assetId: 'overlay-1',
    }, { novelId: 'novel-1', chapterId: 'chapter-1' })).toEqual({ ok: false, code: 'CAPABILITY_NOVEL_MISMATCH' });

    expect(resolveEditorCapabilityLaunch({
      novelId: 'novel-1', launchToken: 2, action: 'run-utility', assetId: 'utility-1', targetChapterId: 'chapter-2',
    }, { novelId: 'novel-1', chapterId: 'chapter-1' })).toEqual({ ok: false, code: 'CAPABILITY_CHAPTER_MISMATCH' });
  });

  test('resolves an overlay to one governed session card without pack state', () => {
    expect(resolveEditorCapabilityLaunch({
      novelId: 'novel-1', launchToken: 3, action: 'use-overlay', assetId: 'overlay-1',
    }, { novelId: 'novel-1', chapterId: 'chapter-1' })).toEqual({
      ok: true,
      action: 'use-overlay',
      assetId: 'overlay-1',
      targetChapterId: 'chapter-1',
    });
  });

  test('preserves persisted session card ids for overlay launches', () => {
    expect(resolveEditorCapabilityLaunch({
      novelId: 'novel-1',
      launchToken: 4,
      action: 'use-overlay',
      assetId: 'deconstruct-card-pacing',
      targetChapterId: 'chapter-1',
      sessionCardIds: ['persisted-card-1'],
    }, { novelId: 'novel-1', chapterId: 'chapter-1' })).toEqual({
      ok: true,
      action: 'use-overlay',
      assetId: 'deconstruct-card-pacing',
      targetChapterId: 'chapter-1',
      sessionCardIds: ['persisted-card-1'],
    });
  });
});
