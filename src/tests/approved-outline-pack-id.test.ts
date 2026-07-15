import { describe, expect, test, vi, beforeEach } from 'vitest';
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

describe('approvedOutlinePackId filtering (client-side)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startWorldJob.mockResolvedValue({ result: { outline: '大纲' }, databaseGeneration: 1 });
    updateNovel.mockResolvedValue(true);
    flushPendingEditorWrites.mockResolvedValue(undefined);
  });

  test('approved pack ID is forwarded to API', async () => {
    const args = createHookArgs({ selectedContinuationPackId: 'pack-approved' });
    const { handleGenerateOutline } = useOutlineGeneration(args);
    await handleGenerateOutline();

    expect(startWorldJob).toHaveBeenCalledWith(
      '/api/generate-outline',
      expect.objectContaining({ continuationPackId: 'pack-approved' }),
      expect.anything(),
      expect.anything(),
    );
  });

  test('empty pack ID results in no continuationPackId in request', async () => {
    const args = createHookArgs({ selectedContinuationPackId: '' });
    const { handleGenerateOutline } = useOutlineGeneration(args);
    await handleGenerateOutline();

    const callBody = startWorldJob.mock.calls[0][1];
    expect(callBody).not.toHaveProperty('continuationPackId');
  });

  test('alert is mocked for test isolation', () => {
    expect(typeof alert).toBe('function');
  });
});
