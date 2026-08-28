import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createCloseHandshake } = require('../electron-close-handshake.cjs');

test('first close is intercepted, renderer ready clears timeout and allows the second close', () => {
  const calls: string[] = [];
  let timeoutCallback!: () => void;
  const handshake = createCloseHandshake({
    sendPrepare: () => calls.push('prepare'),
    allowClose: () => calls.push('close'),
    logTimeout: () => calls.push('timeout'),
    setTimer: (callback: () => void, delay: number) => {
      assert.equal(delay, 5000);
      timeoutCallback = callback;
      return 7;
    },
    clearTimer: (timer: number) => calls.push(`clear:${timer}`),
  });
  let prevented = 0;

  assert.equal(handshake.requestClose({ preventDefault: () => { prevented += 1; } }), false);
  assert.equal(prevented, 1);
  assert.deepEqual(calls, ['prepare']);
  assert.equal(handshake.rendererReady(handshake.getAttemptId()), true);
  assert.deepEqual(calls, ['prepare', 'clear:7', 'close']);
  assert.equal(handshake.requestClose({ preventDefault: () => { prevented += 1; } }), true);
  assert.equal(prevented, 1);
  assert.ok(timeoutCallback);
});

test('five second timeout blocks close until the user explicitly abandons the pending save', () => {
  const calls: string[] = [];
  let timeoutCallback!: () => void;
  const handshake = createCloseHandshake({
    sendPrepare: () => calls.push('prepare'),
    allowClose: () => calls.push('close'),
    onBlocked: ({ reason }: { reason: string }) => calls.push(`blocked:${reason}`),
    setTimer: (callback: () => void, delay: number) => {
      assert.equal(delay, 5000);
      timeoutCallback = callback;
      return 1;
    },
  });

  handshake.requestClose({ preventDefault() {} });
  timeoutCallback();
  assert.deepEqual(calls, ['prepare', 'blocked:timeout']);
  assert.equal(handshake.isComplete(), false);
  assert.equal(handshake.getState(), 'blocked');
  assert.equal(handshake.rendererReady(handshake.getAttemptId()), false);
  assert.deepEqual(calls, ['prepare', 'blocked:timeout']);

  assert.equal(handshake.abandon(), true);
  assert.deepEqual(calls, ['prepare', 'blocked:timeout', 'close']);
  assert.equal(handshake.isComplete(), true);
});

test('failed save can be retried and only renderer ready permits close', () => {
  const calls: string[] = [];
  const handshake = createCloseHandshake({
    sendPrepare: () => calls.push('prepare'),
    allowClose: () => calls.push('close'),
    onBlocked: ({ reason }: { reason: string }) => calls.push(`blocked:${reason}`),
    setTimer: () => 1,
  });

  handshake.requestClose({ preventDefault() {} });
  const firstAttemptId = handshake.getAttemptId();
  handshake.rendererSnapshot(firstAttemptId, { pendingWrites: [{ key: 'chapter:1:content', value: 'draft' }] });
  assert.equal(handshake.rendererFailed(firstAttemptId, 'disk unavailable'), true);
  assert.deepEqual(calls, ['prepare', 'blocked:save-failed']);
  assert.equal(handshake.getSnapshot().pendingWrites[0].value, 'draft');

  assert.equal(handshake.retry(), true);
  assert.deepEqual(calls, ['prepare', 'blocked:save-failed', 'prepare']);
  assert.equal(handshake.rendererReady(handshake.getAttemptId()), true);
  assert.deepEqual(calls, ['prepare', 'blocked:save-failed', 'prepare', 'close']);
});

test('failed save followed by explicit abandon bypasses the renderer close guard', () => {
  const calls: string[] = [];
  const handshake = createCloseHandshake({
    sendPrepare: () => calls.push('prepare'),
    allowClose: () => calls.push('close'),
    abandonClose: () => calls.push('destroy'),
    onBlocked: ({ reason }: { reason: string }) => calls.push(`blocked:${reason}`),
    setTimer: () => 1,
  });

  handshake.requestClose({ preventDefault() {} });
  const attemptId = handshake.getAttemptId();
  handshake.rendererSnapshot(attemptId, { pendingWrites: [{ key: 'chapter:1:content', value: 'draft' }] });
  assert.equal(handshake.rendererFailed(attemptId, 'database locked'), true);

  assert.equal(handshake.abandon(), true);
  assert.deepEqual(calls, ['prepare', 'blocked:save-failed', 'destroy']);
  assert.equal(handshake.isComplete(), true);
});

test('a late ready from a timed-out attempt cannot approve a retry attempt', () => {
  const calls: string[] = [];
  let timeoutCallback!: () => void;
  const handshake = createCloseHandshake({
    sendPrepare: (attemptId: number) => calls.push(`prepare:${attemptId}`),
    allowClose: () => calls.push('close'),
    onBlocked: ({ reason }: { reason: string }) => calls.push(`blocked:${reason}`),
    setTimer: (callback: () => void) => {
      timeoutCallback = callback;
      return 1;
    },
  });

  handshake.requestClose({ preventDefault() {} });
  const staleAttemptId = handshake.getAttemptId();
  timeoutCallback();
  assert.equal(handshake.retry(), true);
  const retryAttemptId = handshake.getAttemptId();
  assert.notEqual(staleAttemptId, retryAttemptId);

  assert.equal(handshake.rendererReady(staleAttemptId), false);
  assert.equal(handshake.getState(), 'awaiting-renderer');
  assert.equal(handshake.rendererReady(retryAttemptId), true);
  assert.deepEqual(calls, ['prepare:1', 'blocked:timeout', 'prepare:2', 'close']);
});

test('Electron main validates ready IPC before completing the close handshake', () => {
  const source = require('node:fs').readFileSync('electron.cjs', 'utf8');
  assert.match(source, /ipcMain\.handle\('renderer-ready-to-close',[\s\S]*rejectUntrustedIpc\(event\)[\s\S]*return closeHandshake\?\.rendererReady\(attemptId\)/);
  assert.match(source, /ipcMain\.on\('renderer-close-snapshot',[\s\S]*rejectUntrustedIpc\(event\)[\s\S]*closeHandshake\?\.rendererSnapshot/);
  assert.match(source, /ipcMain\.on\('renderer-close-save-failed',[\s\S]*rejectUntrustedIpc\(event\)[\s\S]*closeHandshake\?\.rendererFailed/);
});

test('renderer close requests enter the validated main-window handshake', () => {
  const mainSource = require('node:fs').readFileSync('electron.cjs', 'utf8');
  const preloadSource = require('node:fs').readFileSync('electron-preload.cjs', 'utf8');
  const lifecycleSource = require('node:fs').readFileSync('scripts/packaged-editor-lifecycle.mjs', 'utf8');

  assert.match(mainSource, /ipcMain\.on\('request-close',[\s\S]*rejectUntrustedIpc\(event\)[\s\S]*mainWindow\.close\(\)/);
  assert.match(preloadSource, /requestClose:\s*\(\)\s*=>\s*ipcRenderer\.send\('request-close'\)/);
  assert.match(preloadSource, /readyToClose:\s*\(attemptId\)\s*=>\s*ipcRenderer\.invoke\('renderer-ready-to-close', attemptId\)/);
  assert.match(lifecycleSource, /inkflow\.requestClose\(\)/);
  assert.doesNotMatch(lifecycleSource, /globalThis\.close\(\)/);
});

test('Electron close recovery offers retry, export, and explicit discard without timeout auto-close', () => {
  const source = require('node:fs').readFileSync('electron.cjs', 'utf8');
  assert.match(source, /Editor flush timed out after 5000ms/);
  assert.match(source, /重试保存/);
  assert.match(source, /导出未保存内容/);
  assert.match(source, /放弃并退出/);
  assert.match(source, /closeHandshake\?\.retry\(\)/);
  assert.match(source, /closeHandshake\?\.abandon\(\)/);
  assert.match(source, /abandonClose:[\s\S]*mainWindow\.destroy\(\)/);
  assert.doesNotMatch(source, /timed out[\s\S]{0,160}allowing window close/i);
});
