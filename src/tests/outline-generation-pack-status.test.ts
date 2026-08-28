import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import type { Novel } from '../../shared/types';

const { startWorldJob, createOutline, activateOutline, flushPendingEditorWrites } = vi.hoisted(() => ({
  startWorldJob: vi.fn(),
  createOutline: vi.fn(),
  activateOutline: vi.fn(),
  flushPendingEditorWrites: vi.fn().mockResolvedValue(undefined),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../lib/world-job-client', () => ({ startWorldJob }));
vi.mock('../lib/outline-client', () => ({ createOutline, activateOutline }));
vi.mock('../lib/toast', () => ({ toast }));

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
    createOutline.mockResolvedValue({ id: 'candidate-1' });
    activateOutline.mockResolvedValue({ archivedIds: [], demotedIds: [] });
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

  test('generated outline stays a candidate and does not replace the displayed master', async () => {
    const args = createHookArgs();
    const { handleGenerateOutline } = useOutlineGeneration(args);

    const result = await handleGenerateOutline();

    expect(result).toEqual({ candidateId: 'candidate-1', content: '生成的大纲', databaseGeneration: 1 });
    expect(createOutline).toHaveBeenCalledWith('novel-1', expect.objectContaining({ content: '生成的大纲', databaseGeneration: 1 }));
    expect(activateOutline).not.toHaveBeenCalled();
    expect(args.setGlobalOutline).not.toHaveBeenCalled();
  });

  test('uses selected outline as seed and reports failure without replacing it', async () => {
    startWorldJob.mockRejectedValueOnce(new Error('网络失败'));
    const args = createHookArgs({ globalOutline: '旧大纲' });
    const { handleGenerateOutline } = useOutlineGeneration(args);

    await handleGenerateOutline('所选文件大纲');

    expect(startWorldJob).toHaveBeenCalledWith(
      '/api/generate-outline',
      expect.objectContaining({ seedOutline: '所选文件大纲', expectedWordCount: 100000 }),
      expect.anything(),
      expect.anything(),
    );
    expect(args.setGlobalOutline).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('大纲生成失败：网络失败', 'error');
  });

  test('does not activate a stale candidate when a newer request starts during create', async () => {
    let resolveCandidate!: (value: { id: string }) => void;
    createOutline.mockReturnValueOnce(new Promise<{ id: string }>((resolve) => { resolveCandidate = resolve; }));
    const args = createHookArgs();
    const { handleGenerateOutline } = useOutlineGeneration(args);
    const pending = handleGenerateOutline();
    await Promise.resolve();
    args.requestSeqRef.current = 2;
    resolveCandidate({ id: 'stale-candidate' });
    await pending;
    expect(activateOutline).not.toHaveBeenCalled();
    expect(args.setGlobalOutline).not.toHaveBeenCalled();
  });

  test('a stale outline failure cannot overwrite a newer AI action state', async () => {
    let rejectGeneration!: (error: Error) => void;
    startWorldJob.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectGeneration = reject; }));
    const setAiActionState = vi.fn();
    const args = createHookArgs({ setAiActionState });
    const { handleGenerateOutline } = useOutlineGeneration(args);

    const pending = handleGenerateOutline();
    await Promise.resolve();
    args.requestSeqRef.current = 2;
    rejectGeneration(new Error('late provider failure'));
    await pending;

    expect(setAiActionState).toHaveBeenCalledTimes(1);
    expect(setAiActionState).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', operation: 'outline' }));
    expect(toast).not.toHaveBeenCalled();
  });

  test('abort does not replace existing outline or report an error', async () => {
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    startWorldJob.mockRejectedValueOnce(abortError);
    const args = createHookArgs({ globalOutline: '旧大纲' });
    const { handleGenerateOutline } = useOutlineGeneration(args);

    await handleGenerateOutline('所选文件大纲');

    expect(args.setGlobalOutline).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
