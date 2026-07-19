import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Novel, Chapter, Skill } from '../../../../shared/types';
import type { AgentContext } from '../../agents';
import { editorAgentPhase, buildContextPrompt } from '../../agents';
import { createChapterVersion, updateChapter } from '../../chapter-client';
import { readDraftStream } from '../../draft-stream';
import { getDatabaseGenerationSnapshot, requireResponseDatabaseGeneration } from '../../db-transport';

interface UseDraftGenerationArgs {
  novel: Novel;
  currentChapter: Chapter | null;
  mountedSkills: Skill[];
  userIntent: string;
  selectedContinuationPackId: string;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  draftPromptSurface: string;
  requestSeqRef: { current: number };
  abortControllerRef: { current: AbortController | null };
  latestChapterIdRef: { current: string | null };
  isGeneratingContent: boolean;
  setIsGeneratingContent: (val: boolean) => void;
  setIsGeneratingBeats: (val: boolean) => void;
  setGenerationStatus: (val: string | null) => void;
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
}

export function useDraftGeneration({
  novel,
  currentChapter,
  mountedSkills,
  userIntent,
  selectedContinuationPackId,
  contentRef,
  draftPromptSurface,
  requestSeqRef,
  abortControllerRef,
  latestChapterIdRef,
  isGeneratingContent,
  setIsGeneratingContent,
  setIsGeneratingBeats,
  setGenerationStatus,
  setUserIntent,
  setCurrentChapter,
  buildAgentContext,
  pushToUndoHistory,
  getCurrentFitScore,
  recordSkillUsage,
  formatAiFailure,
  flushPendingEditorWrites,
}: UseDraftGenerationArgs) {

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
    setGenerationStatus('正在根据创作意图和世界观拆解本章分镜…');
    try {
      try {
        await flushPendingEditorWrites();
      } catch (error) {
        if (latestChapterIdRef.current === startingChapterId && requestSeqRef.current === currentSeq) {
          alert(`正文保存失败，未开始生成分镜：${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }

      let databaseGeneration: number;
      try {
        databaseGeneration = await getDatabaseGenerationSnapshot(controller.signal);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        alert(`无法建立安全的数据库写入边界：${error instanceof Error ? error.message : String(error)}`);
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
        if (error instanceof Error && error.name === 'AbortError') return;
        alert(`分镜生成失败，未修改当前章节：${error instanceof Error ? error.message : String(error)}`);
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
        alert(`分镜保存失败，已保留原分镜：${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      setCurrentChapter((prev) => (prev ? { ...prev, sceneBeats: beats } : null));
      setUserIntent('');
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

  const handleGenerateContent = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter || !currentChapter.sceneBeats || isGeneratingContent) return;

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;

    setIsGeneratingContent(true);
    setGenerationStatus('正在整理世界观、人物与分镜…');

    let completedContent = false;
    let accumulatedGeneratedText = '';
    let baselineContent = currentChapter.content || '';

    try {
      await flushPendingEditorWrites();
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
          skills: mountedSkills,
          draftContent: latestContent || '',
          novelId: novel.id,
          chapterOrder: currentChapter ? currentChapter.order : 1,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 403) {
          const initData = await response.json().catch(() => null);
          if (initData && initData.quotaExceeded) {
            window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
              detail: {
                limitType: initData.limitType,
                count: initData.count,
                max: initData.max,
                error: initData.error,
              }
            }));
            throw new Error('QUOTA_LIMIT_EXCEEDED');
          }
        }
        const errText = await response.text();
        throw new Error(errText || `HTTP ${response.status}`);
      }

      if (!response.body) throw new Error('No response body');
      const databaseGeneration = requireResponseDatabaseGeneration(response);

      accumulatedGeneratedText = await readDraftStream(response, {
        onStatus: (message) => setGenerationStatus(message),
        onToken: (token) => {
          accumulatedGeneratedText += token;
          const fullText = baseContent + accumulatedGeneratedText;
          const currentWords = fullText.replace(/\s/g, '').length;
          if (latestChapterIdRef.current === startingChapterId && requestSeqRef.current === currentSeq) {
            setCurrentChapter((prev) => (
              prev ? { ...prev, content: fullText, wordCount: currentWords } : null
            ));
          }
        },
      });

      const generatedText = accumulatedGeneratedText.trim();
      if (!generatedText) {
        throw new Error('AI 没有返回正文内容，请稍后重试或缩短分镜。');
      }
      const fullText = baseContent + generatedText;
      const finalWordCount = fullText.replace(/\s/g, '').length;

      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCurrentChapter((prev) => (
        prev
          ? {
              ...prev,
              content: fullText,
              wordCount: finalWordCount,
            }
          : null
      ));

      const saved = await updateChapter(currentChapter.id, {
        content: fullText,
        wordCount: finalWordCount,
      }, databaseGeneration);
      if (!saved) throw new Error('章节已不存在，生成正文未保存。');

      // The chapter body is the authoritative delivery boundary. Auxiliary
      // version/telemetry failures must not roll back an already saved draft.
      completedContent = true;
      pushToUndoHistory(fullText);

      try {
        await createChapterVersion({
          id: Date.now().toString(),
          chapterId: currentChapter.id,
          content: fullText,
          wordCount: finalWordCount,
          author: 'writer-agent',
          createdAt: Date.now(),
        }, databaseGeneration);
      } catch (error) {
        console.error('[DraftGeneration] Failed to create generated chapter version:', error);
      }
      try {
        await recordSkillUsage('accepted', {
          fitScore: getCurrentFitScore(),
          notes: 'writer-generated',
          databaseGeneration,
        });
      } catch (error) {
        console.error('[DraftGeneration] Failed to record generated draft usage:', error);
      }
      setGenerationStatus('正文已生成到主编辑器。');
    } catch (error) {
      if (!completedContent && latestChapterIdRef.current === startingChapterId && requestSeqRef.current === currentSeq) {
        const baselineWordCount = baselineContent.replace(/\s/g, '').length;
        setCurrentChapter((prev) => (
          prev && prev.id === startingChapterId
            ? { ...prev, content: baselineContent, wordCount: baselineWordCount }
            : prev
        ));
      }
      if (error instanceof Error && error.name === 'AbortError') return;
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') return;
      alert(formatAiFailure(error, '连续写作'));
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingContent(false);
        if (completedContent) {
          setTimeout(() => setGenerationStatus(null), 8000);
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
