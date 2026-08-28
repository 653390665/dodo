import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type {
  Chapter,
  ChapterMetadata,
  ChapterVersion,
  MountedSkillLoadoutItem,
  Novel,
  ProjectPreferenceProfile,
} from '../../../shared/types';
import { createChapter, createChapterVersion, deleteChapter, listChaptersMetadata, updateChapter } from '../chapter-client';
import {
  flushPendingEditorWrites as flushEditorWrites,
  hasFailedEditorWrites,
  hasPendingEditorWrites,
  queueEditorWrite,
  subscribeToEditorWrites,
} from '../editor-write-queue';
import { updateNovel } from '../novel-client';
import { recordProductEvent } from '../product-events-client';
import { toast } from '../toast';
import { getNextChapterOrder } from '../../../shared/lib/chapter-production';
import { generateClientId } from '../id';

interface UseEditorPersistenceArgs {
  novel: Novel;
  databaseGeneration?: number | null;
  chapters: ChapterMetadata[];
  currentChapter: Chapter | null;
  isContentLockedRef: RefObject<boolean>;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  setChapters: Dispatch<SetStateAction<ChapterMetadata[]>>;
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>;
  selectChapter: (chapterId: string) => Promise<Chapter | null>;
  setMountedSkillLoadout: Dispatch<SetStateAction<MountedSkillLoadoutItem[]>>;
  setProjectPreferenceProfile: Dispatch<SetStateAction<ProjectPreferenceProfile | undefined>>;
  setGlobalOutline: Dispatch<SetStateAction<string>>;
  setExpandedVolumes: Dispatch<SetStateAction<string[]>>;
  pushToUndoHistory: (content: string) => void;
}

function rejectUnavailableGeneration(): Promise<never> {
  return Promise.reject(new Error('数据库代次不可用，已阻止编辑器写入'));
}

export function useEditorPersistence({
  novel,
  databaseGeneration,
  chapters,
  currentChapter,
  isContentLockedRef,
  contentRef,
  setChapters,
  setCurrentChapter,
  selectChapter,
  setMountedSkillLoadout,
  setProjectPreferenceProfile,
  setGlobalOutline,
  setExpandedVolumes,
  pushToUndoHistory,
}: UseEditorPersistenceArgs) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);

  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isMountedRef = useRef(true);
  const hasWriteActivityRef = useRef(false);
  const addChapterInFlightRef = useRef<Promise<void> | null>(null);
  const firstContentInputChapterIdsRef = useRef(new Set<string>());

  // Keep legacy call shape when no snapshot is available; otherwise every
  // operation is bound to this render's generation and can be safely queued.
  const updateChapterForEditor = useCallback((id: string, data: Partial<Chapter>) =>
    databaseGeneration === undefined ? updateChapter(id, data) : databaseGeneration === null ? rejectUnavailableGeneration() : updateChapter(id, data, databaseGeneration), [databaseGeneration]);
  const updateNovelForEditor = useCallback((id: string, data: Partial<Novel>) =>
    databaseGeneration === undefined ? updateNovel(id, data) : databaseGeneration === null ? rejectUnavailableGeneration() : updateNovel(id, data, databaseGeneration), [databaseGeneration]);
  const createChapterForEditor = useCallback((chapter: Chapter) =>
    databaseGeneration === undefined ? createChapter(chapter) : databaseGeneration === null ? rejectUnavailableGeneration() : createChapter(chapter, databaseGeneration), [databaseGeneration]);
  const deleteChapterForEditor = useCallback((id: string) =>
    databaseGeneration === undefined ? deleteChapter(id) : databaseGeneration === null ? rejectUnavailableGeneration() : deleteChapter(id, databaseGeneration), [databaseGeneration]);
  const createChapterVersionForEditor = useCallback((version: ChapterVersion) =>
    databaseGeneration === undefined ? createChapterVersion(version) : databaseGeneration === null ? rejectUnavailableGeneration() : createChapterVersion(version, databaseGeneration), [databaseGeneration]);

  const recordFirstContentInput = useCallback((chapterId: string, previousContent: string, nextContent: string) => {
    if (previousContent.trim() || !nextContent.trim() || firstContentInputChapterIdsRef.current.has(chapterId)) return;
    firstContentInputChapterIdsRef.current.add(chapterId);
    void recordProductEvent({
      eventName: 'first_content_input',
      stage: 'drafting',
      result: 'success',
      novelId: novel.id,
      chapterId,
      objectId: chapterId,
    });
  }, [novel.id]);

  const recordContentSave = useCallback((chapterId: string) => {
    void recordProductEvent({
      eventName: 'content_save',
      stage: 'drafting',
      result: 'success',
      novelId: novel.id,
      chapterId,
      objectId: chapterId,
    });
  }, [novel.id]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const markSyncComplete = useCallback(() => {
    if (!isMountedRef.current) return;
    setIsSyncing(false);
    setSyncFailed(false);
    setSyncSuccess(true);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) setSyncSuccess(false);
    }, 2000);
  }, []);

  useEffect(() => subscribeToEditorWrites(() => {
    if (!isMountedRef.current) return;
    const hasPending = hasPendingEditorWrites();
    const hasFailure = hasFailedEditorWrites();
    setIsSyncing(hasPending && !hasFailure);
    setSyncFailed(hasFailure);
    if (hasFailure) {
      setSyncSuccess(false);
    } else if (!hasPending && hasWriteActivityRef.current) {
      hasWriteActivityRef.current = false;
      markSyncComplete();
    }
  }), [markSyncComplete]);

  const persistSkillLoadout = async (nextLoadout: MountedSkillLoadoutItem[]) => {
    const normalizedLoadout = nextLoadout
      .filter((entry) => entry.slot >= 0 && entry.slot <= 2)
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.slot === entry.slot) === index);
    const nextIds = normalizedLoadout.map((entry) => entry.skillId);
    setMountedSkillLoadout(normalizedLoadout);
    const versionedProfile = {
      ...(novel.projectPreferenceProfile || {}),
      skillLoadoutSchemaVersion: 2,
    } as ProjectPreferenceProfile;
    await updateNovelForEditor(novel.id, {
      mountedSkillIds: nextIds,
      mountedSkillLoadout: normalizedLoadout,
      projectPreferenceProfile: versionedProfile,
    });
  };

  const persistProjectPreferenceProfile = async (profile: ProjectPreferenceProfile) => {
    const result = await updateNovelForEditor(novel.id, {
      projectPreferenceProfile: profile,
    });
    // Only update local React state after a confirmed successful DB write.
    // false, undefined, or an exception means the write did not happen.
    if (result !== true) {
      throw new Error('保存设定失败：数据库写入未生效');
    }
    setProjectPreferenceProfile(profile);
  };

  const handleSaveVersion = async (author: 'user' | 'writer-agent' | 'editor-agent' | 'auto') => {
    if (!currentChapter) return;
    try {
      await flushEditorWrites();
    } catch {
      toast('章节尚未保存，无法创建版本，请重试', 'error');
      return;
    }
    const versionContent = contentRef.current?.value ?? currentChapter.content;
    const versionWordCount = versionContent.replace(/\s/g, '').length;
    try {
      await createChapterVersionForEditor({
        id: generateClientId(),
        chapterId: currentChapter.id,
        content: versionContent,
        wordCount: versionWordCount,
        author,
        createdAt: Date.now(),
      });
      toast('版本已保存', 'success');
    } catch (error) {
      console.error('[useEditorPersistence] Failed to create chapter version:', error);
      toast('版本保存失败，请重试', 'error');
    }
  };

  const enqueueContentWrite = useCallback((chapterId: string, newContent: string) => {
    setIsSyncing(true);
    setSyncSuccess(false);
    hasWriteActivityRef.current = true;
    queueEditorWrite(`chapter:${chapterId}:content`, async () => {
      const saved = await updateChapterForEditor(chapterId, {
        content: newContent,
        updatedAt: Date.now(),
        wordCount: newContent.replace(/\s/g, '').length,
      });
      if (!saved) return false;
      recordContentSave(chapterId);
      return true;
    }, 1000, { entityType: 'chapter', entityId: chapterId, field: 'content', value: newContent });
  }, [recordContentSave, updateChapterForEditor]);

  const queueContentWrite = useCallback((newContent: string) => {
    if (!currentChapter || isContentLockedRef.current) return;
    if (newContent === undefined || newContent === null) return;
    recordFirstContentInput(currentChapter.id, currentChapter.content || '', newContent);
    enqueueContentWrite(currentChapter.id, newContent);
  }, [currentChapter, enqueueContentWrite, isContentLockedRef, recordFirstContentInput]);

  const handleUpdateContent = useCallback((newContent: string, isProgrammatic = false, skipPersist = false) => {
    if (!currentChapter) return;
    if (isContentLockedRef.current && !isProgrammatic) return;
    if (newContent === undefined || newContent === null) return;

    const updatedChapter = { ...currentChapter, content: newContent };
    setCurrentChapter(updatedChapter);
    pushToUndoHistory(newContent);
    if (!isProgrammatic) {
      recordFirstContentInput(currentChapter.id, currentChapter.content || '', newContent);
    }

    if (skipPersist) return;
    enqueueContentWrite(currentChapter.id, newContent);
  }, [currentChapter, enqueueContentWrite, isContentLockedRef, pushToUndoHistory, recordFirstContentInput, setCurrentChapter]);

  const flushPendingEditorWrites = useCallback(async () => {
    if (contentRef.current && currentChapter) {
      const latestValue = contentRef.current.value;
      if (latestValue !== (currentChapter.content || '')) {
        const updatedChapter = { ...currentChapter, content: latestValue };
        setCurrentChapter(updatedChapter);
        pushToUndoHistory(latestValue);
        const chapterId = currentChapter.id;
        const finalWordCount = latestValue.replace(/\s/g, '').length;
        hasWriteActivityRef.current = true;
        recordFirstContentInput(chapterId, currentChapter.content || '', latestValue);
        queueEditorWrite(`chapter:${chapterId}:content`, async () => {
          const saved = await updateChapterForEditor(chapterId, {
            content: latestValue,
            updatedAt: Date.now(),
            wordCount: finalWordCount,
          });
          if (!saved) return false;
          recordContentSave(chapterId);
          return true;
        }, 0, { entityType: 'chapter', entityId: chapterId, field: 'content', value: latestValue });
        setChapters((prev) =>
          prev.map((c) =>
            c.id === chapterId
              ? { ...c, wordCount: finalWordCount, updatedAt: Date.now() }
              : c
          )
        );
      }
    }
    await flushEditorWrites();
  }, [contentRef, currentChapter, pushToUndoHistory, recordContentSave, recordFirstContentInput, setCurrentChapter, setChapters, updateChapterForEditor]);

  const flushBeforeChangingEditorContext = async (): Promise<boolean> => {
    try {
      await flushPendingEditorWrites();
      return true;
    } catch (error) {
      console.error('[useEditorPersistence] Failed to flush editor writes:', error);
      toast('尚有内容保存失败，请重试后再切换', 'error');
      return false;
    }
  };

  const handleRestoreVersion = (version: ChapterVersion) => {
    if (!currentChapter || version.chapterId !== currentChapter.id) {
      toast('该版本不属于当前章节，已阻止恢复', 'error');
      return;
    }
    handleUpdateContent(version.content, true);
  };

  const handleUpdateChapterBeats = (newBeats: string) => {
    if (!currentChapter) return;
    setCurrentChapter((prev) => prev ? { ...prev, sceneBeats: newBeats } : null);

    const chapterId = currentChapter.id;
    setIsSyncing(true);
    setSyncSuccess(false);
    hasWriteActivityRef.current = true;
    queueEditorWrite(`chapter:${chapterId}:sceneBeats`, async () => {
      const saved = await updateChapterForEditor(chapterId, {
        sceneBeats: newBeats,
      });
      if (!saved) return false;
      return true;
    }, 1000, { entityType: 'chapter', entityId: chapterId, field: 'sceneBeats', value: newBeats });
  };

  const handleUpdateGlobalOutline = useCallback((val: string): boolean => {
    setGlobalOutline(val);
    setIsSyncing(true);
    setSyncSuccess(false);
    hasWriteActivityRef.current = true;
    queueEditorWrite(`novel:${novel.id}:globalOutline`, async () => {
      const saved = await updateNovelForEditor(novel.id, { globalOutline: val });
      if (!saved) return false;
      return true;
    }, 1000, { entityType: 'novel', entityId: novel.id, field: 'globalOutline', value: val });
    return true;
  }, [novel.id, setGlobalOutline, updateNovelForEditor]);

  const adoptGlobalOutline = useCallback(async (val: string): Promise<boolean> => {
    setIsSyncing(true);
    setSyncSuccess(false);
    hasWriteActivityRef.current = true;
    queueEditorWrite(`novel:${novel.id}:globalOutline`, async () => {
      const saved = await updateNovelForEditor(novel.id, { globalOutline: val });
      if (!saved) return false;
      return true;
    }, 0, { entityType: 'novel', entityId: novel.id, field: 'globalOutline', value: val });
    await flushEditorWrites();
    setGlobalOutline(val);
    return true;
  }, [novel.id, setGlobalOutline, updateNovelForEditor]);

  const handleAddChapter = async (targetVolumeName?: string) => {
    if (addChapterInFlightRef.current) return addChapterInFlightRef.current;
    const run = (async () => {
    if (!await flushBeforeChangingEditorContext()) return;
    const newOrder = getNextChapterOrder(chapters);
    const volumeName = targetVolumeName || currentChapter?.volumeName || '正文卷';
    const newId = generateClientId();
    const newChapterData = {
      id: newId,
      novelId: novel.id,
      volumeName,
      title: `第 ${newOrder} 章`,
      content: '',
      order: newOrder,
      wordCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const newChapterMeta: ChapterMetadata = {
      id: newId,
      novelId: novel.id,
      volumeName,
      title: `第 ${newOrder} 章`,
      order: newOrder,
      wordCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await createChapterForEditor(newChapterData);
      setChapters((prev) => [...prev, newChapterMeta]);
      setCurrentChapter({
        ...newChapterData,
        sceneBeats: '',
        critique: '',
      });
      setExpandedVolumes((prev) => (prev.includes(volumeName) ? prev : [...prev, volumeName]));
      void recordProductEvent({
        eventName: 'next_chapter', stage: 'next_chapter', result: 'success',
        novelId: novel.id, chapterId: newId,
      }).catch(() => undefined);
    } catch (err) {
      void recordProductEvent({
        eventName: 'next_chapter', stage: 'next_chapter', result: 'failure',
        errorCode: 'CREATE_CHAPTER_FAILED', novelId: novel.id, chapterId: newId,
      }).catch(() => undefined);
      console.error('[useEditorPersistence] Failed to create chapter in DB:', err);
      toast('创建章节失败，请稍后重试', 'error');
    }
    })();
    addChapterInFlightRef.current = run;
    try { await run; } finally { addChapterInFlightRef.current = null; }
  };

  const handleAddFirstChapter = async () => {
    if (!await flushBeforeChangingEditorContext()) return;
    const newChapId = generateClientId();
    const newChap: Chapter = {
      id: newChapId,
      title: '第一章',
      content: '',
      wordCount: 0,
      order: getNextChapterOrder(chapters),
      volumeName: '默认卷',
      novelId: novel.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await createChapterForEditor({ ...newChap, createdAt: Date.now(), updatedAt: Date.now() });
      setChapters((prev) => [...prev, newChap]);
      setCurrentChapter(newChap);
      void recordProductEvent({
        eventName: 'next_chapter', stage: 'next_chapter', result: 'success',
        novelId: novel.id, chapterId: newChap.id,
      }).catch(() => undefined);
    } catch (error) {
      void recordProductEvent({
        eventName: 'next_chapter', stage: 'next_chapter', result: 'failure',
        errorCode: 'CREATE_CHAPTER_FAILED', novelId: novel.id, chapterId: newChap.id,
      }).catch(() => undefined);
      console.error('[useEditorPersistence] Failed to create first chapter:', error);
      toast('创建章节失败，请稍后重试', 'error');
      return;
    }

    setTimeout(() => {
      contentRef.current?.focus();
    }, 200);
  };

  const handleDeleteChapter = async (id: string) => {
    if (!await flushBeforeChangingEditorContext()) return;
    const deleted = await deleteChapterForEditor(id);
    if (!deleted) {
      toast('删除章节失败，章节可能已不存在', 'error');
      return;
    }
    const remaining = chapters.filter((chapter) => chapter.id !== id);
    setChapters(remaining);
    if (currentChapter?.id === id) {
      const fallback = remaining[0];
      if (fallback) {
        try {
          await selectChapter(fallback.id);
        } catch (error) {
          console.error('[useEditorPersistence] Failed to load fallback chapter:', error);
          setCurrentChapter(null);
          toast('章节已删除，但备用章节加载失败，请重试', 'error');
        }
      } else {
        setCurrentChapter(null);
      }
    }
  };

  const handleVolumeNameChange = (newVol: string) => {
    if (!currentChapter) return;
    setCurrentChapter({ ...currentChapter, volumeName: newVol });

    setIsSyncing(true);
    setSyncSuccess(false);
    hasWriteActivityRef.current = true;
    const chapterId = currentChapter.id;
    queueEditorWrite(`chapter:${chapterId}:volumeName`, async () => {
      const saved = await updateChapterForEditor(chapterId, { volumeName: newVol });
      if (!saved) return false;
      return true;
    }, 1000, { entityType: 'chapter', entityId: chapterId, field: 'volumeName', value: newVol });
  };

  const handleTitleChange = (newTitle: string) => {
    if (!currentChapter) return;
    setCurrentChapter({ ...currentChapter, title: newTitle });

    setIsSyncing(true);
    setSyncSuccess(false);
    hasWriteActivityRef.current = true;
    const chapterId = currentChapter.id;
    queueEditorWrite(`chapter:${chapterId}:title`, async () => {
      const saved = await updateChapterForEditor(chapterId, { title: newTitle });
      if (!saved) return false;
      return true;
    }, 1000, { entityType: 'chapter', entityId: chapterId, field: 'title', value: newTitle });
  };

  const refreshChapters = async () => {
    const freshChapters = await listChaptersMetadata(novel.id);
    setChapters(freshChapters);
    if (currentChapter && !freshChapters.some((chapter) => chapter.id === currentChapter.id)) {
      const fallback = freshChapters[0];
      if (fallback) await selectChapter(fallback.id);
      else setCurrentChapter(null);
    }
    return freshChapters;
  };

  return {
    isSyncing,
    syncSuccess,
    syncFailed,
    persistSkillLoadout,
    persistProjectPreferenceProfile,
    handleSaveVersion,
    handleRestoreVersion,
    handleUpdateContent,
    queueContentWrite,
    handleUpdateChapterBeats,
    handleUpdateGlobalOutline,
    adoptGlobalOutline,
    handleAddChapter,
    handleAddFirstChapter,
    handleDeleteChapter,
    handleVolumeNameChange,
    handleTitleChange,
    flushPendingEditorWrites,
    refreshChapters,
  };
}
