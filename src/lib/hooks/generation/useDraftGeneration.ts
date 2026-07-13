import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Novel, Chapter, Skill } from '../../../../shared/types';
import type { AgentContext } from '../../agents';
import { editorAgentPhase, buildContextPrompt } from '../../agents';
import { createChapterVersion, updateChapter } from '../../chapter-client';
import { readDraftStream } from '../../draft-stream';

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
    options?: { fitScore?: number; auditScore?: number; notes?: string; skillIds?: string[] },
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

    let usedFallback = false;
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

      try {
        const beats = await editorAgentPhase(
          userIntent || `关于章节「${currentChapter.title}」的大纲`,
          buildAgentContext(),
          selectedContinuationPackId || undefined,
          (progress, _status) => {
            if (latestChapterIdRef.current === startingChapterId && requestSeqRef.current === currentSeq) {
              setGenerationStatus(`正在分镜拆解中 [${progress}%]...`);
            }
          }
        );

        if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
        setCurrentChapter((prev) => (prev ? { ...prev, sceneBeats: beats } : null));
        if (!await updateChapter(currentChapter.id, { sceneBeats: beats })) {
          throw new Error('章节已不存在，分镜未保存。');
        }
        setUserIntent('');
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        const fallbackBeats = buildClientFallbackSceneBeats(
          userIntent || `关于章节「${currentChapter.title}」的大纲`,
        );
        if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
        setCurrentChapter((prev) => (prev ? { ...prev, sceneBeats: fallbackBeats } : null));
        if (!await updateChapter(currentChapter.id, { sceneBeats: fallbackBeats })) {
          throw new Error('章节已不存在，分镜未保存。', { cause: error });
        }
        usedFallback = true;
        setGenerationStatus('模型响应不稳定，已生成保底分镜，可直接编辑后继续写。');
      }
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingBeats(false);
        if (!usedFallback) {
          setGenerationStatus(null);
        } else {
          setTimeout(() => setGenerationStatus(null), 8000);
        }
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
      });
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
        });
      } catch (error) {
        console.error('[DraftGeneration] Failed to create generated chapter version:', error);
      }
      try {
        await recordSkillUsage('accepted', {
          fitScore: getCurrentFitScore(),
          notes: 'writer-generated',
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

export const buildClientFallbackSceneBeats = (intent: string) =>
  [
    `### 场景 1：异动入场\n\n**核心冲突**：${intent}，但信息并不完整，角色只能先试探。\n\n**关键动作链**：角色观察异常；对方给出含糊回应；一个细节暴露真正风险。\n\n**退场钩子**：新的脚步声、信物或消息把局势推向下一场。`,
    '### 场景 2：试探加深\n\n**核心冲突**：双方围绕真实目的互相遮掩。\n\n**关键动作链**：试探被接住；旧线索浮出；角色意识到眼前不是偶然。\n\n**退场钩子**：关键人物或危险信号正式出现。',
    '### 场景 3：悬念收束\n\n**核心冲突**：保全自身与追查真相发生冲突。\n\n**关键动作链**：角色做出选择；关键道具或信息被确认；局势留下更大的疑问。\n\n**退场钩子**：以一个未解释的动作或声音结束本章。',
  ].join('\n\n---\n\n');
