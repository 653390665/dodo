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
  assert.equal(handshake.rendererReady(), true);
  assert.deepEqual(calls, ['prepare', 'clear:7', 'close']);
  assert.equal(handshake.requestClose({ preventDefault: () => { prevented += 1; } }), true);
  assert.equal(prevented, 1);
  assert.ok(timeoutCallback);
});

test('five second timeout logs the failure and allows close', () => {
  const calls: string[] = [];
  let timeoutCallback!: () => void;
  const handshake = createCloseHandshake({
    sendPrepare: () => calls.push('prepare'),
    allowClose: () => calls.push('close'),
    logTimeout: () => calls.push('timeout'),
    setTimer: (callback: () => void, delay: number) => {
      assert.equal(delay, 5000);
      timeoutCallback = callback;
      return 1;
    },
  });

  handshake.requestClose({ preventDefault() {} });
  timeoutCallback();
  assert.deepEqual(calls, ['prepare', 'timeout', 'close']);
  assert.equal(handshake.isComplete(), true);
});

test('Electron main validates ready IPC before completing the close handshake', () => {
  const source = require('node:fs').readFileSync('electron.cjs', 'utf8');
  assert.match(source, /ipcMain\.on\('renderer-ready-to-close',[\s\S]*rejectUntrustedIpc\(event\)[\s\S]*closeHandshake\?\.rendererReady\(\)/);
});

test('renderer close requests enter the validated main-window handshake', () => {
  const mainSource = require('node:fs').readFileSync('electron.cjs', 'utf8');
  const preloadSource = require('node:fs').readFileSync('electron-preload.cjs', 'utf8');
  const lifecycleSource = require('node:fs').readFileSync('scripts/packaged-editor-lifecycle.mjs', 'utf8');

  assert.match(mainSource, /ipcMain\.on\('request-close',[\s\S]*rejectUntrustedIpc\(event\)[\s\S]*mainWindow\.close\(\)/);
  assert.match(preloadSource, /requestClose:\s*\(\)\s*=>\s*ipcRenderer\.send\('request-close'\)/);
  assert.match(lifecycleSource, /inkflow\.requestClose\(\)/);
  assert.doesNotMatch(lifecycleSource, /globalThis\.close\(\)/);
});

test('Electron close timeout records the failure and visibly warns the user', () => {
  const source = require('node:fs').readFileSync('electron.cjs', 'utf8');
  assert.match(source, /Editor flush timed out after 5000ms/);
  assert.match(source, /dialog\.showErrorBox\([\s\S]*保存超时/);
});
