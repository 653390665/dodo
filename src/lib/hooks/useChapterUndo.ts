import { useReducer, useRef, useCallback, useEffect, type RefObject } from 'react';
import { UndoState, createUndoState, pushToHistory, undo, redo } from '../undo-history';

interface UseChapterUndoOptions {
  currentContent: string;
  isContentLockedRef: RefObject<boolean>;
  onUndoRedo: (content: string) => void;
}

const undoReducer = (
  state: UndoState,
  action: { type: 'push'; content: string } | { type: 'undo' } | { type: 'redo' } | { type: 'reset'; content: string }
) => {
  switch (action.type) {
    case 'push':
      return pushToHistory(state, action.content);
    case 'undo':
      return undo(state);
    case 'redo':
      return redo(state);
    case 'reset':
      return createUndoState(action.content);
    default:
      return state;
  }
};

export function useChapterUndo({ currentContent, isContentLockedRef, onUndoRedo }: UseChapterUndoOptions) {
  const [undoState, dispatchUndo] = useReducer(undoReducer, currentContent, (initial) =>
    createUndoState(initial)
  );
  const undoPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced push to history
  const pushToUndoHistory = useCallback((content: string) => {
    if (undoPushTimerRef.current) clearTimeout(undoPushTimerRef.current);
    undoPushTimerRef.current = setTimeout(() => {
      dispatchUndo({ type: 'push', content });
    }, 2000);
  }, []);

  const handleUndo = useCallback(() => {
    if (isContentLockedRef.current) return;
    dispatchUndo({ type: 'undo' });
  }, [isContentLockedRef]);

  const handleRedo = useCallback(() => {
    if (isContentLockedRef.current) return;
    dispatchUndo({ type: 'redo' });
  }, [isContentLockedRef]);

  // Sync undo present back to the caller
  useEffect(() => {
    if (isContentLockedRef.current) return;
    if (undoState.present === currentContent) return;
    onUndoRedo(undoState.present);
  }, [undoState.present, isContentLockedRef, currentContent, onUndoRedo]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept if focus is in a different input/textarea than the main editor
      // This is a bit tricky without a ref, but we can check the active element
      if (
        e.target instanceof HTMLInputElement ||
        (e.target instanceof HTMLTextAreaElement && !e.target.classList.contains('writing-surface'))
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  // Expose manual push and reset
  const resetUndoHistory = useCallback((content: string) => {
    dispatchUndo({ type: 'reset', content });
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (undoPushTimerRef.current) clearTimeout(undoPushTimerRef.current);
    };
  }, []);

  return {
    undoState,
    pushToUndoHistory,
    handleUndo,
    handleRedo,
    resetUndoHistory,
  };
}
