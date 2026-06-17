import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type {
  Chapter,
  ChapterVersion,
  MountedSkillLoadoutItem,
  Novel,
  ProjectPreferenceProfile,
} from '../../types';
import { createChapter, createChapterVersion, deleteChapter, listChapters, updateChapter } from '../chapter-client';
import { updateNovel } from '../novel-client';

interface UseEditorPersistenceArgs {
  novel: Novel;
  chapters: Chapter[];
  currentChapter: Chapter | null;
  isContentLockedRef: RefObject<boolean>;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  setChapters: Dispatch<SetStateAction<Chapter[]>>;
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>;
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
  setMountedSkillLoadout,
  setProjectPreferenceProfile,
  setGlobalOutline,
  setExpandedVolumes,
  pushToUndoHistory,
}: UseEditorPersistenceArgs) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const beatsSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const outlineSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const titleSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (beatsSyncTimeoutRef.current) clearTimeout(beatsSyncTimeoutRef.current);
      if (outlineSyncTimeoutRef.current) clearTimeout(outlineSyncTimeoutRef.current);
      if (titleSyncTimeoutRef.current) clearTimeout(titleSyncTimeoutRef.current);
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const markSyncComplete = () => {
    setIsSyncing(false);
    setSyncSuccess(true);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => setSyncSuccess(false), 2000);
  };

  const cancelPendingContentSync = () => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    setIsSyncing(false);
  };

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

  const handleSaveVersion = async (author: 'user' | 'writer-agent' | 'editor-agent' | 'auto') => {
    if (!currentChapter) return;
    await createChapterVersion({
      id: Date.now().toString(),
      chapterId: currentChapter.id,
      content: currentChapter.content,
      wordCount: currentChapter.wordCount,
      author,
      createdAt: Date.now(),
    });
  };

  const handleUpdateContent = useCallback((newContent: string, isProgrammatic = false) => {
    if (!currentChapter) return;
    if (isContentLockedRef.current && !isProgrammatic) return;

    const updatedChapter = { ...currentChapter, content: newContent };
    setCurrentChapter(updatedChapter);
    pushToUndoHistory(newContent);

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    setIsSyncing(true);
    setSyncSuccess(false);
    const chapterId = currentChapter.id;
    syncTimeoutRef.current = setTimeout(async () => {
      await updateChapter(chapterId, {
        content: newContent,
        updatedAt: Date.now(),
        wordCount: newContent.replace(/\s/g, '').length,
      });
      markSyncComplete();
    }, 1000);
  }, [currentChapter, isContentLockedRef, pushToUndoHistory, setCurrentChapter]);

  const handleRestoreVersion = (version: ChapterVersion) => {
    if (!confirm('确定要回滚到此版本吗？这将覆盖当前正文内容！')) return;
    handleUpdateContent(version.content, true);
  };

  const handleUpdateChapterBeats = (newBeats: string) => {
    if (!currentChapter) return;
    setCurrentChapter((prev) => prev ? { ...prev, sceneBeats: newBeats } : null);

    if (beatsSyncTimeoutRef.current) clearTimeout(beatsSyncTimeoutRef.current);
    const chapterId = currentChapter.id;
    beatsSyncTimeoutRef.current = setTimeout(async () => {
      await updateChapter(chapterId, {
        sceneBeats: newBeats,
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
    setExpandedVolumes((prev) => (prev.includes(volumeName) ? prev : [...prev, volumeName]));
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
    setChapters((prev) => [...prev, newChap]);
    setCurrentChapter(newChap);

    await createChapter({
      ...newChap,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    setTimeout(() => {
      contentRef.current?.focus();
    }, 200);
  };

  const handleDeleteChapter = async (id: string) => {
    if (!confirm('确定要删除这一章吗？')) return;
    await deleteChapter(id);
    if (currentChapter?.id === id) {
      setCurrentChapter(chapters.find((chapter) => chapter.id !== id) || null);
    }
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

  const refreshChapters = async () => {
    const freshChapters = await listChapters(novel.id);
    setChapters(freshChapters);
    return freshChapters;
  };

  return {
    isSyncing,
    syncSuccess,
    cancelPendingContentSync,
    persistSkillLoadout,
    persistProjectPreferenceProfile,
    handleSaveVersion,
    handleRestoreVersion,
    handleUpdateContent,
    handleUpdateChapterBeats,
    handleUpdateGlobalOutline,
    handleAddChapter,
    handleAddFirstChapter,
    handleDeleteChapter,
    handleVolumeNameChange,
    handleTitleChange,
    refreshChapters,
  };
}
