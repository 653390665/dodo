import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Novel, Chapter, Skill } from '../../../../shared/types';
import type { AgentContext } from '../../agents';
import { buildContextPrompt } from '../../agents';
import { createChapterVersion, updateChapter } from '../../chapter-client';
import { readSseStream } from '../../sse-client';
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
  handleUpdateContent: (newContent: string, isProgrammatic?: boolean, skipPersist?: boolean) => void;
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

  const isRequestCurrent = (startingChapterId: string | undefined, currentSeq: number) =>
    latestChapterIdRef.current === startingChapterId && requestSeqRef.current === currentSeq;

  const restorePreviewIfCurrent = (
    baseline: string,
    startingChapterId: string | undefined,
    currentSeq: number,
  ) => {
    if (!isRequestCurrent(startingChapterId, currentSeq)) return;
    handleUpdateContent(baseline, false, true);
  };

  const commitChapterContent = async (
    chapterId: string,
    content: string,
    startingChapterId: string | undefined,
    currentSeq: number,
    extraUpdates: Partial<Chapter> = {},
  ) => {
    if (!isRequestCurrent(startingChapterId, currentSeq)) return;
    setCurrentChapter((prev) => (prev?.id === chapterId ? { ...prev, content, ...extraUpdates } : prev));
    await updateChapter(chapterId, {
      content,
      updatedAt: Date.now(),
      wordCount: content.replace(/\s/g, '').length,
      ...extraUpdates,
    });
  };

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

      const initData = await response.json();

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

      if (initData.error) throw new Error(initData.error);
      const jobId = initData.jobId;
      if (!jobId) throw new Error('Failed to initiate audit job');

      let jobResult: Record<string, unknown> | null = null;
      while (true) {
        if (controller.signal.aborted) throw new Error('AbortError');
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const jobResponse = await fetch(`/api/audit/jobs/${jobId}`, {
          signal: controller.signal,
        });
        if (!jobResponse.ok) {
          throw new Error(`Failed to check audit status: ${jobResponse.status}`);
        }
        const job = await jobResponse.json();

        if (job.status === 'completed') {
          jobResult = job.result;
          break;
        } else if (job.status === 'failed') {
          throw new Error('智能审稿服务异常或超时，请重试。');
        } else {
          const percent = job.progress || 0;
          setAuditStatus(`[${percent}%] ${job.stageText || '总编正在逐段扫描机械感、节奏和人设一致性…'}`);
        }
      }

      if (!jobResult) throw new Error('AI Audit returned no result');

      const numericAuditScore = typeof jobResult.score === 'number'
        ? jobResult.score
        : Number(String(jobResult.feedback || '').match(/(\d{2,3})\s*分/)?.[1] || 0) || undefined;

      const feedbackStr = typeof jobResult.feedback === 'string' ? jobResult.feedback : '';

      if (!isRequestCurrent(startingChapterId, currentSeq)) return;
      setCurrentChapter((prev) => (prev?.id === currentChapter.id ? { ...prev, critique: feedbackStr } : prev));
      await updateChapter(currentChapter.id, { critique: feedbackStr });
      try {
        await recordSkillUsage('revised', {
          fitScore: getCurrentFitScore(),
          auditScore: numericAuditScore,
          notes: 'run-audit-success',
        });
      } catch {
        // Auxiliary telemetry must not roll back committed critique.
      }
      setAuditStatus(null);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') return;
      setAuditStatus(null);
      alert(formatAiFailure(error, '审稿'));
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
    const instruction = prompt('请输入改写要求（如：更加通俗易懂，或者更有文学色彩），留空则由 AI 自动润色：');
    if (instruction === null) return;

    setIsGeneratingContent(true);
    const controller = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;

    const baselineContent = currentChapter.content;

    try {
      const response = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: baselineContent.substring(start, end),
          instruction,
          contextStr: buildContextPrompt(buildAgentContext()),
          novelId: novel.id,
          skills: mountedSkills,
        }),
        signal: controller.signal,
      });

      if (response.status === 403) {
        const data = await response.json().catch(() => ({}));
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
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Rewrite failed.');
      }

      let previewAccum = '';
      const streamResult = await readSseStream(response, (token) => {
        previewAccum += token;
        if (!isRequestCurrent(startingChapterId, currentSeq)) return;
        const preview = baselineContent.substring(0, start) + previewAccum + baselineContent.substring(end);
        handleUpdateContent(preview, false, true);
      });

      if (!streamResult.done) {
        restorePreviewIfCurrent(baselineContent, startingChapterId, currentSeq);
        alert('改写流未正常结束，已恢复原文。');
        return;
      }

      const rewritten = streamResult.text;
      const newText = baselineContent.substring(0, start) + rewritten + baselineContent.substring(end);

      if (!rewritten.trim()) {
        restorePreviewIfCurrent(baselineContent, startingChapterId, currentSeq);
        alert('改写结果为空，已恢复原文。');
        return;
      }

      await commitChapterContent(currentChapter.id, newText, startingChapterId, currentSeq);

      try {
        await createChapterVersion({
          id: Date.now().toString(),
          chapterId: currentChapter.id,
          content: newText,
          wordCount: newText.replace(/\s/g, '').length,
          author: 'user',
          createdAt: Date.now(),
        });
      } catch {
        // Version history failure must not roll back committed content.
      }

      try {
        await recordSkillUsage('accepted', {
          fitScore: getCurrentFitScore(),
          notes: 'text-rewrite-selected',
        });
      } catch {
        // Telemetry failure must not roll back committed content.
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        restorePreviewIfCurrent(baselineContent, startingChapterId, currentSeq);
        return;
      }
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') return;
      restorePreviewIfCurrent(baselineContent, startingChapterId, currentSeq);
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
    const baseline = currentChapter.content;
    try {
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
        if (!isRequestCurrent(startingChapterId, currentSeq)) return;

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

        if (response.status === 403) {
          const data = await response.json().catch(() => ({}));
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
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        let patchPreview = '';
        const streamResult = await readSseStream(response, (token) => {
          patchPreview += token;
          if (!isRequestCurrent(startingChapterId, currentSeq)) return;
          const tempCandidate = applyPatchWindow(candidate, targetWindow, patchPreview);
          handleUpdateContent(tempCandidate, false, true);
        });

        if (!streamResult.done) {
          restorePreviewIfCurrent(baseline, startingChapterId, currentSeq);
          throw new Error('精修流未正常结束');
        }

        const rewrittenText = streamResult.text.trim();
        if (!rewrittenText) continue;
        candidate = applyPatchWindow(candidate, targetWindow, rewrittenText);
        changed = changed || candidate !== baseline;

        if (!isRequestCurrent(startingChapterId, currentSeq)) return;
        handleUpdateContent(candidate, false, true);
      }

      if (changed) {
        const guard = validatePolishCandidate(baseline, candidate);
        if (!guard.ok) {
          restorePreviewIfCurrent(baseline, startingChapterId, currentSeq);
          setGenerationStatus(null);
          alert(`本轮精修结果疑似异常，已取消覆盖：${guard.reason}`);
          return;
        }

        if (!isRequestCurrent(startingChapterId, currentSeq)) return;

        await commitChapterContent(currentChapter.id, candidate, startingChapterId, currentSeq, { critique: '' });

        try {
          await createChapterVersion({
            id: Date.now().toString(),
            chapterId: currentChapter.id,
            content: candidate,
            wordCount: candidate.replace(/\s/g, '').length,
            author: 'editor-agent',
            createdAt: Date.now(),
          });
        } catch {
          // Version history failure must not roll back committed content.
        }

        try {
          await recordSkillUsage('accepted', {
            fitScore: getCurrentFitScore(),
            notes: 'polish-critique-patch',
          });
        } catch {
          // Telemetry failure must not roll back committed content.
        }

        setGenerationStatus('已完成局部精修。建议再跑一次 AI 审计确认效果。');
        setTimeout(() => setGenerationStatus(null), 2500);
      } else {
        setGenerationStatus(null);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        restorePreviewIfCurrent(baseline, startingChapterId, currentSeq);
        return;
      }
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') return;
      restorePreviewIfCurrent(baseline, startingChapterId, currentSeq);
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
