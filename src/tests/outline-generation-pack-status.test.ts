import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import type { Novel } from '../../shared/types';

const { startWorldJob, updateNovel, flushPendingEditorWrites } = vi.hoisted(() => ({
  startWorldJob: vi.fn(),
  updateNovel: vi.fn(),
  flushPendingEditorWrites: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/world-job-client', () => ({ startWorldJob }));
vi.mock('../lib/novel-client', () => ({ updateNovel }));

import { useOutlineGeneration } from '../lib/hooks/generation/useOutlineGeneration';

const mockNovel: Novel = {
  id: 'novel-1',
  title: '测试',
  authorId: 'local-user',
  summary: '',
  status: 'ongoing',
  worldRules: '',
  globalOutline: '',
  mountedSkillIds: [],
  createdAt: 1,
  updatedAt: 1,
};

function createHookArgs(overrides: Partial<Parameters<typeof useOutlineGeneration>[0]> = {}) {
  return {
    novel: mockNovel,
    globalOutline: '',
    expectedWordCount: 100000,
    currentChapter: null,
    selectedContinuationPackId: '',
    planningPromptSurface: 'workspace-beats',
    requestSeqRef: { current: 0 },
    abortControllerRef: { current: null },
    setIsGeneratingOutline: vi.fn(),
    setGlobalOutline: vi.fn(),
    flushPendingEditorWrites,
    ...overrides,
  };
}

describe('useOutlineGeneration - pack status filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startWorldJob.mockResolvedValue({ result: { outline: '生成的大纲' }, databaseGeneration: 1 });
    updateNovel.mockResolvedValue(true);
    flushPendingEditorWrites.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('approved pack ID is sent in request', async () => {
    const args = createHookArgs({ selectedContinuationPackId: 'pack-approved-1' });
    const { handleGenerateOutline } = useOutlineGeneration(args);

    await handleGenerateOutline();

    expect(startWorldJob).toHaveBeenCalledWith(
      '/api/generate-outline',
      expect.objectContaining({ continuationPackId: 'pack-approved-1' }),
      expect.anything(),
      expect.anything(),
    );
  });

  test('empty pack ID sends no continuationPackId', async () => {
    const args = createHookArgs({ selectedContinuationPackId: '' });
    const { handleGenerateOutline } = useOutlineGeneration(args);

    await handleGenerateOutline();

    expect(startWorldJob).toHaveBeenCalledWith(
      '/api/generate-outline',
      expect.not.objectContaining({ continuationPackId: expect.anything() }),
      expect.anything(),
      expect.anything(),
    );
  });

  test('draft pack ID is filtered out by approvedOutlinePackId logic', async () => {
    const args = createHookArgs({ selectedContinuationPackId: '' });
    const { handleGenerateOutline } = useOutlineGeneration(args);

    await handleGenerateOutline();

    const callBody = startWorldJob.mock.calls[0][1];
    expect(callBody.continuationPackId).toBeUndefined();
  });

  test('flush failure prevents outline generation', async () => {
    flushPendingEditorWrites.mockRejectedValueOnce(new Error('flush failed'));
    const args = createHookArgs({ selectedContinuationPackId: 'pack-approved-1' });
    const { handleGenerateOutline } = useOutlineGeneration(args);

    await handleGenerateOutline();

    expect(startWorldJob).not.toHaveBeenCalled();
    expect(args.setIsGeneratingOutline).toHaveBeenCalledWith(true);
    expect(args.setIsGeneratingOutline).toHaveBeenCalledWith(false);
  });

  test('setGlobalOutline called with result on success', async () => {
    const args = createHookArgs();
    const { handleGenerateOutline } = useOutlineGeneration(args);

    await handleGenerateOutline();

    expect(args.setGlobalOutline).toHaveBeenCalledWith('生成的大纲');
  });

  test('updateNovel called with outline result', async () => {
    const args = createHookArgs();
    const { handleGenerateOutline } = useOutlineGeneration(args);

    await handleGenerateOutline();

    expect(updateNovel).toHaveBeenCalledWith('novel-1', { globalOutline: '生成的大纲' }, 1);
  });
});
