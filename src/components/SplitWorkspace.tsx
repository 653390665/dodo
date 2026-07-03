import { useEffect, useRef, useState } from 'react';
import { EditorView } from './EditorView';
import { WorldBibleView } from './WorldBibleView';
import { cn } from '../lib/utils';
import type { AssistantLaunchContext, ContinuationEditorLaunchState, Novel, WorkspaceFocus } from '../../shared/types';

interface SplitWorkspaceProps {
  novel: Novel;
  onboarding?: React.ComponentProps<typeof WorldBibleView>['onboarding'];
  onBack: () => void;
  focus: WorkspaceFocus;
  onFocusChange: (focus: WorkspaceFocus) => void;
  onOpenAssistant?: (context: AssistantLaunchContext) => void;
  continuationLaunchState?: ContinuationEditorLaunchState | null;
  onStartContinuationWriting?: (approvedPackId: string, prefillIntent?: string) => void;
  onEnterStoryboard?: (approvedPackId: string, continuationTask?: string) => void;
}

const FOCUS_SPLIT_RATIOS: Record<WorkspaceFocus, number> = {
  editor: 0.62,
  world: 0.42,
};

export function SplitWorkspace({
  novel,
  onboarding,
  onBack,
  focus,
  onFocusChange,
  onOpenAssistant,
  continuationLaunchState = null,
  onStartContinuationWriting,
  onEnterStoryboard,
}: SplitWorkspaceProps) {
  const [splitRatio, setSplitRatio] = useState(FOCUS_SPLIT_RATIOS[focus]);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing derived state from props
    setSplitRatio(FOCUS_SPLIT_RATIOS[focus]);
  }, [focus]);

  const handleFocusChange = (nextFocus: WorkspaceFocus) => {
    onFocusChange(nextFocus);
    setSplitRatio(FOCUS_SPLIT_RATIOS[nextFocus]);
  };

  const onMouseDown = () => {
    setDragging(true);
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = Math.max(0.3, Math.min(0.8, (e.clientX - rect.left) / rect.width));
      setSplitRatio(ratio);
    };
    const handleMouseUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 border-b border-theme-border/60 bg-theme-bg/40 px-4 py-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleFocusChange('editor')}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm transition-colors',
            focus === 'editor'
              ? 'bg-theme-sidebar border border-theme-border text-theme-text font-semibold shadow-sm'
              : 'text-theme-muted hover:text-theme-text hover:bg-theme-border/30'
          )}
        >
          写作优先
        </button>
        <button
          type="button"
          onClick={() => handleFocusChange('world')}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm transition-colors',
            focus === 'world'
              ? 'bg-theme-sidebar border border-theme-border text-theme-text font-semibold shadow-sm'
              : 'text-theme-muted hover:text-theme-text hover:bg-theme-border/30'
          )}
        >
          设定优先
        </button>
      </div>
      <div ref={containerRef} className="flex-1 flex min-h-0">
        <div style={{ width: `${splitRatio * 100}%` }} className="h-full overflow-hidden">
          <EditorView novel={novel} launchState={continuationLaunchState} onBack={onBack} onOpenAssistant={onOpenAssistant} />
        </div>
        <div
          onMouseDown={onMouseDown}
          className={`w-1.5 cursor-col-resize shrink-0 transition-colors ${
            dragging ? 'bg-theme-accent' : 'bg-theme-border/30 hover:bg-theme-accent/40'
          }`}
        />
        <div style={{ width: `${(1 - splitRatio) * 100}%` }} className="h-full overflow-hidden">
          <WorldBibleView novel={novel} onboarding={onboarding} onStartContinuationWriting={onStartContinuationWriting} onEnterStoryboard={onEnterStoryboard} />
        </div>
      </div>
    </div>
  );
}
