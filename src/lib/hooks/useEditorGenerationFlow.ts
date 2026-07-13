import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type { AgentContext } from '../agents';
import type { Chapter, Novel, Skill } from '../../../shared/types';
import { useOutlineGeneration } from './generation/useOutlineGeneration';
import { useDraftGeneration } from './generation/useDraftGeneration';
import { useAuditPolishActions } from './generation/useAuditPolishActions';

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
  flushPendingEditorWrites: () => Promise<void>;
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
  flushPendingEditorWrites,
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

  // 1. 挂载大纲生成子 Hook
  const { handleGenerateOutline } = useOutlineGeneration({
    novel,
    globalOutline,
    expectedWordCount,
    currentChapter,
    selectedContinuationPackId,
    planningPromptSurface,
    requestSeqRef,
    abortControllerRef,
    setIsGeneratingOutline,
    setGlobalOutline,
  });

  // 2. 挂载正文与分镜生成子 Hook
  const { handleGenerateBeats, handleGenerateContent } = useDraftGeneration({
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
    getCurrentFitScore: () => getCurrentFitScore(),
    recordSkillUsage,
    formatAiFailure,
    flushPendingEditorWrites,
  });

  // 3. 挂载智能审计、精修及手术重写子 Hook
  const { handleRunAudit, handleRewriteSelectedText, handlePolishChapterFromAudit } = useAuditPolishActions({
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
    getCurrentFitScore: () => getCurrentFitScore(),
    recordSkillUsage,
    formatAiFailure,
    flushPendingEditorWrites,
  });

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
