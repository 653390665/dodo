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
import { toast } from '../toast';

interface UseEditorPersistenceArgs {
  novel: Novel;
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

export function useEditorPersistence({
  novel,
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
    const nextIds = nextLoadout.slice().sort((a, b) => a.slot - b.slot).map((entry) => entry.skillId);
    setMountedSkillLoadout(nextLoadout);
    await updateNovel(novel.id, {
      mountedSkillIds: nextIds,
      mountedSkillLoadout: nextLoadout,
    });
  };

  const persistProjectPreferenceProfile = async (profile: ProjectPreferenceProfile) => {
    const result = await updateNovel(novel.id, {
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
      await createChapterVersion({
        id: Date.now().toString(),
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
      const saved = await updateChapter(chapterId, {
        content: newContent,
        updatedAt: Date.now(),
        wordCount: newContent.replace(/\s/g, '').length,
      });
      if (!saved) return false;
      return true;
    }, 1000, { entityType: 'chapter', entityId: chapterId, field: 'content', value: newContent });
  }, []);

  const queueContentWrite = useCallback((newContent: string) => {
    if (!currentChapter || isContentLockedRef.current) return;
    if (newContent === undefined || newContent === null) return;
    enqueueContentWrite(currentChapter.id, newContent);
  }, [currentChapter, enqueueContentWrite, isContentLockedRef]);

  const handleUpdateContent = useCallback((newContent: string, isProgrammatic = false, skipPersist = false) => {
    if (!currentChapter) return;
    if (isContentLockedRef.current && !isProgrammatic) return;
    if (newContent === undefined || newContent === null) return;

    const updatedChapter = { ...currentChapter, content: newContent };
    setCurrentChapter(updatedChapter);
    pushToUndoHistory(newContent);

    if (skipPersist) return;
    enqueueContentWrite(currentChapter.id, newContent);
  }, [currentChapter, enqueueContentWrite, isContentLockedRef, pushToUndoHistory, setCurrentChapter]);

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
        queueEditorWrite(`chapter:${chapterId}:content`, () => updateChapter(chapterId, {
          content: latestValue, updatedAt: Date.now(), wordCount: finalWordCount,
        }), 0, { entityType: 'chapter', entityId: chapterId, field: 'content', value: latestValue });
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
  }, [contentRef, currentChapter, pushToUndoHistory, setCurrentChapter, setChapters]);

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
      const saved = await updateChapter(chapterId, {
        sceneBeats: newBeats,
      });
      if (!saved) return false;
      return true;
    }, 1000, { entityType: 'chapter', entityId: chapterId, field: 'sceneBeats', value: newBeats });
  };

  const handleUpdateGlobalOutline = (val: string) => {
    setGlobalOutline(val);
    setIsSyncing(true);
    setSyncSuccess(false);
    hasWriteActivityRef.current = true;
    queueEditorWrite(`novel:${novel.id}:globalOutline`, async () => {
      await updateNovel(novel.id, { globalOutline: val });
    }, 1000, { entityType: 'novel', entityId: novel.id, field: 'globalOutline', value: val });
  };

  const handleAddChapter = async (targetVolumeName?: string) => {
    if (!await flushBeforeChangingEditorContext()) return;
    const newOrder = chapters.length + 1;
    const volumeName = targetVolumeName || currentChapter?.volumeName || '正文卷';
    const newId = Date.now().toString();
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
      await createChapter(newChapterData);
      setChapters((prev) => [...prev, newChapterMeta]);
      setCurrentChapter({
        ...newChapterData,
        sceneBeats: '',
        critique: '',
      });
      setExpandedVolumes((prev) => (prev.includes(volumeName) ? prev : [...prev, volumeName]));
    } catch (err) {
      console.error('[useEditorPersistence] Failed to create chapter in DB:', err);
      toast('创建章节失败，请稍后重试', 'error');
    }
  };

  const handleAddFirstChapter = async () => {
    if (!await flushBeforeChangingEditorContext()) return;
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
    try {
      await createChapter({ ...newChap, createdAt: Date.now(), updatedAt: Date.now() });
      setChapters((prev) => [...prev, newChap]);
      setCurrentChapter(newChap);
    } catch (error) {
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
    const deleted = await deleteChapter(id);
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
      const saved = await updateChapter(chapterId, { volumeName: newVol });
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
      const saved = await updateChapter(chapterId, { title: newTitle });
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
    handleAddChapter,
    handleAddFirstChapter,
    handleDeleteChapter,
    handleVolumeNameChange,
    handleTitleChange,
    flushPendingEditorWrites,
    refreshChapters,
  };
}
