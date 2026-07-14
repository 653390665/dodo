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

// ── Plan 132 T2: Dock re-activation single-server guarantee ──────────

test('ensurePackagedServerForWindow is single-flight and reuses a healthy backend', () => {
  const source = require('node:fs').readFileSync('electron.cjs', 'utf8');

  // The function must be wrapped in createSingleFlight
  assert.match(
    source,
    /const ensurePackagedServerForWindow = createSingleFlight\(performEnsurePackagedServer\)/,
  );

  // performEnsurePackagedServer must check child liveness before any start
  const ensureSource = source.slice(
    source.indexOf('async function performEnsurePackagedServer()'),
    source.indexOf('const ensurePackagedServerForWindow'),
  );

  // Must probe and reuse a healthy child WITHOUT overwriting serverProcess
  assert.match(ensureSource, /child\.exitCode === null/);
  assert.match(ensureSource, /probeHttp\(http\.get/);
  assert.match(ensureSource, /statusCode < 500/);

  // Must NOT call startServer() when child is alive and healthy
  // The startServer call must only appear in the dead-child branch
  const healthyBranch = ensureSource.slice(
    0,
    ensureSource.indexOf('// No live child'),
  );
  assert.doesNotMatch(healthyBranch, /await startServer\(/);

  // Dead-child branch must start fresh
  const deadBranch = ensureSource.slice(ensureSource.indexOf('// No live child'));
  assert.match(deadBranch, /await startServer\(/);
  assert.match(deadBranch, /await waitForServer\(port\)/);
  assert.match(deadBranch, /startWatchdog\(port\)/);
});

test('createWindow uses ensurePackagedServerForWindow in packaged mode and guards concurrency', () => {
  const source = require('node:fs').readFileSync('electron.cjs', 'utf8');

  // createWindow must use ensurePackagedServerForWindow instead of raw startServer
  const createWindowSource = source.slice(
    source.indexOf('async function createWindow()'),
    source.indexOf('// ── App Lifecycle'),
  );
  assert.match(createWindowSource, /port = await ensurePackagedServerForWindow\(\)/);

  // Must NOT directly call startServer() in the packaged path anymore
  // (the call moved into ensurePackagedServerForWindow)
  const packagedBranch = createWindowSource.slice(
    createWindowSource.indexOf('} else {'),
    createWindowSource.indexOf('} catch'),
  );
  assert.doesNotMatch(packagedBranch, /await startServer\(\)/);

  // Concurrent-activate guard must exist
  assert.match(source, /let createWindowInFlight = false/);
  assert.match(createWindowSource, /if \(createWindowInFlight\) return/);
  assert.match(createWindowSource, /createWindowInFlight = true/);
  assert.match(createWindowSource, /createWindowInFlight = false/);
});

test('ensurePackagedServerForWindow routes unhealthy live child through restart, not fresh start', () => {
  const source = require('node:fs').readFileSync('electron.cjs', 'utf8');
  const ensureSource = source.slice(
    source.indexOf('async function performEnsurePackagedServer()'),
    source.indexOf('const ensurePackagedServerForWindow'),
  );

  // When child is alive but probe returns >= 500, must call restartServer
  const unhealthySection = ensureSource.slice(
    ensureSource.indexOf('// Child alive but unhealthy'),
    ensureSource.indexOf('// No live child'),
  );
  assert.match(unhealthySection, /await restartServer\(\)/);
  // Must NOT call startServer in the unhealthy path
  assert.doesNotMatch(unhealthySection, /await startServer\(/);
});

test('performEnsurePackagedServer never nulls serverProcess while child is alive', () => {
  const source = require('node:fs').readFileSync('electron.cjs', 'utf8');
  const ensureSource = source.slice(
    source.indexOf('async function performEnsurePackagedServer()'),
    source.indexOf('const ensurePackagedServerForWindow'),
  );

  // The healthy branch must explicitly comment that it does not overwrite
  assert.match(ensureSource, /Do NOT overwrite serverProcess/);

  // The function must NOT contain serverProcess = null anywhere
  // (restart path uses stopServerAndWait which handles nulling safely)
  assert.doesNotMatch(ensureSource, /serverProcess = null/);
});
