import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Novel, Chapter, Skill } from '../../../../shared/types';
import type { AgentContext } from '../../agents';
import { buildContextPrompt } from '../../agents';
import { createChapterVersion, updateChapter } from '../../chapter-client';
import {
  applyPatchWindow,
  extractPolishTargetsFromCritique,
  removeRepeatedQuotedBlocks,
  selectRewriteTargetsForPatch,
  validatePolishCandidate,
} from '../../chapter-polish.js';

interface UseAuditPolishActionsArgs {
  novel: Novel;
  currentChapter: Chapter | null;
  mountedSkills: Skill[];
  contentRef: RefObject<HTMLTextAreaElement | null>;
  polishPromptSurface: string;
  requestSeqRef: { current: number };
  abortControllerRef: { current: AbortController | null };
  latestChapterIdRef: { current: string | null };
  setIsGeneratingContent: (val: boolean) => void;
  setIsGeneratingCritique: (val: boolean) => void;
  setGenerationStatus: (val: string | null) => void;
  setAuditStatus: (val: string | null) => void;
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>;
  buildAgentContext: () => AgentContext;
  handleUpdateContent: (newContent: string, isProgrammatic?: boolean) => void;
  getCurrentFitScore: () => number;
  recordSkillUsage: (
    userAction: 'accepted' | 'revised' | 'rejected',
    options?: { fitScore?: number; auditScore?: number; notes?: string; skillIds?: string[] },
  ) => Promise<void>;
  formatAiFailure: (error: unknown, actionLabel: string) => string;
}

export function useAuditPolishActions({
  novel,
  currentChapter,
  mountedSkills,
  contentRef,
  polishPromptSurface,
  requestSeqRef,
  abortControllerRef,
  latestChapterIdRef,
  setIsGeneratingContent,
  setIsGeneratingCritique,
  setGenerationStatus,
  setAuditStatus,
  setCurrentChapter,
  buildAgentContext,
  handleUpdateContent,
  getCurrentFitScore,
  recordSkillUsage,
  formatAiFailure,
}: UseAuditPolishActionsArgs) {

  const handleRunAudit = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter) return;

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
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
          novelId: novel.id,
          chapterOrder: currentChapter ? currentChapter.order : 1,
        }),
        signal: controller.signal,
      });
      setAuditStatus('总编正在逐段扫描机械感、节奏和人设一致性…');
      const data = await response.json();

      if (data && data.quotaExceeded) {
        window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
          detail: {
            limitType: data.limitType,
            count: data.count,
            max: data.max,
            error: data.error,
          }
        }));
        throw new Error('QUOTA_LIMIT_EXCEEDED');
      }

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
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') return;
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
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: selectedText,
          instruction,
          contextStr: buildContextPrompt(buildAgentContext()),
          novelId: novel.id,
          skills: mountedSkills,
        }),
        signal: controller.signal,
      });
      const data = await response.json();

      if (data && data.quotaExceeded) {
        window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
          detail: {
            limitType: data.limitType,
            count: data.count,
            max: data.max,
            error: data.error,
          }
        }));
        throw new Error('QUOTA_LIMIT_EXCEEDED');
      }

      if (!response.ok || data.error) throw new Error(data.error || 'Rewrite failed.');

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

      await recordSkillUsage('accepted', {
        fitScore: getCurrentFitScore(),
        notes: 'text-rewrite-selected',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') return;
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

  const handlePolishChapterFromAudit = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter?.content || !currentChapter.critique) {
      alert('请先生成正文并完成一次 AI 审计，再执行精修。');
      return;
    }

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
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

        const targetWindow = selectRewriteTargetsForPatch(candidate, [snippet], 1, currentChapter.critique)[0]?.window;
        if (!targetWindow) continue;
        const response = await fetch('/api/rewrite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'surgical-patch',
            text: targetWindow.targetText,
            beforeContext: targetWindow.beforeContext,
            afterContext: targetWindow.afterContext,
            auditIssue: snippet,
            instruction: '只修这个局部问题，保持全章剧情顺序和悬念落点不变。',
            contextStr: buildContextPrompt(buildAgentContext()),
            auditFeedback: currentChapter.critique,
            sceneBeats: currentChapter.sceneBeats || '',
            novelId: novel.id,
            skills: mountedSkills,
          }),
          signal: controller.signal,
        });
        const data = await response.json();

        if (data && data.quotaExceeded) {
          window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
            detail: {
              limitType: data.limitType,
              count: data.count,
              max: data.max,
              error: data.error,
            }
          }));
          throw new Error('QUOTA_LIMIT_EXCEEDED');
        }

        if (!response.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        const rewrittenText = String(data.text || '').trim();
        if (!rewrittenText) continue;
        const nextCandidate = applyPatchWindow(candidate, targetWindow, rewrittenText);
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

        await recordSkillUsage('accepted', {
          fitScore: getCurrentFitScore(),
          notes: 'polish-critique-patch',
        });

        setGenerationStatus('已完成局部精修。建议再跑一次 AI 审计确认效果。');
        setTimeout(() => setGenerationStatus(null), 2500);
      } else {
        setGenerationStatus(null);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') return;
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
    handleRunAudit,
    handleRewriteSelectedText,
    handlePolishChapterFromAudit,
  };
}
