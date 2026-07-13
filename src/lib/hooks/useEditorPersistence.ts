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
import { metadataToChapter } from '../chapter-utils';
import { updateNovel } from '../novel-client';

interface UseEditorPersistenceArgs {
  novel: Novel;
  chapters: ChapterMetadata[];
  currentChapter: Chapter | null;
  isContentLockedRef: RefObject<boolean>;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  setChapters: Dispatch<SetStateAction<ChapterMetadata[]>>;
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

  const isMountedRef = useRef(true);
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
  const prevChapterIdRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (beatsSyncTimeoutRef.current) clearTimeout(beatsSyncTimeoutRef.current);
      if (outlineSyncTimeoutRef.current) clearTimeout(outlineSyncTimeoutRef.current);
      if (titleSyncTimeoutRef.current) clearTimeout(titleSyncTimeoutRef.current);
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);

      // Flush pending save on unmount
      if (pendingSaveRef.current) {
        const save = pendingSaveRef.current;
        pendingSaveRef.current = null;
        save().catch((e) => console.warn('[useEditorPersistence] Failed to flush pending save on unmount:', e));
      }
    };
  }, []);

  // Flush pending save on chapter switch
  useEffect(() => {
    const prevId = prevChapterIdRef.current;
    const currentId = currentChapter?.id || null;

    if (prevId && prevId !== currentId) {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      if (pendingSaveRef.current) {
        const save = pendingSaveRef.current;
        pendingSaveRef.current = null;
        save().catch((e) => console.warn('[useEditorPersistence] Failed to flush pending save on chapter switch:', e));
      }
    }

    prevChapterIdRef.current = currentId;
  }, [currentChapter?.id]);

  const markSyncComplete = () => {
    if (!isMountedRef.current) return;
    setIsSyncing(false);
    setSyncSuccess(true);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) setSyncSuccess(false);
    }, 2000);
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

  const handleUpdateContent = useCallback((newContent: string, isProgrammatic = false, skipPersist = false) => {
    if (!currentChapter) return;
    if (isContentLockedRef.current && !isProgrammatic) return;
    if (newContent === undefined || newContent === null) return;

    const updatedChapter = { ...currentChapter, content: newContent };
    setCurrentChapter(updatedChapter);
    pushToUndoHistory(newContent);

    if (skipPersist) return;

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    setIsSyncing(true);
    setSyncSuccess(false);
    const chapterId = currentChapter.id;

    const saveFn = async () => {
      await updateChapter(chapterId, {
        content: newContent,
        updatedAt: Date.now(),
        wordCount: newContent.replace(/\s/g, '').length,
      });
      pendingSaveRef.current = null;
      markSyncComplete();
    };

    pendingSaveRef.current = saveFn;
    syncTimeoutRef.current = setTimeout(saveFn, 1000);
  }, [currentChapter, isContentLockedRef, pushToUndoHistory, setCurrentChapter]);

  // ─── [BUG-01] 同步强行冲刷（Flush）编辑器内挂起的打字防抖正文并立即落盘 ───
  const flushPendingContentSync = useCallback(() => {
    if (contentRef.current && currentChapter) {
      const latestValue = contentRef.current.value;
      if (latestValue !== (currentChapter.content || '')) {
        // 1. 同步强制流转内存状态，防止后续的 React State batching 带来状态回退
        const updatedChapter = { ...currentChapter, content: latestValue };
        setCurrentChapter(updatedChapter);
        pushToUndoHistory(latestValue);

        // 2. 扼杀并清理尚未触发的挂起防抖定时器
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = null;
        }

        const chapterId = currentChapter.id;
        const finalWordCount = latestValue.replace(/\s/g, '').length;

        // 3. 立即触发物理 SQLite 数据库更新，不使用延时 setTimeout 机制
        updateChapter(chapterId, {
          content: latestValue,
          updatedAt: Date.now(),
          wordCount: finalWordCount,
        }).catch((e) => console.error('[useEditorPersistence] Failed to auto-flush content on change:', e));

        // 4. 同步修正侧边栏章节元数据中的字数和更新时间，保证全局一致
        setChapters((prev) =>
          prev.map((c) =>
            c.id === chapterId
              ? { ...c, wordCount: finalWordCount, updatedAt: Date.now() }
              : c
          )
        );

        // 5. 将保存标志状态置空，声明同步成功
        pendingSaveRef.current = null;
        setIsSyncing(false);
        setSyncSuccess(true);
      }
    }
  }, [contentRef, currentChapter, pushToUndoHistory, setCurrentChapter, setChapters]);

  const handleRestoreVersion = (version: ChapterVersion) => {
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
    flushPendingContentSync(); // ⚠️ 切换/增加新章节前，必须强制同步当前正在打字的内容
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

    // 1. Optimistic Update in Memory
    setChapters((prev) => [...prev, newChapterMeta]);
    setCurrentChapter({
      ...newChapterData,
      sceneBeats: '',
      critique: '',
    });
    setExpandedVolumes((prev) => (prev.includes(volumeName) ? prev : [...prev, volumeName]));

    // 2. Perform DB write in the background
    try {
      await createChapter(newChapterData);
    } catch (err) {
      console.error('[useEditorPersistence] Failed to create chapter in DB:', err);
    }
  };

  const handleAddFirstChapter = async () => {
    flushPendingContentSync(); // ⚠️ 初始化/创建首章前，确保无挂起的丢稿改动
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
    await deleteChapter(id);
    setChapters((prev) => {
      const remaining = prev.filter((chapter) => chapter.id !== id);
      if (currentChapter?.id === id) {
        const fallback = remaining.find((chapter) => chapter.id !== id);
        setCurrentChapter(fallback ? metadataToChapter(fallback) : null);
      }
      return remaining;
    });
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
    const freshChapters = await listChaptersMetadata(novel.id);
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
    flushPendingContentSync, // 导出供 EditorView.tsx 使用
    refreshChapters,
  };
}
