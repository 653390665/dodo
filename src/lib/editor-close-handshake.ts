import {
  flushPendingEditorWrites,
  getPendingEditorWriteSnapshots,
  hasPendingEditorWrites,
  subscribeToEditorWrites,
} from './editor-write-queue';

interface CloseBridge {
  onPrepareClose?: (callback: (attemptId: number) => void | Promise<void>) => () => void;
  readyToClose?: (attemptId: number) => Promise<boolean>;
  reportCloseSnapshot?: (attemptId: number, snapshot: PendingEditorCloseSnapshot) => void;
  closeSaveFailed?: (attemptId: number, details: { reason: string }) => void;
}

export interface PendingEditorCloseSnapshot {
  capturedAt: string;
  location: string;
  pendingWrites: ReturnType<typeof getPendingEditorWriteSnapshots>;
  visibleFields: Array<{ name: string; value: string }>;
}

export function collectPendingEditorSnapshot(target: Window): PendingEditorCloseSnapshot {
  const visibleFields = [...target.document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input:not([type="password"]), textarea, select',
  )]
    .filter((element) => !element.disabled && element.type !== 'hidden')
    .map((element, index) => ({
      name: element.name || element.id || element.getAttribute('aria-label') || `field-${index + 1}`,
      value: element.value,
    }));

  return {
    capturedAt: new Date().toISOString(),
    location: target.location.href,
    pendingWrites: getPendingEditorWriteSnapshots(),
    visibleFields,
  };
}

export async function flushEditorWritesForClose(
  readyToClose?: () => void,
  onFailure?: (error: unknown) => void,
): Promise<boolean> {
  try {
    await flushPendingEditorWrites();
    readyToClose?.();
    return true;
  } catch (error) {
    console.error('[editor-close-handshake] Failed to flush editor writes:', error);
    onFailure?.(error);
    return false;
  }
}

export function bindEditorCloseSafety(
  target: Window,
  bridge: CloseBridge | undefined,
): () => void {
  let closeApproved = false;
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (closeApproved || !hasPendingEditorWrites()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  const syncBeforeUnloadListener = () => {
    if (hasPendingEditorWrites()) closeApproved = false;
    target.removeEventListener('beforeunload', onBeforeUnload);
    if (hasPendingEditorWrites()) {
      target.addEventListener('beforeunload', onBeforeUnload);
    }
  };
  syncBeforeUnloadListener();
  const unsubscribeWrites = subscribeToEditorWrites(syncBeforeUnloadListener);
  const unsubscribeClose = bridge?.onPrepareClose?.(async (attemptId) => {
    bridge.reportCloseSnapshot?.(attemptId, collectPendingEditorSnapshot(target));
    const flushed = await flushEditorWritesForClose(undefined, (error) => {
      const reason = error instanceof Error ? error.message : 'Editor writes could not be persisted';
      bridge.closeSaveFailed?.(attemptId, { reason });
    });
    if (flushed) {
      closeApproved = await bridge.readyToClose?.(attemptId) === true;
    }
  });

  return () => {
    unsubscribeWrites();
    unsubscribeClose?.();
    target.removeEventListener('beforeunload', onBeforeUnload);
  };
}
