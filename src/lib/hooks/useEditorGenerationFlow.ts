import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type { AgentContext } from '../agents';
import type { Chapter, Novel, Skill } from '../../types';
import { editorAgentPhase, buildContextPrompt } from '../agents';
import { createChapterVersion, updateChapter } from '../chapter-client';
import { updateNovel } from '../novel-client';
import {
  applyPatchWindow,
  extractPolishTargetsFromCritique,
  removeRepeatedQuotedBlocks,
  selectRewriteTargetsForPatch,
  validatePolishCandidate,
} from '../chapter-polish';

interface UseEditorGenerationFlowArgs {
  novel: Novel;
  currentChapter: Chapter | null;
  mountedSkills: Skill[];
  userIntent: string;
  globalOutline: string;
  expectedWordCount: number | '';
  contentRef: RefObject<HTMLTextAreaElement | null>;
  selectedContinuationPackId: string;
  buildAgentContext: () => AgentContext;
  handleUpdateContent: (newContent: string, isProgrammatic?: boolean) => void;
  pushToUndoHistory: (content: string) => void;
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>;
  setGlobalOutline: Dispatch<SetStateAction<string>>;
  setUserIntent: Dispatch<SetStateAction<string>>;
  getCurrentFitScore: (skillsOverride?: Skill[]) => number;
  recordSkillUsage: (
    userAction: 'accepted' | 'revised' | 'rejected',
    options?: { fitScore?: number; auditScore?: number; notes?: string; skillIds?: string[] },
  ) => Promise<void>;
  formatAiFailure: (error: unknown, actionLabel: string) => string;
}

const draftPromptSurface = 'workspace-draft';
const planningPromptSurface = 'workspace-beats';
const polishPromptSurface = 'chapter-polish';

export function useEditorGenerationFlow({
  novel,
  currentChapter,
  mountedSkills,
  userIntent,
  globalOutline,
  expectedWordCount,
  contentRef,
  selectedContinuationPackId,
  buildAgentContext,
  handleUpdateContent,
  pushToUndoHistory,
  setCurrentChapter,
  setGlobalOutline,
  setUserIntent,
  getCurrentFitScore,
  recordSkillUsage,
  formatAiFailure,
}: UseEditorGenerationFlowArgs) {
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isGeneratingBeats, setIsGeneratingBeats] = useState(false);
  const [isGeneratingCritique, setIsGeneratingCritique] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [auditStatus, setAuditStatus] = useState<string | null>(null);

  const latestChapterIdRef = useRef<string | null>(currentChapter?.id || null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    latestChapterIdRef.current = currentChapter?.id || null;
  }, [currentChapter?.id]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const stopGenerationFlow = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGeneratingContent(false);
    setIsGeneratingBeats(false);
    setIsGeneratingCritique(false);
    setGenerationStatus(null);
    setAuditStatus(null);
  }, []);

  const handleRunAudit = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter) return;

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    setIsGeneratingCritique(true);
    setAuditStatus('正在整理正文与分镜，提交总编审读…');
    try {
      const contextStr = buildContextPrompt(buildAgentContext());
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: polishPromptSurface,
          draftContent: currentChapter.content,
          sceneBeats: currentChapter.sceneBeats,
          contextStr,
          skills: mountedSkills,
        }),
        signal: controller.signal,
      });
      setAuditStatus('总编正在逐段扫描机械感、节奏和人设一致性…');
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      const numericAuditScore = typeof data.score === 'number'
        ? data.score
        : Number(String(data.feedback || '').match(/(\d{2,3})\s*分/)?.[1] || 0) || undefined;

      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCurrentChapter((prev) => (prev ? { ...prev, critique: data.feedback } : null));
      await updateChapter(currentChapter.id, { critique: data.feedback });
      await recordSkillUsage('revised', {
        fitScore: getCurrentFitScore(),
        auditScore: numericAuditScore,
        notes: 'manual-audit',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error(error);
      alert(formatAiFailure(error, 'AI 审计'));
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingCritique(false);
        setAuditStatus(null);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  const handleGenerateBeats = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter) return;

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    let usedFallback = false;
    setIsGeneratingBeats(true);
    setGenerationStatus('正在根据创作意图和世界观拆解本章分镜…');
    try {
      const beats = await editorAgentPhase(
        userIntent || `关于章节「${currentChapter.title}」的大纲`,
        buildAgentContext(),
        selectedContinuationPackId || undefined,
      );

      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCurrentChapter({ ...currentChapter, sceneBeats: beats });
      await updateChapter(currentChapter.id, { sceneBeats: beats });
      setUserIntent('');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error(error);
      const fallbackBeats = buildClientFallbackSceneBeats(
        userIntent || `关于章节「${currentChapter.title}」的大纲`,
      );
      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCurrentChapter((prev) => (prev ? { ...prev, sceneBeats: fallbackBeats } : null));
      await updateChapter(currentChapter.id, { sceneBeats: fallbackBeats });
      usedFallback = true;
      setGenerationStatus('模型响应不稳定，已生成保底分镜，可直接编辑后继续写。');
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

  const handleRewriteSelectedText = async () => {
    const startingChapterId = currentChapter?.id;
    if (!contentRef.current || !currentChapter) return;

    const currentSeq = ++requestSeqRef.current;
    const start = contentRef.current.selectionStart;
    const end = contentRef.current.selectionEnd;
    if (start === end) {
      alert('请先在右侧区域选中一段您需要改写的文字，然后再点击此按钮。');
      return;
    }
    const selectedText = currentChapter.content.substring(start, end);
    const instruction = prompt('请输入改写要求（如：更加通俗易懂，或者更有文学色彩），留空则由 AI 自动润色：');
    if (instruction === null) return;

    setIsGeneratingContent(true);
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: selectedText,
          instruction,
          contextStr: buildContextPrompt(buildAgentContext()),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Rewrite failed.');
      const data = await response.json();

      const newText = currentChapter.content.substring(0, start) + data.text + currentChapter.content.substring(end);
      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      handleUpdateContent(newText, true);

      await createChapterVersion({
        id: Date.now().toString(),
        chapterId: currentChapter.id,
        content: newText,
        wordCount: newText.replace(/\s/g, '').length,
        author: 'user',
        createdAt: Date.now(),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error(error);
      alert('改写失败，请稍后重试。');
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingContent(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  const handleGenerateOutline = async () => {
    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    setIsGeneratingOutline(true);
    try {
      const response = await fetch('/api/generate-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: planningPromptSurface,
          title: novel.title,
          worldRules: novel.worldRules,
          seedOutline: globalOutline,
          expectedWordCount,
          ...(selectedContinuationPackId ? { continuationPackId: selectedContinuationPackId } : {}),
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (requestSeqRef.current !== currentSeq) return;

      if (data.outline) {
        setGlobalOutline(data.outline);
        await updateNovel(novel.id, { globalOutline: data.outline });
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error(error);
      alert('大纲生成失败');
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingOutline(false);
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
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    setIsGeneratingContent(true);
    setGenerationStatus('正在整理世界观、人物与分镜…');

    const baseContent = currentChapter.content ? `${currentChapter.content}\n\n` : '';
    let completedContent = false;

    try {
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
          draftContent: currentChapter.content || '',
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(async () => ({ error: await response.text() }));
        throw new Error(errorPayload.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      const generatedText = String(data.text || '').trim();
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

      await updateChapter(currentChapter.id, {
        content: fullText,
        wordCount: finalWordCount,
      });

      pushToUndoHistory(fullText);

      await createChapterVersion({
        id: Date.now().toString(),
        chapterId: currentChapter.id,
        content: fullText,
        wordCount: finalWordCount,
        author: 'writer-agent',
        createdAt: Date.now(),
      });
      await recordSkillUsage('accepted', {
        fitScore: getCurrentFitScore(),
        notes: 'writer-generated',
      });
      completedContent = true;
      setGenerationStatus('正文已生成到主编辑器。');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error(error);
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

  const handlePolishChapterFromAudit = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter?.content || !currentChapter.critique) {
      alert('请先生成正文并完成一次 AI 审计，再执行精修。');
      return;
    }

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    setIsGeneratingContent(true);
    setGenerationStatus('正在按审计意见定位坏段落…');
    try {
      const baseline = currentChapter.content;
      const { duplicateTargets, rewriteTargets } = extractPolishTargetsFromCritique(currentChapter.critique);

      let candidate = baseline;
      let changed = false;

      if (duplicateTargets.length > 0) {
        const deduped = removeRepeatedQuotedBlocks(candidate, duplicateTargets);
        candidate = deduped.content;
        changed = changed || deduped.removedCount > 0;
      }

      setGenerationStatus('已清理重复段，正在逐段精修关键问题…');

      const actionableTargets = selectRewriteTargetsForPatch(candidate, rewriteTargets, 3, currentChapter.critique);

      if (duplicateTargets.length === 0 && actionableTargets.length === 0) {
        setGenerationStatus(null);
        alert('本轮审计没有定位到可自动修补的明确片段，请先重跑 AI 审计或手动修改。');
        return;
      }

      for (const { snippet } of actionableTargets) {
        if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;

        const window = selectRewriteTargetsForPatch(candidate, [snippet], 1, currentChapter.critique)[0]?.window;
        if (!window) continue;
        const response = await fetch('/api/rewrite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'surgical-patch',
            text: window.targetText,
            beforeContext: window.beforeContext,
            afterContext: window.afterContext,
            auditIssue: snippet,
            instruction: '只修这个局部问题，保持全章剧情顺序和悬念落点不变。',
            contextStr: buildContextPrompt(buildAgentContext()),
            auditFeedback: currentChapter.critique,
            sceneBeats: currentChapter.sceneBeats || '',
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const errorPayload = await response.json().catch(async () => ({ error: await response.text() }));
          throw new Error(errorPayload.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const rewrittenText = String(data.text || '').trim();
        if (!rewrittenText) continue;
        const nextCandidate = applyPatchWindow(candidate, window, rewrittenText);
        changed = changed || nextCandidate !== candidate;
        candidate = nextCandidate;
      }

      if (changed) {
        const guard = validatePolishCandidate(baseline, candidate);
        if (!guard.ok) {
          setGenerationStatus(null);
          alert(`本轮精修结果疑似异常，已取消覆盖：${guard.reason}`);
          return;
        }

        if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
        handleUpdateContent(candidate, true);

        await updateChapter(currentChapter.id, {
          content: candidate,
          wordCount: candidate.replace(/\s/g, '').length,
          critique: '',
        });

        await createChapterVersion({
          id: Date.now().toString(),
          chapterId: currentChapter.id,
          content: candidate,
          wordCount: candidate.replace(/\s/g, '').length,
          author: 'editor-agent',
          createdAt: Date.now(),
        });

        setGenerationStatus('已完成局部精修。建议再跑一次 AI 审计确认效果。');
        setTimeout(() => setGenerationStatus(null), 2500);
      } else {
        setGenerationStatus(null);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error(error);
      alert('精修失败，请重试');
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingContent(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  return {
    isGeneratingContent,
    isGeneratingOutline,
    isGeneratingBeats,
    isGeneratingCritique,
    generationStatus,
    auditStatus,
    handleRunAudit,
    handleGenerateBeats,
    handleRewriteSelectedText,
    handleGenerateOutline,
    handleGenerateContent,
    handlePolishChapterFromAudit,
    stopGenerationFlow,
  };
}

const buildClientFallbackSceneBeats = (intent: string) =>
  [
    `### 场景 1：异动入场\n\n**核心冲突**：${intent}，但信息并不完整，角色只能先试探。\n\n**关键动作链**：角色观察异常；对方给出含糊回应；一个细节暴露真正风险。\n\n**退场钩子**：新的脚步声、信物或消息把局势推向下一场。`,
    '### 场景 2：试探加深\n\n**核心冲突**：双方围绕真实目的互相遮掩。\n\n**关键动作链**：试探被接住；旧线索浮出；角色意识到眼前不是偶然。\n\n**退场钩子**：关键人物或危险信号正式出现。',
    '### 场景 3：悬念收束\n\n**核心冲突**：保全自身与追查真相发生冲突。\n\n**关键动作链**：角色做出选择；关键道具或信息被确认；局势留下更大的疑问。\n\n**退场钩子**：以一个未解释的动作或声音结束本章。',
  ].join('\n\n---\n\n');
