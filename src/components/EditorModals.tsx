import React, { useState, forwardRef, useImperativeHandle } from 'react';
import { ChapterVersion } from '../../shared/types';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from './ui/alert-dialog';

export interface EditorModalsHandle {
  confirmDeleteChapter: (chapterId: string) => void;
  confirmRestoreVersion: (version: ChapterVersion) => void;
}

interface EditorModalsProps {
  onDeleteChapter: (id: string) => void;
  onRestoreVersion: (version: ChapterVersion) => void;
}

export const EditorModals = forwardRef<EditorModalsHandle, EditorModalsProps>(
  ({ onDeleteChapter, onRestoreVersion }, ref) => {
    const [chapterToDeleteId, setChapterToDeleteId] = useState<string | null>(null);
    const [versionToRestore, setVersionToRestore] = useState<ChapterVersion | null>(null);

    useImperativeHandle(ref, () => ({
      confirmDeleteChapter: (chapterId: string) => {
        setChapterToDeleteId(chapterId);
      },
      confirmRestoreVersion: (version: ChapterVersion) => {
        setVersionToRestore(version);
      },
    }));

    return (
      <>
        <AlertDialog open={Boolean(chapterToDeleteId)} onOpenChange={(open) => !open && setChapterToDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定要删除这一章吗？</AlertDialogTitle>
              <AlertDialogDescription>
                此操作将永久删除本章的所有正文、分镜 beats 和历史版本，且不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (chapterToDeleteId) {
                    onDeleteChapter(chapterToDeleteId);
                    setChapterToDeleteId(null);
                  }
                }}
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
              >
                确认删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={Boolean(versionToRestore)} onOpenChange={(open) => !open && setVersionToRestore(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定要回滚到此版本吗？</AlertDialogTitle>
              <AlertDialogDescription>
                这将覆盖您当前编辑器的正文内容。建议您在回滚前确保已保存好当前草稿。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (versionToRestore) {
                    onRestoreVersion(versionToRestore);
                    setVersionToRestore(null);
                  }
                }}
                className="bg-theme-accent text-theme-bg font-bold hover:bg-theme-accent/90"
              >
                确认回滚
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }
);

EditorModals.displayName = 'EditorModals';
