import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { bindEditorCloseSafety } from '../lib/editor-close-handshake';
import { __editorWriteQueueTestHooks, queueEditorWrite } from '../lib/editor-write-queue';

describe('desktop editor close handshake', () => {
  beforeEach(() => __editorWriteQueueTestHooks.reset());
  afterEach(() => __editorWriteQueueTestHooks.reset());

  test('completes immediately when there are no pending writes', async () => {
    let prepareClose!: () => Promise<void>;
    const readyToClose = vi.fn();
    const dispose = bindEditorCloseSafety(window, {
      onPrepareClose: (callback) => {
        prepareClose = async () => { await callback(); };
        return vi.fn();
      },
      readyToClose,
    });

    await prepareClose();
    expect(readyToClose).toHaveBeenCalledTimes(1);
    dispose();
  });

  test('last input followed by immediate exit is persisted before ready and visible after restart', async () => {
    const isolatedDatabase = new Map<string, string>([['chapter-1', '旧正文']]);
    let prepareClose!: () => Promise<void>;
    let contentObservedAtReady = '';
    bindEditorCloseSafety(window, {
      onPrepareClose: (callback) => {
        prepareClose = async () => { await callback(); };
        return vi.fn();
      },
      readyToClose: () => {
        contentObservedAtReady = isolatedDatabase.get('chapter-1') || '';
      },
    });
    queueEditorWrite('chapter:chapter-1:content', async () => {
      isolatedDatabase.set('chapter-1', '退出前最后一次输入');
      return true;
    });

    await prepareClose();
    expect(contentObservedAtReady).toBe('退出前最后一次输入');
    // Simulated restart reads the independently persisted backing store.
    expect(isolatedDatabase.get('chapter-1')).toBe('退出前最后一次输入');
  });

  test('blocks desktop reload with pending writes but allows the approved close', async () => {
    let prepareClose!: () => Promise<void>;
    const dispose = bindEditorCloseSafety(window, {
      onPrepareClose: (callback) => {
        prepareClose = async () => { await callback(); };
        return vi.fn();
      },
      readyToClose: vi.fn(),
    });
    queueEditorWrite('chapter:chapter-1:content', async () => true);

    const reloadEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reloadEvent);
    expect(reloadEvent.defaultPrevented).toBe(true);

    await prepareClose();
    const approvedCloseEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(approvedCloseEvent);
    expect(approvedCloseEvent.defaultPrevented).toBe(false);
    dispose();
  });
});
