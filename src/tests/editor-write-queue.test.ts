import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  __editorWriteQueueTestHooks,
  clearStaleEditorWrites,
  flushPendingEditorWrites,
  hasFailedEditorWrites,
  hasPendingEditorWrites,
  hasPendingWriteForExactKey,
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
    clearStaleEditorWrites();
    expect(hasPendingEditorWrites()).toBe(true);

    shouldFail = false;
    await flushPendingEditorWrites();
    expect(writer).toHaveBeenCalledTimes(2);
    expect(hasPendingEditorWrites()).toBe(false);
    expect(hasFailedEditorWrites()).toBe(false);
  });

  test('keeps a stale generation write recoverable without re-running it forever', async () => {
    const writer = vi.fn(async () => {
      throw Object.assign(new Error('database changed'), {
        status: 409,
        code: 'DB_GENERATION_CONFLICT',
      });
    });
    queueEditorWrite('chapter:1:content', writer, 0, { value: '待恢复正文' });

    await expect(flushPendingEditorWrites()).rejects.toMatchObject({
      status: 409,
      code: 'DB_GENERATION_CONFLICT',
    });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(hasFailedEditorWrites()).toBe(true);
    expect(getPendingEditorWriteSnapshots()).toEqual([{
      key: 'chapter:1:content',
      snapshot: { value: '待恢复正文' },
      failed: true,
    }]);

    await expect(flushPendingEditorWrites()).rejects.toMatchObject({ code: 'DB_GENERATION_CONFLICT' });
    expect(writer).toHaveBeenCalledTimes(1);

    clearStaleEditorWrites();
    expect(hasPendingEditorWrites()).toBe(false);
    expect(hasFailedEditorWrites()).toBe(false);

    queueEditorWrite('chapter:1:content', async () => true, 0, { value: '新代际正文' });
    await flushPendingEditorWrites();
    expect(hasPendingEditorWrites()).toBe(false);
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

  test('hasPendingWriteForExactKey returns true for pending write', () => {
    queueEditorWrite('novel:1:globalOutline', async () => true, 1000);
    expect(hasPendingWriteForExactKey('novel:1:globalOutline')).toBe(true);
  });

  test('hasPendingWriteForExactKey returns false for non-existent key', () => {
    queueEditorWrite('novel:1:globalOutline', async () => true, 1000);
    expect(hasPendingWriteForExactKey('novel:2:globalOutline')).toBe(false);
  });

  test('hasPendingWriteForExactKey returns false after flush', async () => {
    queueEditorWrite('novel:1:globalOutline', async () => true, 0);
    await flushPendingEditorWrites();
    expect(hasPendingWriteForExactKey('novel:1:globalOutline')).toBe(false);
  });

  test('hasPendingWriteForExactKey returns true for failed write', async () => {
    queueEditorWrite('novel:1:globalOutline', async () => { throw new Error('fail'); }, 0);
    await flushPendingEditorWrites().catch(() => {});
    expect(hasPendingWriteForExactKey('novel:1:globalOutline')).toBe(true);
  });

  test('hasPendingWriteForExactKey does not match partial key', () => {
    queueEditorWrite('novel:1:globalOutline', async () => true, 1000);
    expect(hasPendingWriteForExactKey('globalOutline')).toBe(false);
    expect(hasPendingWriteForExactKey('novel:1:')).toBe(false);
  });
});
