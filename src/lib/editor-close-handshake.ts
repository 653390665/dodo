import {
  flushPendingEditorWrites,
  hasPendingEditorWrites,
  subscribeToEditorWrites,
} from './editor-write-queue';

interface CloseBridge {
  onPrepareClose?: (callback: () => void | Promise<void>) => () => void;
  readyToClose?: () => void;
}

export async function flushEditorWritesForClose(readyToClose?: () => void): Promise<boolean> {
  try {
    await flushPendingEditorWrites();
    readyToClose?.();
    return true;
  } catch (error) {
    console.error('[editor-close-handshake] Failed to flush editor writes:', error);
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
    target.removeEventListener('beforeunload', onBeforeUnload);
    if (hasPendingEditorWrites()) {
      target.addEventListener('beforeunload', onBeforeUnload);
    }
  };
  syncBeforeUnloadListener();
  const unsubscribeWrites = subscribeToEditorWrites(syncBeforeUnloadListener);
  const unsubscribeClose = bridge?.onPrepareClose?.(async () => {
    await flushEditorWritesForClose(() => {
      closeApproved = true;
      bridge.readyToClose?.();
    });
  });

  return () => {
    unsubscribeWrites();
    unsubscribeClose?.();
    target.removeEventListener('beforeunload', onBeforeUnload);
  };
}
