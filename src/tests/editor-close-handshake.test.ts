import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { bindEditorCloseSafety, collectPendingEditorSnapshot } from '../lib/editor-close-handshake';
import { __editorWriteQueueTestHooks, queueEditorWrite } from '../lib/editor-write-queue';

describe('desktop editor close handshake', () => {
  beforeEach(() => __editorWriteQueueTestHooks.reset());
  afterEach(() => __editorWriteQueueTestHooks.reset());

  test('completes immediately when there are no pending writes', async () => {
    let prepareClose!: () => Promise<void>;
    const readyToClose = vi.fn();
    const dispose = bindEditorCloseSafety(window, {
      onPrepareClose: (callback) => {
        prepareClose = async () => { await callback(1); };
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
        prepareClose = async () => { await callback(1); };
        return vi.fn();
      },
      readyToClose: async () => {
        contentObservedAtReady = isolatedDatabase.get('chapter-1') || '';
        return true;
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
        prepareClose = async () => { await callback(1); };
        return vi.fn();
      },
      readyToClose: vi.fn().mockResolvedValue(true),
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

  test('timeout-rejected late ready cannot approve a later close after cancel and new input', async () => {
    let prepareClose!: () => Promise<void>;
    const readyToClose = vi.fn().mockResolvedValue(false);
    const dispose = bindEditorCloseSafety(window, {
      onPrepareClose: (callback) => {
        prepareClose = async () => { await callback(1); };
        return vi.fn();
      },
      readyToClose,
    });

    // Main has already timed out, so it rejects this late renderer ready ack.
    await prepareClose();
    expect(readyToClose).toHaveBeenCalledTimes(1);

    // User cancels close in main and continues editing.
    queueEditorWrite('chapter:chapter-1:content', async () => true, 1000, {
      field: 'content', value: '超时后继续输入',
    });
    const reloadEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reloadEvent);
    expect(reloadEvent.defaultPrevented).toBe(true);
    dispose();
  });

  test('reports a failed close with an exportable pending snapshot and supports retry', async () => {
    let prepareClose!: () => Promise<void>;
    const closeSaveFailed = vi.fn();
    const reportCloseSnapshot = vi.fn();
    let shouldFail = true;
    queueEditorWrite('chapter:chapter-1:content', async () => {
      if (shouldFail) throw new Error('database locked');
      return true;
    }, 1000, { value: '最后一行', field: 'content' });

    const dispose = bindEditorCloseSafety(window, {
      onPrepareClose: (callback) => {
        let attemptId = 0;
        prepareClose = async () => { attemptId += 1; await callback(attemptId); };
        return vi.fn();
      },
      reportCloseSnapshot,
      closeSaveFailed,
      readyToClose: vi.fn().mockResolvedValue(true),
    });

    await prepareClose();
    expect(reportCloseSnapshot).toHaveBeenCalledWith(1, expect.objectContaining({
      pendingWrites: [expect.objectContaining({
        key: 'chapter:chapter-1:content',
        snapshot: { value: '最后一行', field: 'content' },
      })],
    }));
    expect(closeSaveFailed).toHaveBeenCalledWith(1, expect.objectContaining({ reason: 'database locked' }));

    shouldFail = false;
    await prepareClose();
    dispose();
  });

  test('snapshot collection ignores password inputs', () => {
    document.body.innerHTML = '<textarea name="chapter-content">未保存正文</textarea><input type="password" value="secret">';
    const snapshot = collectPendingEditorSnapshot(window);
    expect(snapshot.visibleFields).toEqual([
      expect.objectContaining({ name: 'chapter-content', value: '未保存正文' }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });
});
