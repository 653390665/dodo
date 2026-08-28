import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AggregatedSkillDeck, Novel, Skill } from '../../shared/types';
import {
  getCapabilityConfigurationBaselineToken,
  loadLatestCapabilityConfigurationSession,
} from '../lib/capability-configuration-session';
import { getProjectCapabilityProfile } from '../lib/skills-studio-governance';

const mocks = vi.hoisted(() => ({
  listNovels: vi.fn(),
  updateNovel: vi.fn(),
  createSkill: vi.fn(),
  extractSkill: vi.fn(),
  checkSkillExtractionJob: vi.fn(),
  cancelSkillExtractionJob: vi.fn(),
  toast: vi.fn(),
  loggerWarn: vi.fn(),
  recordProductEvent: vi.fn(),
  getDatabaseGenerationSnapshot: vi.fn(),
}));

vi.mock('../lib/novel-client', () => ({
  listNovels: mocks.listNovels,
  updateNovel: mocks.updateNovel,
}));
vi.mock('../lib/skill-client', () => ({ createSkill: mocks.createSkill }));
vi.mock('../lib/prompt-client', () => ({
  extractSkill: mocks.extractSkill,
  checkSkillExtractionJob: mocks.checkSkillExtractionJob,
  cancelSkillExtractionJob: mocks.cancelSkillExtractionJob,
  QuotaError: class QuotaError extends Error {
    quotaExceeded = true;
  },
}));
vi.mock('../lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../lib/client-logger', () => ({ logger: { warn: mocks.loggerWarn } }));
vi.mock('../lib/product-events-client', () => ({ recordProductEvent: mocks.recordProductEvent }));
vi.mock('../lib/db-transport', () => ({ getDatabaseGenerationSnapshot: mocks.getDatabaseGenerationSnapshot }));

import { useBookFactory } from '../components/book-factory/useBookFactory';
import { useNovelStore } from '../stores/novel-store';

function novel(overrides: Partial<Novel> = {}): Novel {
  return {
    id: 'novel-1',
    title: '拆书目标作品',
    authorId: 'local-user',
    summary: '',
    status: 'ongoing',
    createdAt: 1,
    updatedAt: 1,
    projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        activeFlowId: 'book-deconstruction-flow',
        projectSkillDeck: { supportCardIds: [], updatedAt: 0 },
        favoriteTechniqueIds: [],
        guardrailIds: ['guardrail-1'],
      },
    },
    ...overrides,
  };
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'source-card',
    name: '样本拆书卡',
    description: '',
    style: '镜头感强',
    pacing: '高密度钩子',
    stabilityScore: 80,
    evaluationFeedback: '',
    version: 2,
    createdAt: 1,
    primaryDimension: 'style',
    dimensionTags: ['style'],
    deconstructionCardType: 'style-card',
    sourceType: 'book-extracted',
    ...({
      isRuntimeReady: true,
      sanitizationStatus: 'runtime-ready',
      runtimeStatus: 'active',
    } as unknown as Partial<Skill>),
    ...overrides,
  };
}

function deck(): AggregatedSkillDeck {
  const mainCard = skill({ id: 'source-main-card', name: '主拆书卡' });
  const supportCard = skill({ id: 'source-support-card', name: '辅拆书卡', deconstructionCardType: 'hook-card' });
  return {
    mainCard: {
      ...mainCard,
      evidenceCoverage: 'opening-heavy',
      evidenceMoments: [],
    },
    supportCards: [
      {
        ...mainCard,
        evidenceCoverage: 'opening-heavy',
        evidenceMoments: [],
      },
      {
        ...supportCard,
        evidenceCoverage: 'opening-heavy',
        evidenceMoments: [],
      },
    ],
  };
}

describe('BookFactory equip sync', () => {
  const validBookSample = '雨夜里少年推开旧书铺的木门掌柜抬头看了他一眼随后从柜台下取出一册无名残卷窗外雷声压过街巷脚步声他翻开第一页才发现纸上写着自己的名字以及明日将发生的命案';

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    const selected = novel();
    useNovelStore.setState({
      selectedNovel: selected,
      onboardingDraft: null,
      activeSetupTaskKey: null,
      continuationLaunchState: null,
      capabilityLaunchState: null,
    });
    mocks.listNovels.mockResolvedValue([selected]);
    mocks.updateNovel.mockResolvedValue(true);
    mocks.createSkill.mockResolvedValue(undefined);
    mocks.extractSkill.mockResolvedValue({ skills: [skill()], source: 'fallback', warnings: [] });
    mocks.recordProductEvent.mockResolvedValue(undefined);
    mocks.getDatabaseGenerationSnapshot.mockResolvedValue(7);
  });

  it('stages a saved deconstruction card as a capability-center deck candidate without updating the novel', async () => {
    const onOpenCapabilityCenter = vi.fn();
    const { result } = renderHook(() => useBookFactory({ onOpenCapabilityCenter }));

    act(() => result.current.setFileContent(validBookSample));
    await act(async () => { await result.current.handleAnalyze(); });
    await waitFor(() => expect(result.current.selectedSkill?.id).toBe('source-card'));

    await act(async () => { await result.current.handleSaveSelectedSkill(); });
    await waitFor(() => expect(result.current.lastSavedSkillId).not.toBe(''));
    const savedCardId = result.current.lastSavedSkillId;

    act(() => {
      result.current.setShowEquipPanel(true);
      result.current.setEquipNovelId('novel-1');
    });
    await waitFor(() => expect(result.current.userNovels).toHaveLength(1));

    await act(async () => { await result.current.handleEquipSkill(); });

    expect(mocks.updateNovel).not.toHaveBeenCalled();
    expect(useNovelStore.getState().selectedNovel?.projectPreferenceProfile?.capabilityProfile?.projectSkillDeck.mainCardId).toBeUndefined();
    expect(useNovelStore.getState().selectedNovel?.projectPreferenceProfile?.capabilityProfile?.guardrailIds).toEqual(['guardrail-1']);
    expect(loadLatestCapabilityConfigurationSession('novel-1')).toMatchObject({
      novelId: 'novel-1',
      databaseGeneration: 7,
      baselineToken: getCapabilityConfigurationBaselineToken(getProjectCapabilityProfile(novel())),
      candidateCardIds: [savedCardId],
      activeTab: 'mySkills',
      selectedCapability: 'skill-card',
    });
    expect(result.current.showEquipPanel).toBe(false);
    expect(onOpenCapabilityCenter).toHaveBeenCalledWith(expect.objectContaining({ id: 'novel-1' }));
  });

  it('saves and stages the currently selected card after switching cards', async () => {
    const onOpenCapabilityCenter = vi.fn();
    mocks.extractSkill.mockResolvedValueOnce({
      skills: [skill({ id: 'source-card-a', name: '第一张卡' }), skill({ id: 'source-card-b', name: '第二张卡' })],
      source: 'fallback',
      warnings: [],
    });
    const { result } = renderHook(() => useBookFactory({ onOpenCapabilityCenter }));

    act(() => result.current.setFileContent(validBookSample));
    await act(async () => { await result.current.handleAnalyze(); });
    await act(async () => { await result.current.handleSaveSelectedSkill(); });
    const firstSavedId = result.current.lastSavedSkillId;

    act(() => result.current.setSelectedSkillIndex(1));
    await waitFor(() => {
      expect(result.current.selectedSkill?.id).toBe('source-card-b');
      expect(result.current.selectedSavedSkillId).toBe('');
    });
    await act(async () => { await result.current.handleSaveSelectedSkill(); });
    const secondSavedId = result.current.selectedSavedSkillId;
    expect(secondSavedId).not.toBe('');
    expect(secondSavedId).not.toBe(firstSavedId);
    expect(mocks.createSkill).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.setShowEquipPanel(true);
      result.current.setEquipNovelId('novel-1');
    });
    await waitFor(() => expect(result.current.userNovels).toHaveLength(1));
    await act(async () => { await result.current.handleEquipSkill(); });

    expect(loadLatestCapabilityConfigurationSession('novel-1')?.candidateCardIds).toEqual([secondSavedId]);
  });

  it('clears the saving lock when saving a card fails', async () => {
    mocks.createSkill.mockRejectedValueOnce(new Error('写入失败'));
    const { result } = renderHook(() => useBookFactory());

    act(() => result.current.setFileContent(validBookSample));
    await act(async () => { await result.current.handleAnalyze(); });
    await act(async () => {
      await expect(result.current.handleSaveSelectedSkill()).rejects.toThrow('写入失败');
    });

    expect(result.current.isSaving).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('能力卡保存失败'), 'error');
  });

  it('stages a saved deconstruction deck as capability-center candidates without updating the novel', async () => {
    const onOpenCapabilityCenter = vi.fn();
    mocks.extractSkill.mockResolvedValueOnce({
      skills: [skill({ id: 'source-main-card', name: '主拆书卡' }), skill({ id: 'source-support-card', name: '辅拆书卡', deconstructionCardType: 'hook-card' })],
      deck: deck(),
      source: 'fallback',
      warnings: [],
    });
    const { result } = renderHook(() => useBookFactory({ onOpenCapabilityCenter }));

    act(() => result.current.setFileContent(validBookSample));
    await act(async () => { await result.current.handleAnalyze(); });
    await waitFor(() => expect(result.current.deck).not.toBeNull());

    act(() => {
      result.current.setDeckSelection({
        mainCardId: 'source-main-card',
        supportCardIds: ['source-support-card'],
      });
      result.current.setShowEquipPanel(true);
      result.current.setEquipNovelId('novel-1');
    });
    await waitFor(() => expect(result.current.userNovels).toHaveLength(1));

    await act(async () => { await result.current.handleEquipDeck(); });

    expect(mocks.updateNovel).not.toHaveBeenCalled();
    const savedIds = result.current.savedDeckIds;
    expect(savedIds).toHaveLength(2);
    expect(loadLatestCapabilityConfigurationSession('novel-1')?.candidateCardIds).toEqual(savedIds);
    expect(useNovelStore.getState().selectedNovel?.projectPreferenceProfile?.capabilityProfile?.projectSkillDeck.mainCardId).toBeUndefined();
    expect(result.current.showEquipPanel).toBe(false);
    expect(onOpenCapabilityCenter).toHaveBeenCalledWith(expect.objectContaining({ id: 'novel-1' }));
  });

  it('keeps the equip panel open when candidate staging fails', async () => {
    const onOpenCapabilityCenter = vi.fn();
    mocks.getDatabaseGenerationSnapshot.mockRejectedValueOnce(new Error('database unavailable'));
    const { result } = renderHook(() => useBookFactory({ onOpenCapabilityCenter }));

    act(() => result.current.setFileContent(validBookSample));
    await act(async () => { await result.current.handleAnalyze(); });
    await act(async () => { await result.current.handleSaveSelectedSkill(); });
    act(() => result.current.setEquipNovelId('novel-1'));
    await waitFor(() => expect(result.current.userNovels).toHaveLength(1));

    await act(async () => { await result.current.handleEquipSkill(); });

    expect(result.current.showEquipPanel).toBe(true);
    expect(onOpenCapabilityCenter).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('提交到作品卡组待选失败，请重试', 'error');
    expect(mocks.loggerWarn).toHaveBeenCalledWith('Failed to stage book-factory deck candidates', expect.any(Error));
  });

  it('sends the saved deconstruction card as a session card when test driving writing style', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"token","content":"试跑"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"done","text":"试跑结果"}\n\n'));
          controller.close();
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useBookFactory({
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      writingStyleFingerprint: 'confirmed-fingerprint',
    }));

    act(() => result.current.setFileContent(validBookSample));
    await act(async () => { await result.current.handleAnalyze(); });
    await waitFor(() => expect(result.current.selectedSkill?.id).toBe('source-card'));
    await act(async () => { await result.current.handleSaveSelectedSkill(); });
    await waitFor(() => expect(result.current.lastSavedSkillId).not.toBe(''));
    const savedCardId = result.current.lastSavedSkillId;

    act(() => result.current.setTestInput(validBookSample));
    await act(async () => { await result.current.handleTestDrive(); });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      writingStyleFingerprint: 'confirmed-fingerprint',
      sessionCardIds: [savedCardId],
    });
    expect(result.current.testOutput).toBe('试跑结果');
  });

  it('does not reuse a previously saved card when test driving a different unsaved card', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"done","text":"试跑结果"}\n\n'));
          controller.close();
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    mocks.extractSkill.mockResolvedValueOnce({
      skills: [skill({ id: 'source-card-a', name: '第一张卡' }), skill({ id: 'source-card-b', name: '第二张卡' })],
      source: 'fallback',
      warnings: [],
    });
    const { result } = renderHook(() => useBookFactory({
      chapterId: 'chapter-1',
      databaseGeneration: 7,
      writingStyleFingerprint: 'confirmed-fingerprint',
    }));

    act(() => result.current.setFileContent(validBookSample));
    await act(async () => { await result.current.handleAnalyze(); });
    await waitFor(() => expect(result.current.selectedSkill?.id).toBe('source-card-a'));
    await act(async () => { await result.current.handleSaveSelectedSkill(); });
    await waitFor(() => expect(result.current.lastSavedSkillId).not.toBe(''));

    act(() => result.current.setSelectedSkillIndex(1));
    await waitFor(() => expect(result.current.selectedSkill?.id).toBe('source-card-b'));
    act(() => result.current.setTestInput(validBookSample));
    await act(async () => { await result.current.handleTestDrive(); });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.sessionCardIds).toBeUndefined();
  });

  it('keeps the test input and card context while confirming a required writing style', async () => {
    let orchestrateCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/writing-style/confirm')) {
        return new Response(JSON.stringify({
          fingerprint: 'confirmed-style',
          resolution: { mode: 'default', fingerprint: 'confirmed-style', summary: '确认写法', confirmed: true, sources: [], allowedModes: ['default'], warnings: [], resolverVersion: 1 },
          candidates: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      orchestrateCalls += 1;
      if (orchestrateCalls === 1) {
        return new Response(JSON.stringify({
          code: 'STYLE_CONFIRMATION_REQUIRED',
          error: '请先确认本次写法',
          resolution: { mode: 'default', fingerprint: 'style-candidate', summary: '待确认写法', confirmed: false, sources: [], allowedModes: ['default'], warnings: [], resolverVersion: 1 },
          candidates: [{ mode: 'default', fingerprint: 'style-candidate', summary: '系统默认', sources: [] }],
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"done","text":"确认后试跑结果"}\n\n'));
          controller.close();
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useBookFactory({ chapterId: 'chapter-1', databaseGeneration: 7 }));

    act(() => result.current.setFileContent(validBookSample));
    await act(async () => { await result.current.handleAnalyze(); });
    await waitFor(() => expect(result.current.selectedSkill?.id).toBe('source-card'));
    act(() => result.current.setTestInput(validBookSample));
    await act(async () => { await result.current.handleTestDrive(); });

    expect(result.current.testStyleResolution?.summary).toBe('待确认写法');
    expect(result.current.testStyleCandidates).toHaveLength(1);
    expect(result.current.testInput).toBe(validBookSample);
    await act(async () => {
      const fingerprint = await result.current.onConfirmTestStyle('default');
      await result.current.onGenerateWithTestStyle(fingerprint || undefined);
    });
    expect(result.current.testOutput).toBe('确认后试跑结果');
    expect(orchestrateCalls).toBe(2);
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      sceneBeats: validBookSample,
      styleConfirmationFingerprint: 'confirmed-style',
      writingStyleFingerprint: 'confirmed-style',
    });
  });
});
