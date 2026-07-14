import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  __editorWriteQueueTestHooks,
  flushPendingEditorWrites,
  hasFailedEditorWrites,
  hasPendingEditorWrites,
  getPendingEditorWriteSnapshots,
  queueEditorWrite,
} from '../lib/editor-write-queue';

describe('editor write boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __editorWriteQueueTestHooks.reset();
  });

  afterEach(() => {
    __editorWriteQueueTestHooks.reset();
    vi.useRealTimers();
  });

  test('flushes content, scene beats, outline, title, and volume within the debounce window', async () => {
    const persisted: string[] = [];
    for (const field of ['content', 'sceneBeats', 'globalOutline', 'title', 'volumeName']) {
      queueEditorWrite(`entity:${field}`, async () => {
        persisted.push(field);
        return true;
      });
    }

    expect(hasPendingEditorWrites()).toBe(true);
    await flushPendingEditorWrites();

    expect(persisted.sort()).toEqual(['content', 'globalOutline', 'sceneBeats', 'title', 'volumeName'].sort());
    expect(hasPendingEditorWrites()).toBe(false);
  });

  test('keeps a failed write pending, never treats it as success, and retries it', async () => {
    let shouldFail = true;
    const writer = vi.fn(async () => {
      if (shouldFail) throw new Error('disk unavailable');
      return true;
    });
    queueEditorWrite('chapter:1:content', writer);

    await expect(flushPendingEditorWrites()).rejects.toThrow('disk unavailable');
    expect(hasPendingEditorWrites()).toBe(true);
    expect(hasFailedEditorWrites()).toBe(true);

    shouldFail = false;
    await flushPendingEditorWrites();
    expect(writer).toHaveBeenCalledTimes(2);
    expect(hasPendingEditorWrites()).toBe(false);
    expect(hasFailedEditorWrites()).toBe(false);
  });

  test('an empty close boundary completes immediately', async () => {
    await expect(flushPendingEditorWrites()).resolves.toBeUndefined();
  });

  test('only the newest value for the same field is persisted', async () => {
    const persisted: string[] = [];
    queueEditorWrite('chapter:1:title', async () => { persisted.push('old'); return true; });
    queueEditorWrite('chapter:1:title', async () => { persisted.push('new'); return true; });

    await flushPendingEditorWrites();
    expect(persisted).toEqual(['new']);
  });

  test('exposes serializable pending snapshots without running writers', () => {
    const writer = vi.fn(async () => true);
    queueEditorWrite('chapter:1:content', writer, 1000, {
      value: '退出前未保存正文',
      field: 'content',
    });

    expect(getPendingEditorWriteSnapshots()).toEqual([{
      key: 'chapter:1:content',
      snapshot: { value: '退出前未保存正文', field: 'content' },
      failed: false,
    }]);
    expect(writer).not.toHaveBeenCalled();
  });
});
