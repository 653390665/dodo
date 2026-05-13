import React, { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import {
  ChevronLeft,
  Settings,
  Save,
  Plus,
  Trash2,
  FileText,
  PanelRight,
  Maximize2,
  Minimize2,
  Cloud,
  Bot,
  Brain,
  MessageSquareWarning,
  Sparkles,
  Loader2,
  ListOrdered,
  Feather,
  History,
  Globe,
  Search,
  Wand2,
  CheckCircle2,
  Radar,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Folder,
  FolderOpen,
  X,
  Lightbulb,
  Eye,
  Activity,
  Download
} from 'lucide-react';
import { Novel, Chapter, Character, Item, Location, ChapterVersion, Skill, TimelineEvent, Faction, PowerLevel, MountedSkillLoadoutItem, CopilotActionKey, ProjectPreferenceProfile, SkillUsageRecord, ChapterProductionRun, AssistantLaunchContext, AgentTab, SniffedEntities } from '../types';
import {
  listChapters, createChapter, updateChapter, deleteChapter,
  listCharacters, createCharacter,
  listLocations, createLocation,
  listItems, createItem,
  listFactions,
  listPowerLevels,
  listTimelineEvents,
  listChapterVersions, createChapterVersion,
  syncSkillFeedbackScores, updateNovel, getNovel, createSkillUsageRecord, listSkillUsageRecords,
  subscribeToChanges, startChapterProductionRun, applyChapterProductionRun
} from '../lib/api';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { UndoState, createUndoState, pushToHistory, undo, redo } from '../lib/undo-history';
import { editorAgentPhase, writerAgentPhase, criticAgentPhase, AgentContext, buildContextPrompt, SceneType } from '../lib/agents';
import ReactMarkdown from 'react-markdown';
import { IdeaFragmentBoard } from './IdeaFragmentBoard';
import { ForeshadowingPanel } from './ForeshadowingPanel';
import { PacingDashboard } from './PacingDashboard';
import { ProductionRunReview } from './ProductionRunReview';
import { ChapterSidebar } from './ChapterSidebar';
import { EditorHeader } from './EditorHeader';
import { AgentWorkspace } from './AgentWorkspace';
import { WritingSurface } from './WritingSurface';
import { SkillLoadoutBoard } from './skills/SkillLoadoutBoard';
import { ProjectPreferencePanel } from './skills/ProjectPreferencePanel';
import { CopilotStatusBar } from './copilot/CopilotStatusBar';
import { CopilotHomePanel } from './copilot/CopilotHomePanel';
import { coerceMountedSkillLoadout, calculateSkillFitScore } from '../lib/skill-model';
import { deriveSkillFitNeeds } from '../lib/skill-fit-language';
import { useEditorData } from '../lib/hooks/useEditorData';
import { useChapterUndo } from '../lib/hooks/useChapterUndo';
import { buildCopilotSuggestion, type CopilotInput } from '../lib/copilot-stage';
import {
  applyPatchWindow,
  extractPolishTargetsFromCritique,
  removeRepeatedQuotedBlocks,
  selectRewriteTargetsForPatch,
  validatePolishCandidate,
} from '../lib/chapter-polish';


interface EditorViewProps {
  novel: Novel;
  onBack: () => void;
  onOpenAssistant?: (context: AssistantLaunchContext) => void;
}

export function EditorView({ novel, onBack, onOpenAssistant }: EditorViewProps) {
  const {
    chapters, setChapters,
    currentChapter, setCurrentChapter,
    characters, setCharacters,
    locations, setLocations,
    items, setItems,
    factions, setFactions,
    powerLevels, setPowerLevels,
    timelineEvents, setTimelineEvents,
    librarySkills, setLibrarySkills,
    skillUsageRecords, setSkillUsageRecords,
    mountedSkillLoadout, setMountedSkillLoadout,
    projectPreferenceProfile, setProjectPreferenceProfile,
    isLoading: isEditorDataLoading,
  } = useEditorData(novel.id);

  const [isGeneratingContent, setIsGeneratingContent] = useState(false);

  const {
    undoState,
    pushToUndoHistory,
    handleUndo,
    handleRedo,
    resetUndoHistory,
  } = useChapterUndo({
    currentContent: currentChapter?.content || '',
    isGeneratingContent,
    onUndoRedo: (content) => handleUpdateContent(content, true),
  });

  const draftPromptSurface = 'workspace-draft';
  const planningPromptSurface = 'workspace-beats';
  const polishPromptSurface = 'chapter-polish';
  const reviewPromptSurface = 'chapter-review';

  const statusTimeFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }),
    []
  );

  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedVolumes, setExpandedVolumes] = useState<string[]>(['正文卷']);
  const [isAgentSidebarOpen, setIsAgentSidebarOpen] = useState(false);
  const [agentTab, setAgentTab] = useState<AgentTab>('copilot-home');
  const [bibleSearch, setBibleSearch] = useState('');
  const [globalOutline, setGlobalOutline] = useState(novel.globalOutline || '');
  const [expectedWordCount, setExpectedWordCount] = useState<number | ''>('');
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isGeneratingBeats, setIsGeneratingBeats] = useState(false);
  const [isGeneratingCritique, setIsGeneratingCritique] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [auditStatus, setAuditStatus] = useState<string | null>(null);
  const [productionIntent, setProductionIntent] = useState('');
  const [activeProductionRun, setActiveProductionRun] = useState<ChapterProductionRun | null>(null);
  const [isProductionRunning, setIsProductionRunning] = useState(false);
  const [isApplyingProductionRun, setIsApplyingProductionRun] = useState(false);
  const [productionError, setProductionError] = useState<string | null>(null);

  // Entity Sniffing
  const [isSniffing, setIsSniffing] = useState(false);
  const [sniffedEntities, setSniffedEntities] = useState<SniffedEntities | null>(null);
  const [addingEntityNames, setAddingEntityNames] = useState<string[]>([]);
  const [userIntent, setUserIntent] = useState('');

  const buildAssistantLaunchContext = (): AssistantLaunchContext => {
    const selectionStart = contentRef.current?.selectionStart ?? 0;
    const selectionEnd = contentRef.current?.selectionEnd ?? 0;
    const selectedText =
      contentRef.current && currentChapter
        ? currentChapter.content.substring(selectionStart, selectionEnd).trim()
        : '';

    return {
      source: 'workspace',
      novelId: novel.id,
      novelTitle: novel.title,
      novelSummary: novel.summary,
      chapterId: currentChapter?.id,
      chapterTitle: currentChapter?.title || '未命名章节',
      sceneBeats: currentChapter?.sceneBeats || '',
      currentExcerpt: currentChapter?.content?.slice(-240) || '',
      selectedText,
      selectionStart,
      selectionEnd,
      intent:
        selectedText
          ? '围绕这段已选内容，给出可直接用于当前章节的扩写、冲突升级或改写建议。'
          : `围绕当前章节「${currentChapter?.title || '未命名章节'}」给出下一步创作建议。`,
    };
  };

  const formatAiFailure = (error: unknown, actionLabel: string) => {
    const raw = error instanceof Error ? error.message : String(error);
    if (
      raw.includes('502') ||
      raw.includes('503') ||
      raw.includes('504') ||
      raw.includes('Bad Gateway') ||
      raw.includes('timed out') ||
      raw.includes('fetch failed') ||
      raw.includes('UND_ERR_SOCKET')
    ) {
      return `${actionLabel}失败：上游模型服务当前不稳定或响应过慢。你的配置没有丢，可以稍后重试，或先缩短上下文再生成。`;
    }
    return `${actionLabel}失败：${raw}`;
  };

  const handleAddSniffedEntity = async (ent: any) => {
    setAddingEntityNames(prev => [...prev, ent.name]);
    try {
      const response = await fetch('/api/generate-entity-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ent)
      });
      const data = await response.json();

      const now = Date.now();

      if (data.entityType === 'character') {
         await createCharacter({
           id: Date.now().toString(),
           novelId: novel.id,
           name: data.name,
           role: data.role || 'supporting',
           summary: data.summary || '',
           traits: data.traits || [],
           bio: data.bio || '',
           createdAt: now,
           updatedAt: now
         });
      } else if (data.entityType === 'location') {
         await createLocation({
           id: Date.now().toString(),
           novelId: novel.id,
           name: data.name,
           region: data.region || '',
           description: data.description || '',
           createdAt: now,
           updatedAt: now
         });
      } else if (data.entityType === 'item') {
         await createItem({
           id: Date.now().toString(),
           novelId: novel.id,
           name: data.name,
           type: data.type || '',
           description: data.description || '',
           createdAt: now,
           updatedAt: now
         });
      }

      // Remove from sniffedEntities.newEntities
      setSniffedEntities(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          newEntities: prev.newEntities.filter(e => e.name !== ent.name)
        };
      });
    } catch (error) {
       console.error("Failed to add entity", error);
       alert("添加失败：" + (error as Error).message);
    } finally {
       setAddingEntityNames(prev => prev.filter(n => n !== ent.name));
    }
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const isAnyGenerating = isGeneratingContent || isGeneratingBeats || isGeneratingCritique || isSniffing || isGeneratingOutline;
  const [isFullscreen, setIsFullscreen] = useState(false);

  const mountedSkillIds = React.useMemo(
    () => mountedSkillLoadout.slice().sort((a, b) => a.slot - b.slot).map((entry) => entry.skillId),
    [mountedSkillLoadout],
  );
  const mountedSkills = React.useMemo(
    () =>
      mountedSkillIds
        .map((skillId) => librarySkills.find((skill) => skill.id === skillId))
        .filter((skill): skill is Skill => Boolean(skill)),
    [librarySkills, mountedSkillIds]
  );
  const isChapterEmpty = !currentChapter?.content || currentChapter.content.trim() === '';

  const contentRef = useRef<HTMLTextAreaElement>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const beatsSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const outlineSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const titleSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const latestChapterIdRef = useRef<string | null>(currentChapter?.id || null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef<number>(0);

  const stopGeneration = useCallback(() => {
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

  useEffect(() => {
    latestChapterIdRef.current = currentChapter?.id || null;
    // Auto-stop generation if chapter changes? Optional, but user may want it.
    // stopGeneration();
  }, [currentChapter?.id]);

  useEffect(() => {
    return () => {
      stopGeneration();
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (beatsSyncTimeoutRef.current) clearTimeout(beatsSyncTimeoutRef.current);
      if (outlineSyncTimeoutRef.current) clearTimeout(outlineSyncTimeoutRef.current);
      if (titleSyncTimeoutRef.current) clearTimeout(titleSyncTimeoutRef.current);
    };
  }, []);

  // Reset undo history when chapter changes
  useEffect(() => {
    if (currentChapter) {
      resetUndoHistory(currentChapter.content);
    }
  }, [currentChapter?.id, resetUndoHistory]);

  useEffect(() => {
    setIsAgentSidebarOpen(false);
  }, [novel?.id]);

  useEffect(() => {
    window.inkflow?.setTitle(novel?.title || '');
  }, [novel?.title]);

  useEffect(() => {
    if (!isAgentSidebarOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAgentSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAgentSidebarOpen]);

  const persistSkillLoadout = async (nextLoadout: MountedSkillLoadoutItem[]) => {
    const nextIds = nextLoadout.slice().sort((a, b) => a.slot - b.slot).map((entry) => entry.skillId);
    setMountedSkillLoadout(nextLoadout);
    await updateNovel(novel.id, {
      mountedSkillIds: nextIds,
      mountedSkillLoadout: nextLoadout,
    });
  };

  const persistProjectPreferenceProfile = async (profile: ProjectPreferenceProfile) => {
    setProjectPreferenceProfile(profile);
    await updateNovel(novel.id, {
      projectPreferenceProfile: profile,
    });
  };

  const getCurrentFitScore = (skillsOverride = mountedSkills) => {
    const needs = deriveSkillFitNeeds(novel, currentChapter);
    return calculateSkillFitScore({
      requiredDimensions: needs.requiredDimensions,
      chapterSignals: needs.chapterSignals,
      loadout: skillsOverride,
    }).totalScore;
  };

  const copilotInput = React.useMemo<CopilotInput>(() => ({
    hasCurrentChapter: Boolean(currentChapter),
    hasSummary: Boolean(novel.summary?.trim()),
    hasGlobalOutline: Boolean(novel.globalOutline?.trim()),
    hasWorldRules: Boolean(novel.worldRules?.trim()),
    hasSceneBeats: Boolean(currentChapter?.sceneBeats?.trim()),
    hasChapterContent: Boolean(currentChapter?.content?.trim()),
    hasCritique: Boolean(currentChapter?.critique?.trim()),
    hasSniffedNewEntities: Boolean(sniffedEntities?.newEntities?.length),
    mountedSkillCount: mountedSkillLoadout.length,
    fitScore: getCurrentFitScore(),
    lastFocusArea: agentTab === 'copilot-home' ? 'editor' : agentTab,
  }), [
    agentTab,
    currentChapter,
    mountedSkillLoadout.length,
    novel.globalOutline,
    novel.summary,
    novel.worldRules,
    sniffedEntities?.newEntities?.length,
  ]);

  const copilotSuggestion = React.useMemo(
    () => buildCopilotSuggestion(copilotInput),
    [copilotInput],
  );

  const runCopilotAction = async (actionKey: CopilotActionKey) => {
    switch (actionKey) {
      case 'fill-setup':
      case 'open-bible':
        setAgentTab('bible');
        setIsAgentSidebarOpen(true);
        return;
      case 'generate-beats':
        setAgentTab('planning');
        setIsAgentSidebarOpen(true);
        await handleGenerateBeats();
        return;
      case 'generate-draft':
        setAgentTab('planning');
        setIsAgentSidebarOpen(true);
        await handleGenerateContent();
        return;
      case 'run-audit':
      case 'open-quality':
        setAgentTab('quality');
        setIsAgentSidebarOpen(true);
        if (actionKey === 'run-audit') {
          await handleRunAudit();
        }
        return;
      case 'run-polish':
        setAgentTab('quality');
        setIsAgentSidebarOpen(true);
        await handlePolishChapterFromAudit();
        return;
      case 'sync-memory':
        setAgentTab('trace');
        setIsAgentSidebarOpen(true);
        await handleSniffEntities();
        return;
      case 'open-skills':
        setAgentTab('skills');
        setIsAgentSidebarOpen(true);
        return;
      case 'open-planning':
        setAgentTab('planning');
        setIsAgentSidebarOpen(true);
        return;
      default:
        return;
    }
  };

  const handleStartProductionRun = async () => {
    setIsProductionRunning(true);
    setProductionError(null);
    try {
      const run = await startChapterProductionRun({
        novelId: novel.id,
        targetChapterId: currentChapter?.id,
        userIntent: productionIntent,
      });
      setActiveProductionRun(run);
      setAgentTab('production');
      setIsAgentSidebarOpen(true);
    } catch (error) {
      setProductionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsProductionRunning(false);
    }
  };

  const handleApplyProductionRun = async () => {
    if (!activeProductionRun) return;
    setIsApplyingProductionRun(true);
    setProductionError(null);
    try {
      const result = await applyChapterProductionRun(activeProductionRun.id);
      const freshChapters = await listChapters(novel.id);
      setChapters(freshChapters);
      setCurrentChapter(
        freshChapters.find((chapter) => chapter.id === result.chapterId) || freshChapters[0] || null,
      );
      setActiveProductionRun({
        ...activeProductionRun,
        status: 'applied',
        targetChapterId: result.chapterId,
      });
    } catch (error) {
      setProductionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplyingProductionRun(false);
    }
  };

  const recordSkillUsage = async (
    userAction: 'accepted' | 'revised' | 'rejected',
    options?: { fitScore?: number; auditScore?: number; notes?: string; skillIds?: string[] },
  ) => {
    const skillIds = options?.skillIds || mountedSkills.map((skill) => skill.id);
    if (skillIds.length === 0) return;
    await createSkillUsageRecord({
      id: crypto.randomUUID(),
      novelId: novel.id,
      chapterId: currentChapter?.id,
      mountedSkillIds: skillIds,
      fitScore: options?.fitScore ?? getCurrentFitScore(),
      auditScore: options?.auditScore,
      userAction,
      notes: options?.notes,
      createdAt: Date.now(),
    });
  };

  const assignSkillToSlot = async (slot: number, skillId: string) => {
    const previousSkills = mountedSkillLoadout
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => librarySkills.find((skill) => skill.id === entry.skillId))
      .filter((skill): skill is Skill => Boolean(skill));
    const previousIds = mountedSkillLoadout
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => entry.skillId);
    const existingElsewhere = mountedSkillLoadout.find((entry) => entry.skillId === skillId);
    const nextLoadout = mountedSkillLoadout
      .filter((entry) => entry.slot !== slot && entry.skillId !== skillId)
      .map((entry) =>
        existingElsewhere && entry.slot === existingElsewhere.slot
          ? { ...entry, slot }
          : entry,
      );

    nextLoadout.push({
      slot,
      skillId,
      weight: 1,
      lockedDimensions: [],
    });

    await persistSkillLoadout(nextLoadout.sort((a, b) => a.slot - b.slot));
    if (previousIds.length > 0 && previousIds.join(',') !== nextLoadout.map((entry) => entry.skillId).sort().join(',')) {
      await recordSkillUsage('rejected', {
        fitScore: getCurrentFitScore(previousSkills),
        notes: `slot-${slot}-replaced`,
        skillIds: previousIds,
      });
    }
  };

  const removeSkillFromSlot = async (slot: number) => {
    const previousSkills = mountedSkillLoadout
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => librarySkills.find((skill) => skill.id === entry.skillId))
      .filter((skill): skill is Skill => Boolean(skill));
    const previousIds = mountedSkillLoadout
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => entry.skillId);
    const nextLoadout = mountedSkillLoadout.filter((entry) => entry.slot !== slot);
    await persistSkillLoadout(nextLoadout);
    if (previousIds.length > 0) {
      await recordSkillUsage('rejected', {
        fitScore: getCurrentFitScore(previousSkills),
        notes: `slot-${slot}-removed`,
        skillIds: previousIds,
      });
    }
  };

  useEffect(() => {
    if (!currentChapter) {
      setVersions([]);
      return;
    }
    const fetchVersions = async () => {
      setVersions(await listChapterVersions(currentChapter.id));
    };
    fetchVersions();
    return subscribeToChanges(fetchVersions);
  }, [currentChapter?.id]);

  const handleSaveVersion = async (author: 'user' | 'writer-agent' | 'editor-agent' | 'auto') => {
    if (!currentChapter) return;
    await createChapterVersion({
      id: Date.now().toString(),
      chapterId: currentChapter.id,
      content: currentChapter.content,
      wordCount: currentChapter.wordCount,
      author,
      createdAt: Date.now()
    });
  };

  const handleRestoreVersion = (version: ChapterVersion) => {
    if (!confirm('确定要回滚到此版本吗？这将覆盖当前正文内容！')) return;
    handleUpdateContent(version.content, true);
  };

  const detectSceneType = (): SceneType | undefined => {
    const signals = (userIntent || '') + (currentChapter?.content?.slice(-500) || '');
    const dialogueScore = (signals.match(/对话|对白|说|问|答|谈|聊|争吵|质问|试探|回答/g) || []).length;
    const actionScore = (signals.match(/打|战|杀|追|逃|冲|砍|刺|闪|躲|搏|斗|出手/g) || []).length;
    const politicsScore = (signals.match(/势力|门派|权力|计谋|算计|联合|背叛|交易|谈判|布局/g) || []).length;
    const emotionalScore = (signals.match(/情感|心痛|回忆|思念|悲伤|眼泪|孤独|拥抱|温暖|感动|沉默/g) || []).length;

    const scores: { type: SceneType; score: number }[] = [
      { type: 'dialogue', score: dialogueScore },
      { type: 'action', score: actionScore },
      { type: 'politics', score: politicsScore },
      { type: 'emotional', score: emotionalScore },
    ];
    const best = scores.reduce((a, b) => a.score > b.score ? a : b);
    return best.score >= 3 ? best.type : undefined;
  };

  const buildAgentContext = (): AgentContext => {
    let previousChaptersSummary = '';
    if (currentChapter) {
       const previousChapters = chapters
        .filter(c => c.order < currentChapter.order)
        .sort((a, b) => b.order - a.order)
        .slice(0, 3) // last 3 chapters
        .reverse();

       if (previousChapters.length > 0) {
           previousChaptersSummary = previousChapters.map(c => `【${c.title}】:\n<分镜纲要>${c.sceneBeats || '无'}</分镜纲要>\n`).join('\n');
       } else {
           previousChaptersSummary = "这是本作最初阶段，暂无前情提要。";
       }
    }
    return {
      novel,
      characters,
      locations,
      items,
      timelineEvents,
      factions,
      powerLevels,
      previousChaptersSummary,
      activeEntityNames: sniffedEntities?.activeExisting,
      mountedSkills,
      sceneType: detectSceneType(),
    };
  };

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
      const context = buildAgentContext();
      const contextStr = buildContextPrompt(context);

      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: polishPromptSurface,
          draftContent: currentChapter.content,
          sceneBeats: currentChapter.sceneBeats,
          contextStr,
          skills: mountedSkills
        }),
        signal: controller.signal
      });
      setAuditStatus('总编正在逐段扫描机械感、节奏和人设一致性…');
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      const numericAuditScore = typeof data.score === 'number'
        ? data.score
        : Number(String(data.feedback || '').match(/(\d{2,3})\s*分/)?.[1] || 0) || undefined;

      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCurrentChapter(prev => prev ? { ...prev, critique: data.feedback } : null);
      await updateChapter(currentChapter.id, { critique: data.feedback });
      await recordSkillUsage('revised', {
        fitScore: getCurrentFitScore(),
        auditScore: numericAuditScore,
        notes: 'manual-audit',
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error(e);
      alert(formatAiFailure(e, 'AI 审计'));
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

    setIsGeneratingBeats(true);
    setGenerationStatus('正在根据创作意图和世界观拆解本章分镜…');
    try {
      const context = buildAgentContext();
      // TODO: Pass signal to editorAgentPhase if it supports it
      const beats = await editorAgentPhase(userIntent || `关于章节「${currentChapter.title}」的大纲`, context);

      const updated = { ...currentChapter, sceneBeats: beats };
      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCurrentChapter(updated);
      await updateChapter(currentChapter.id, { sceneBeats: beats });
      setUserIntent('');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error(error);
      const fallbackBeats = buildClientFallbackSceneBeats(userIntent || `关于章节「${currentChapter.title}」的大纲`);
      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCurrentChapter(prev => prev ? { ...prev, sceneBeats: fallbackBeats } : null);
      await updateChapter(currentChapter.id, { sceneBeats: fallbackBeats });
      setGenerationStatus('模型响应不稳定，已生成保底分镜，可直接编辑后继续写。');
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

  const buildClientFallbackSceneBeats = (intent: string) => [
    `### 场景 1：异动入场\n\n**核心冲突**：${intent}，但信息并不完整，角色只能先试探。\n\n**关键动作链**：角色观察异常；对方给出含糊回应；一个细节暴露真正风险。\n\n**退场钩子**：新的脚步声、信物或消息把局势推向下一场。`,
    `### 场景 2：试探加深\n\n**核心冲突**：双方围绕真实目的互相遮掩。\n\n**关键动作链**：试探被接住；旧线索浮出；角色意识到眼前不是偶然。\n\n**退场钩子**：关键人物或危险信号正式出现。`,
    `### 场景 3：悬念收束\n\n**核心冲突**：保全自身与追查真相发生冲突。\n\n**关键动作链**：角色做出选择；关键道具或信息被确认；局势留下更大的疑问。\n\n**退场钩子**：以一个未解释的动作或声音结束本章。`,
  ].join('\n\n---\n\n');

  const handleRewriteSelectedText = async () => {
    const startingChapterId = currentChapter?.id;
    if (!contentRef.current || !currentChapter) return;

    const currentSeq = ++requestSeqRef.current;

    const start = contentRef.current.selectionStart;
    const end = contentRef.current.selectionEnd;
    if (start === end) {
      alert("请先在右侧区域选中一段您需要改写的文字，然后再点击此按钮。");
      return;
    }
    const selectedText = currentChapter.content.substring(start, end);

    const instruction = prompt("请输入改写要求（如：更加通俗易懂，或者更有文学色彩），留空则由 AI 自动润色：");
    if (instruction === null) return;

    setIsGeneratingContent(true);
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: selectedText,
          instruction,
          contextStr: buildContextPrompt(buildAgentContext())
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error("Rewrite failed.");
      const data = await response.json();

      const newText = currentChapter.content.substring(0, start) + data.text + currentChapter.content.substring(end);
      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      handleUpdateContent(newText, true);

      // Save version after rewrite
      await createChapterVersion({
        id: Date.now().toString(),
        chapterId: currentChapter.id,
        content: newText,
        wordCount: newText.replace(/\s/g, "").length,
        author: "user",
        createdAt: Date.now()
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error(e);
      alert("改写失败，请稍后重试。");
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingContent(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  const handleUpdateChapterBeats = (newBeats: string) => {
    if (!currentChapter) return;
    setCurrentChapter(prev => prev ? { ...prev, sceneBeats: newBeats } : null);

    if (beatsSyncTimeoutRef.current) clearTimeout(beatsSyncTimeoutRef.current);
    const chapterId = currentChapter.id;
    beatsSyncTimeoutRef.current = setTimeout(async () => {
      await updateChapter(chapterId, {
        sceneBeats: newBeats
      });
    }, 1000);
  };

  const handleUpdateGlobalOutline = (val: string) => {
    setGlobalOutline(val);
    if (outlineSyncTimeoutRef.current) clearTimeout(outlineSyncTimeoutRef.current);
    outlineSyncTimeoutRef.current = setTimeout(async () => {
       await updateNovel(novel.id, { globalOutline: val });
    }, 1000);
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
          expectedWordCount
        }),
        signal: controller.signal
      });
      const data = await response.json();
      if (requestSeqRef.current !== currentSeq) return;

      if (data.outline) {
        setGlobalOutline(data.outline);
        await updateNovel(novel.id, { globalOutline: data.outline });
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error(e);
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

    let originalWordCount = currentChapter.wordCount;
    const baseContent = currentChapter.content ? currentChapter.content + '\n\n' : '';
    let currentStreamedText = '';
    let lastCritique = '';
    let hasReceivedFirstToken = false;
    let sseBuffer = '';

    try {
      // Use only mounted skills
      const context = buildAgentContext();
      const contextStr = buildContextPrompt(context);

      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftingSurface: draftPromptSurface,
          reviewSurface: reviewPromptSurface,
          contextStr,
          sceneBeats: currentChapter.sceneBeats,
          skills: mountedSkills,
          maxIterations: 1,
          draftContent: "",
          includeCritic: false
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(async () => ({ error: await response.text() }));
        throw new Error(errorPayload.error || `HTTP ${response.status}`);
      }
      setGenerationStatus('Writer Agent 已接管，正在起草正文…');

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const messages = sseBuffer.split('\n\n');
        sseBuffer = messages.pop() || '';

        for (const msg of messages) {
          if (msg.startsWith('data: ')) {
            const dataStr = msg.replace('data: ', '');
            let data: any;
            try {
              data = JSON.parse(dataStr);
            } catch (e) {
              // Ignore incomplete JSON chunks boundary issues
              continue;
            }

            if (data.type === 'token') {
              if (!hasReceivedFirstToken) {
                hasReceivedFirstToken = true;
                setGenerationStatus('正在扩写正文并实时回填到编辑器…');
              }
              currentStreamedText += data.content;
              const fullText = baseContent + currentStreamedText;

              // Optimistically update purely the UI so we see it appearing
              if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
              setCurrentChapter(prev => prev ? {
                ...prev,
                content: fullText,
                wordCount: fullText.replace(/\s/g, '').length
              } : null);

              // Scroll to bottom
              if (contentRef.current) {
                contentRef.current.scrollTop = contentRef.current.scrollHeight;
              }
            } else if (data.type === 'critic_done') {
              console.log("Critic feedback:", data.feedback, "IsValid:", data.isValid);
              lastCritique = data.feedback;
              setGenerationStatus('初稿完成，已附带一轮总编审读意见。');
              if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
              setCurrentChapter(prev => prev ? { ...prev, critique: data.feedback } : null);
            } else if (data.type === 'writer_done') {
              setGenerationStatus('正文初稿完成。若要做质量扫描，请单独点击“AI 审计”。');
            } else if (data.type === 'status') {
              setGenerationStatus(String(data.message || 'AI 正在处理…'));
            } else if (data.type === 'error') {
              console.error("Orchestration error:", data.message);
              throw new Error(data.message || '生成链路中断');
            }
          }
        }
      }

      const tailMessage = sseBuffer.trim();
      if (tailMessage.startsWith('data: ')) {
        const dataStr = tailMessage.replace('data: ', '');
        try {
          const data = JSON.parse(dataStr);
          if (data.type === 'token') {
            currentStreamedText += data.content;
          } else if (data.type === 'critic_done') {
            lastCritique = data.feedback;
          } else if (data.type === 'error') {
            throw new Error(data.message || '生成链路中断');
          }
        } catch {
          // Ignore trailing partial payloads that could not form valid JSON.
        }
      }

      // Final save when done
      const fullText = baseContent + currentStreamedText;
      if (!currentStreamedText.trim()) {
        throw new Error('AI 没有返回正文内容，请稍后重试或缩短分镜。');
      }
      const finalWordCount = fullText.replace(/\s/g, '').length;

      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setCurrentChapter(prev => prev ? {
        ...prev,
        content: fullText,
        wordCount: finalWordCount,
        ...(lastCritique && { critique: lastCritique })
      } : null);

      await updateChapter(currentChapter.id, {
        content: fullText,
        wordCount: finalWordCount,
        ...(lastCritique && { critique: lastCritique })
      });

      // Push to undo history
      pushToUndoHistory(fullText);

      // Save AI result as version
      await createChapterVersion({
        id: Date.now().toString(),
        chapterId: currentChapter.id,
        content: fullText,
        wordCount: finalWordCount,
        author: 'writer-agent',
        createdAt: Date.now()
      });
      await recordSkillUsage('accepted', {
        fitScore: getCurrentFitScore(),
        notes: 'writer-generated',
      });

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Generation aborted by user');
        return;
      }
      console.error(error);
      alert(formatAiFailure(error, '连续写作'));
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingContent(false);
        setGenerationStatus(null);
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
          signal: controller.signal
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
          critique: ''
        });

        await createChapterVersion({
          id: Date.now().toString(),
          chapterId: currentChapter.id,
          content: candidate,
          wordCount: candidate.replace(/\s/g, '').length,
          author: 'editor-agent',
          createdAt: Date.now()
        });

        setGenerationStatus('已完成局部精修。建议再跑一次 AI 审计确认效果。');
        setTimeout(() => setGenerationStatus(null), 2500);
      } else {
        setGenerationStatus(null);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error(e);
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

  const handleSniffEntities = async () => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter) return;

    const currentSeq = ++requestSeqRef.current;

    setIsSniffing(true);
    try {
      const existingNames = [...characters.map(c => c.name), ...locations.map(l => l.name), ...items.map(i => i.name)].filter(Boolean);
      const textToScan = `${currentChapter.sceneBeats || ''}\n${currentChapter.content || ''}`;

      const response = await fetch('/api/extract-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToScan, existingNames })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (latestChapterIdRef.current !== startingChapterId || requestSeqRef.current !== currentSeq) return;
      setSniffedEntities(data);
    } catch (e) {
      console.error(e);
      alert('嗅探失败');
    } finally {
      setIsSniffing(false);
    }
  };



  const handleAddChapter = async (targetVolumeName?: string) => {
    const newOrder = chapters.length + 1;
    const volumeName = targetVolumeName || currentChapter?.volumeName || '正文卷';
    const newId = Date.now().toString();
    await createChapter({
      id: newId,
      novelId: novel.id,
      volumeName,
      title: `第 ${newOrder} 章`,
      content: '',
      order: newOrder,
      wordCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (!expandedVolumes.includes(volumeName)) {
      setExpandedVolumes(prev => [...prev, volumeName]);
    }
    };

    const handleAddFirstChapter = async () => {
    const newChapId = Date.now().toString();
    const newChap: Chapter = {
      id: newChapId,
      title: '第一章',
      content: '',
      wordCount: 0,
      order: chapters.length,
      volumeName: '默认卷',
      novelId: novel.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setChapters(prev => [...prev, newChap]);
    setCurrentChapter(newChap);

    await createChapter({
      ...newChap,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    setTimeout(() => {
       if (contentRef.current) {
         contentRef.current.focus();
       }
    }, 200);
    };

    const handleUpdateContent = useCallback((newContent: string, isProgrammatic = false) => {
    if (!currentChapter) return;
    if (isGeneratingContent && !isProgrammatic) return;

    // Optimistic update for UI
    const updatedChapter = { ...currentChapter, content: newContent };
    setCurrentChapter(updatedChapter);

    // Push to undo history
    pushToUndoHistory(newContent);

    // Debounced sync to local DB
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    setIsSyncing(true);
    setSyncSuccess(false);
    const chapterId = currentChapter.id;
    syncTimeoutRef.current = setTimeout(async () => {
      await updateChapter(chapterId, {
        content: newContent,
        updatedAt: Date.now(),
        wordCount: newContent.replace(/\s/g, '').length
      });
      setIsSyncing(false);
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 2000);
    }, 1000);
  }, [currentChapter, isGeneratingContent, pushToUndoHistory]);

  const handleDeleteChapter = async (id: string) => {
    if (!confirm('确定要删除这一章吗？')) return;
    await deleteChapter(id);
    if (currentChapter?.id === id) {
      setCurrentChapter(chapters.find(c => c.id !== id) || null);
    }
  };

  const toggleVolume = (vName: string) => {
    setExpandedVolumes(prev =>
      prev.includes(vName) ? prev.filter(v => v !== vName) : [...prev, vName]
    );
  };
  const handleVolumeNameChange = (newVol: string) => {
    if (!currentChapter) return;
    setCurrentChapter({ ...currentChapter, volumeName: newVol });

    if (titleSyncTimeoutRef.current) clearTimeout(titleSyncTimeoutRef.current);
    titleSyncTimeoutRef.current = setTimeout(async () => {
      await updateChapter(currentChapter.id, { volumeName: newVol });
    }, 1000);
  };

  const handleTitleChange = (newTitle: string) => {
    if (!currentChapter) return;
    setCurrentChapter({ ...currentChapter, title: newTitle });

    if (titleSyncTimeoutRef.current) clearTimeout(titleSyncTimeoutRef.current);
    titleSyncTimeoutRef.current = setTimeout(async () => {
      await updateChapter(currentChapter.id, { title: newTitle });
    }, 1000);
  };



  return (
    <div className={cn(
      "h-full flex overflow-hidden transition-all duration-700 relative",
      isFullscreen ? "fixed inset-0 z-[100] bg-parchment" : "bg-white"
    )}>
      {isEditorDataLoading && (
        <div className="absolute top-4 right-4 z-50">
          <Loader2 className="animate-spin text-theme-accent opacity-50" size={20} />
        </div>
      )}
      {/* Chapter List Sidebar */}
      <ChapterSidebar
        novel={novel}
        chapters={chapters}
        currentChapter={currentChapter}
        onSelectChapter={setCurrentChapter}
        onAddChapter={handleAddChapter}
        onDeleteChapter={handleDeleteChapter}
        isSidebarOpen={isSidebarOpen}
        isFullscreen={isFullscreen}
        onBack={onBack}
        expandedVolumes={expandedVolumes}
        onToggleVolume={toggleVolume}
      />

      {/* Editor Content Area */}
      <div className={cn(
        "flex-1 flex flex-col relative overflow-hidden transition-colors duration-500",
        isFullscreen ? "bg-parchment" : "bg-paper"
      )}>
        {/* Editor Toolbar */}
        <EditorHeader
          currentChapter={currentChapter}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
          isAgentSidebarOpen={isAgentSidebarOpen}
          onToggleAgentSidebar={() => setIsAgentSidebarOpen(!isAgentSidebarOpen)}
          isEditorDataLoading={isEditorDataLoading}
          isAnyGenerating={isAnyGenerating}
          isSyncing={isSyncing}
          syncSuccess={syncSuccess}
          mountedSkills={mountedSkills}
          onVolumeNameChange={handleVolumeNameChange}
          onTitleChange={handleTitleChange}
        />

        {/* Writing Surface */}
        <WritingSurface
          novel={novel}
          currentChapter={currentChapter}
          isGeneratingBeats={isGeneratingBeats}
          isGeneratingCritique={isGeneratingCritique}
          isGeneratingContent={isGeneratingContent}
          generationStatus={generationStatus}
          auditStatus={auditStatus}
          isChapterEmpty={isChapterEmpty}
          mountedSkillsCount={mountedSkills.length}
          copilotSuggestion={copilotSuggestion}
          runCopilotAction={runCopilotAction}
          contentRef={contentRef}
          onGenerateBeats={handleGenerateBeats}
          onRunAudit={handleRunAudit}
          onUpdateContent={handleUpdateContent}
          onOpenAssistant={onOpenAssistant}
          buildAssistantLaunchContext={buildAssistantLaunchContext}
          onAddFirstChapter={handleAddFirstChapter}
          setAgentTab={setAgentTab}
          setIsAgentSidebarOpen={setIsAgentSidebarOpen}
        />

        <div className="h-9 bg-white border-t border-theme-border px-4 flex items-center justify-between shrink-0 text-[11px] text-theme-muted overflow-hidden">
          <div className="flex items-center gap-3 min-w-0 overflow-hidden">
            <span className="font-medium tabular-nums">字数 {currentChapter?.wordCount || 0}</span>
            <span className="hidden sm:inline tabular-nums">更新 {currentChapter ? statusTimeFormatter.format(new Date(currentChapter.updatedAt)) : '-'}</span>
            <span className="hidden lg:inline">预计 token <span className="text-theme-text font-semibold tabular-nums">~2.4k</span></span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-600 shadow-[0_0_5px_rgba(22,163,74,0.3)]" />
              <span className="hidden sm:inline">{isSyncing ? '保存中…' : '本地已保存'}</span>
            </div>
            <div className="hidden sm:block h-3 w-px bg-theme-border/50" />
            <button
              onClick={async () => {
                if (!novel?.id) return;
                const format = confirm('导出为 EPUB？（确定=EPUB，取消=TXT）') ? 'epub' : 'txt';
                try {
                  const res = await fetch('/api/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ novelId: novel.id, format }),
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(err.error || `HTTP ${res.status}`);
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${novel.title}.${format}`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  console.error(e);
                  alert('导出失败: ' + (e instanceof Error ? e.message : String(e)));
                }
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-theme-accent hover:opacity-80 transition-opacity"
            >
              <Download size={12} /> 导出
            </button>
          </div>
        </div>

      </div>

      {/* Agent Sidebar */}
      <AnimatePresence initial={false}>
        {!isFullscreen && isAgentSidebarOpen && (
          <>
            <motion.button
              type="button"
              aria-label="关闭智能管家"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setIsAgentSidebarOpen(false)}
              className="absolute inset-0 z-20 bg-black/10 backdrop-blur-[1px]"
            />
            <AgentWorkspace
              novel={novel}
              chapters={chapters}
              currentChapter={currentChapter}
              setCurrentChapter={setCurrentChapter}
              isAgentSidebarOpen={isAgentSidebarOpen}
              setIsAgentSidebarOpen={setIsAgentSidebarOpen}
              agentTab={agentTab}
              setAgentTab={setAgentTab}
              copilotSuggestion={copilotSuggestion}
              runCopilotAction={runCopilotAction}
              activeProductionRun={activeProductionRun}
              productionIntent={productionIntent}
              setProductionIntent={setProductionIntent}
              isProductionRunning={isProductionRunning}
              isApplyingProductionRun={isApplyingProductionRun}
              productionError={productionError}
              onStartProductionRun={handleStartProductionRun}
              onApplyProductionRun={handleApplyProductionRun}
              expectedWordCount={expectedWordCount}
              setExpectedWordCount={setExpectedWordCount}
              onGenerateOutline={handleGenerateOutline}
              isGeneratingOutline={isGeneratingOutline}
              globalOutline={globalOutline}
              onGlobalOutlineChange={handleUpdateGlobalOutline}
              onGenerateBeats={handleGenerateBeats}
              isGeneratingBeats={isGeneratingBeats}
              userIntent={userIntent}
              setUserIntent={setUserIntent}
              isGeneratingContent={isGeneratingContent}
              onGenerateContent={handleGenerateContent}
              onRewriteSelectedText={handleRewriteSelectedText}
              onUpdateChapterBeats={handleUpdateChapterBeats}
              onRunAudit={handleRunAudit}
              isGeneratingCritique={isGeneratingCritique}
              onPolishChapterFromAudit={handlePolishChapterFromAudit}
              bibleSearch={bibleSearch}
              setBibleSearch={setBibleSearch}
              characters={characters}
              locations={locations}
              items={items}
              librarySkills={librarySkills}
              skillUsageRecords={skillUsageRecords}
              mountedSkillLoadout={mountedSkillLoadout}
              onAssignSkill={assignSkillToSlot}
              onRemoveSkill={removeSkillFromSlot}
              projectPreferenceProfile={projectPreferenceProfile}
              onPreferenceProfileChange={persistProjectPreferenceProfile}
              versions={versions}
              onSaveVersion={handleSaveVersion}
              onRestoreVersion={handleRestoreVersion}
              isSniffing={isSniffing}
              sniffedEntities={sniffedEntities}
              onSniffEntities={handleSniffEntities}
              onAddSniffedEntity={handleAddSniffedEntity}
              addingEntityNames={addingEntityNames}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
