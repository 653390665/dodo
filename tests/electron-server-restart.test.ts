import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createSingleFlight, probeHttp, terminateChild, waitForChildExit } = require('../electron-server-restart.cjs');

test('concurrent watchdog failures share one restart operation', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let restarts = 0;
  const restart = createSingleFlight(async () => {
    restarts += 1;
    await gate;
    return 43123;
  });

  const first = restart();
  const second = restart();
  assert.equal(first, second);
  assert.equal(restarts, 0);
  release();
  assert.equal(await first, 43123);
  assert.equal(await second, 43123);
  assert.equal(restarts, 1);
});

test('hung HTTP probes time out and destroy their request', async () => {
  const request = new EventEmitter() as EventEmitter & { destroy: (error?: Error) => void };
  let destroyedWith: Error | undefined;
  request.destroy = (error?: Error) => {
    destroyedWith = error;
  };

  await assert.rejects(
    probeHttp(() => request, 'http://localhost:43123', 5),
    /timed out/i,
  );
  assert.match(destroyedWith?.message || '', /timed out/i);
});

test('successful HTTP probes drain the response body', async () => {
  const request = new EventEmitter();
  let resumed = false;
  const status = await probeHttp((_url: string, onResponse: (response: unknown) => void) => {
    queueMicrotask(() => onResponse({ statusCode: 204, resume: () => { resumed = true; } }));
    return request;
  }, 'http://localhost:43123', 100);

  assert.equal(status, 204);
  assert.equal(resumed, true);
});

test('restart waits for the old child exit signal', async () => {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null };
  child.exitCode = null;
  let settled = false;
  const waiting = waitForChildExit(child, 1000).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  child.emit('exit', 0);
  await waiting;
  assert.equal(settled, true);
});

test('stubborn old child is force-killed and must exit before restart may continue', async () => {
  const signals: Array<string | undefined> = [];
  const child = {
    exitCode: null,
    kill: (signal?: string) => { signals.push(signal); },
  };
  const waits = [false, true];
  const stopped = await terminateChild(child, {
    waitForExit: async () => waits.shift(),
    gracefulTimeoutMs: 5000,
    forceTimeoutMs: 2000,
  });
  assert.equal(stopped, true);
  assert.deepEqual(signals, [undefined, 'SIGKILL']);
});

test('restart remains blocked when the old child survives SIGKILL timeout', async () => {
  const signals: Array<string | undefined> = [];
  const child = {
    exitCode: null,
    kill: (signal?: string) => { signals.push(signal); },
  };
  const stopped = await terminateChild(child, {
    waitForExit: async () => false,
    gracefulTimeoutMs: 5000,
    forceTimeoutMs: 2000,
  });
  assert.equal(stopped, false);
  assert.deepEqual(signals, [undefined, 'SIGKILL']);
});

test('watchdog restart preserves the renderer origin and pending writes', () => {
  const source = require('node:fs').readFileSync('electron.cjs', 'utf8');
  const restartSource = source.slice(
    source.indexOf('async function performServerRestart()'),
    source.indexOf('const restartServer = createSingleFlight'),
  );
  assert.match(restartSource, /const previousPort = serverPort;[\s\S]*startServer\(previousPort\)/);
  assert.match(restartSource, /if \(port !== previousPort\)[\s\S]*refusing unsafe renderer reload/);
  assert.doesNotMatch(restartSource, /loadURL\(/);
  assert.match(source, /will-navigate[\s\S]*isAppOrigin\(url, currentAppOrigin\)/);
  assert.match(source, /setWindowOpenHandler[\s\S]*isAppOrigin\(url, currentAppOrigin\)/);
  assert.doesNotMatch(source, /const appOrigin = currentAppOrigin/);
  assert.match(source, /INKFLOW_FIXED_PORT: 'true'/);
  assert.match(source, /runWatchdogCheck = createSingleFlight/);
  assert.match(source, /probeHttp\(http\.get/);
});
