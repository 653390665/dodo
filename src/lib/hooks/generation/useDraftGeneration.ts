import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Novel, Chapter, WritingStyleCandidate, WritingStyleResolution } from '../../../../shared/types';
import type { AgentContext } from '../../agents';
import { editorAgentPhase, buildContextPrompt } from '../../agents';
import { updateChapter } from '../../chapter-client';
import { readDraftStream } from '../../draft-stream';
import { getDatabaseGenerationSnapshot, requireResponseDatabaseGeneration } from '../../db-transport';
import {
  createAiActionError,
  createAiActionRunning,
  createAiActionSuccess,
  idleAiAction,
  type AiActionState,
  type AiContentCandidate,
} from '../../generation-action-state';
import { computeChapterWorkflowHash } from '../../../../shared/lib/chapter-workflow';
import { validateCompleteChapterDraftQuality } from '../../../../shared/lib/draft-quality';

interface UseDraftGenerationArgs {
  novel: Novel;
  currentChapter: Chapter | null;
  userIntent: string;
  selectedContinuationPackId: string;
  writingStyleFingerprint?: string;
  sessionCardIds?: string[];
  onStyleConfirmationRequired?: (data: { resolution?: WritingStyleResolution; candidates?: WritingStyleCandidate[] }) => void;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  draftPromptSurface: string;
  requestSeqRef: { current: number };
  abortControllerRef: { current: AbortController | null };
  latestChapterIdRef: { current: string | null };
  isGeneratingContent: boolean;
  setIsGeneratingContent: (val: boolean) => void;
  setIsGeneratingBeats: (val: boolean) => void;
  setIsGeneratingCritique?: (val: boolean) => void;
  setAuditStatus?: (val: string | null) => void;
  setGenerationStatus: (val: string | null) => void;
  setAiActionState?: Dispatch<SetStateAction<AiActionState>>;
  setUserIntent: Dispatch<SetStateAction<string>>;
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>;
  buildAgentContext: () => AgentContext;
  pushToUndoHistory: (content: string) => void;
  getCurrentFitScore: () => number;
  recordSkillUsage: (
    userAction: 'accepted' | 'revised' | 'rejected',
    options?: { fitScore?: number; auditScore?: number; notes?: string; skillIds?: string[]; databaseGeneration?: number },
  ) => Promise<void>;
  formatAiFailure: (error: unknown, actionLabel: string) => string;
  flushPendingEditorWrites: () => Promise<void>;
  setCandidate?: (candidate: AiContentCandidate | null) => void;
}

export function useDraftGeneration({
  novel,
  currentChapter,
  userIntent,
  selectedContinuationPackId,
  writingStyleFingerprint,
  sessionCardIds,
  onStyleConfirmationRequired,
  contentRef,
  draftPromptSurface,
  requestSeqRef,
  abortControllerRef,
  latestChapterIdRef,
  isGeneratingContent,
  setIsGeneratingContent,
  setIsGeneratingBeats,
  setIsGeneratingCritique,
  setAuditStatus,
  setGenerationStatus,
  setAiActionState: providedSetAiActionState,
  setUserIntent,
  setCurrentChapter,
  buildAgentContext,
  pushToUndoHistory: _pushToUndoHistory,
  getCurrentFitScore: _getCurrentFitScore,
  recordSkillUsage: _recordSkillUsage,
  formatAiFailure,
  flushPendingEditorWrites,
  setCandidate,
}: UseDraftGenerationArgs) {
  const setAiActionState = providedSetAiActionState ?? (() => undefined);
  const setAiActionStateForRequest = (
    startingChapterId: string | undefined,
    requestSeq: number,
    state: SetStateAction<AiActionState>,
  ) => {
    if (latestChapterIdRef.current === startingChapterId && requestSeqRef.current === requestSeq) {
      setAiActionState(state);
    }
  };

  const handleGenerateBeats = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter) return;

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;

    setIsGeneratingBeats(true);
    setIsGeneratingContent(false);
    setIsGeneratingCritique?.(false);
    setAuditStatus?.(null);
    setGenerationStatus('正在根据创作意图和世界观拆解本章分镜…');
    setAiActionState(createAiActionRunning('beats'));
    try {
      try {
        await flushPendingEditorWrites();
      } catch (error) {
        if (latestChapterIdRef.current === startingChapterId && requestSeqRef.current === currentSeq) {
          setAiActionState((state) => createAiActionError(state, formatAiFailure(error, '分镜生成')));
        }
        return;
      }

      let databaseGeneration: number;
      try {
        databaseGeneration = await getDatabaseGenerationSnapshot(controller.signal);
      } catch (error) {
        if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
        if (error instanceof Error && error.name === 'AbortError') {
          setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
          return;
        }
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, formatAiFailure(error, '分镜生成')));
        return;
      }

      let beats: string;
      try {
        ({ text: beats } = await editorAgentPhase(
          userIntent || `关于章节「${currentChapter.title}」的大纲`,
          buildAgentContext(),
          databaseGeneration,
          selectedContinuationPackId || undefined,
          (progress, _status) => {
            if (latestChapterIdRef.current === startingChapterId && requestSeqRef.current === currentSeq) {
              setGenerationStatus(`正在分镜拆解中 [${progress}%]...`);
            }
          },
          controller.signal,
        ));
      } catch (error) {
        if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
        if (error instanceof Error && error.name === 'AbortError') {
          setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
          return;
        }
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, formatAiFailure(error, '分镜生成')));
        return;
      }

      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      try {
        if (!await updateChapter(currentChapter.id, { sceneBeats: beats }, databaseGeneration)) {
          throw new Error('章节已不存在，分镜未保存。');
        }
      } catch (error) {
        setCurrentChapter((prev) => (
          prev?.id === currentChapter.id ? { ...prev, sceneBeats: currentChapter.sceneBeats } : prev
        ));
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, formatAiFailure(error, '分镜保存')));
        return;
      }

      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCurrentChapter((prev) => (prev?.id === currentChapter.id ? { ...prev, sceneBeats: beats } : prev));
      setUserIntent('');
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionSuccess(state, '场景分镜已生成并保存。'));
    } catch (error) {
      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      if (error instanceof Error && error.name === 'AbortError') {
        setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
        return;
      }
      const message = formatAiFailure(error, '分镜生成');
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, message));
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingBeats(false);
        setGenerationStatus(null);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  const handleGenerateContent = async (fingerprintOverride?: string) => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter || !currentChapter.sceneBeats || isGeneratingContent) return;

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;

    setIsGeneratingContent(true);
    setIsGeneratingBeats(false);
    setIsGeneratingCritique?.(false);
    setAuditStatus?.(null);
    setGenerationStatus('正在整理世界观、人物与分镜…');
    setAiActionState(createAiActionRunning('draft'));

    let completedContent = false;
    let accumulatedGeneratedText = '';
    let baselineContent = currentChapter.content || '';

    try {
      await flushPendingEditorWrites();
      const requestDatabaseGeneration = await getDatabaseGenerationSnapshot(controller.signal);
      const latestContent = contentRef.current?.value ?? currentChapter.content;
      baselineContent = latestContent || '';
      const baseContent = latestContent ? `${latestContent}\n\n` : '';
      const contextStr = buildContextPrompt(buildAgentContext());
      setGenerationStatus('Writer Agent 正在生成 4000 字以上正文…');
      const response = await fetch('/api/orchestrate-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftingSurface: draftPromptSurface,
          contextStr,
          sceneBeats: currentChapter.sceneBeats,
          draftContent: latestContent || '',
          novelId: novel.id,
          chapterId: currentChapter.id,
          databaseGeneration: requestDatabaseGeneration,
          chapterOrder: currentChapter ? currentChapter.order : 1,
          continuationPackId: selectedContinuationPackId || undefined,
          styleConfirmationFingerprint: fingerprintOverride || writingStyleFingerprint || undefined,
          sessionCardIds: sessionCardIds?.length ? sessionCardIds : undefined,
        }),
        signal: controller.signal,
      });

      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;

      if (!response.ok) {
        if (response.status === 409) {
          const styleData = await response.json().catch(() => null);
          if (styleData?.code === 'STYLE_CONFIRMATION_REQUIRED') {
            onStyleConfirmationRequired?.(styleData);
            setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
            return;
          }
        }
        if (response.status === 403) {
          const initData = await response.json().catch(() => null);
          if (initData && initData.quotaExceeded) {
            /* window.dispatchEvent(new CustomEvent('local-capability-unavailable', {
              detail: {
                limitType: initData.limitType,
                count: initData.count,
                max: initData.max,
                error: initData.error,
              }
            })); */
            throw new Error('QUOTA_LIMIT_EXCEEDED');
          }
        }
        const errText = await response.text();
        throw new Error(errText || `HTTP ${response.status}`);
      }

      if (!response.body) throw new Error('No response body');
      const databaseGeneration = requireResponseDatabaseGeneration(response);
      if (databaseGeneration !== requestDatabaseGeneration) {
        throw new Error('数据库已在正文生成期间切换，请刷新后重试。');
      }

      let generationSource: 'model' | 'fallback' = 'model';
      accumulatedGeneratedText = await readDraftStream(response, {
        onStatus: (message) => setGenerationStatus(message),
        onSource: (source) => { generationSource = source; },
        onToken: (token) => {
          accumulatedGeneratedText += token;
          // Stream tokens remain a transient preview. The chapter is untouched until acceptance.
        },
      });

      const generatedText = accumulatedGeneratedText.trim();
      if (!generatedText) {
        throw new Error('AI 没有返回正文内容，请稍后重试或缩短分镜。');
      }
      const fullText = baseContent + generatedText;

      const quality = validateCompleteChapterDraftQuality(fullText);
      if (!quality.ok) {
        throw new Error(`正文候选未通过质量门禁：${quality.violations.join('；')}`);
      }

      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCandidate?.({
        id: `${currentChapter.id}:${currentSeq}:draft`, operation: 'draft', novelId: novel.id,
        chapterId: currentChapter.id, databaseGeneration, createdAt: Date.now(), baselineHash: computeChapterWorkflowHash(baselineContent, currentChapter.sceneBeats),
        baselineContent, content: fullText, quality, source: generationSource,
      });
      completedContent = true;
      setGenerationStatus('正文候选已生成，请接受后保存。');
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionSuccess(state, '正文候选已生成，接受后写入当前章节。'));
    } catch (error) {
      if (!completedContent && latestChapterIdRef.current === startingChapterId && requestSeqRef.current === currentSeq) {
        const baselineWordCount = baselineContent.replace(/\s/g, '').length;
        setCurrentChapter((prev) => (
          prev && prev.id === startingChapterId
            ? { ...prev, content: baselineContent, wordCount: baselineWordCount }
            : prev
        ));
      }
      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      if (error instanceof Error && error.name === 'AbortError') {
        setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
        return;
      }
      const message = error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED'
        ? '正文生成暂不可用，请检查当前能力额度后重试。'
        : formatAiFailure(error, '连续写作');
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, message));
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') return;
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingContent(false);
        if (completedContent) {
          const completedSeq = currentSeq;
          setTimeout(() => {
            if (requestSeqRef.current === completedSeq) setGenerationStatus(null);
          }, 8000);
        } else {
          setGenerationStatus(null);
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  return {
    handleGenerateBeats,
    handleGenerateContent,
  };
}
