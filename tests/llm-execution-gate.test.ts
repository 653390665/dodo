import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLlmExecution, __llmExecutionGateTestHooks } from '../server/helpers/llm-execution-gate';
import { closeDb, createNovel, getNovel, initDb } from '../server/lib/db';
import { advanceDatabaseGeneration, getDatabaseGeneration } from '../server/lib/db-instance';

test('LLM execution gate reserves on run, commits success, and refunds failure', async () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-llm-gate-${Date.now()}.db`);
  initDb(dbPath);
  __llmExecutionGateTestHooks.reset();
  createNovel({
    id: 'gate-novel', title: 'Gate', authorId: 'local', summary: '', status: 'ongoing',
    projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      commercialMode: 'free',
      quotaLimits: { generateProseCount: 0, generateProseMax: 2 },
    },
    createdAt: 1, updatedAt: 1,
  });

  try {
    const unusedExecution = await createLlmExecution({
      operation: 'test-unused',
      novelId: 'gate-novel',
      quotaType: 'generateProse',
      timeoutMs: 1_000,
    });
    assert.ok(unusedExecution.traceId);
    assert.equal(getNovel('gate-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 0);

    const execution = await createLlmExecution({
      operation: 'test-failure',
      novelId: 'gate-novel',
      quotaType: 'generateProse',
      timeoutMs: 1_000,
    });
    await assert.rejects(execution.run(async () => {
      throw new Error('provider failed');
    }), /provider failed/);

    assert.equal(getNovel('gate-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 0);
    await assert.rejects(execution.run(async () => 'unexpected'), /only run once/);
    assert.equal(getNovel('gate-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 0);

    const successfulExecution = await createLlmExecution({
      operation: 'test-success',
      novelId: 'gate-novel',
      quotaType: 'generateProse',
      timeoutMs: 1_000,
    });
    assert.equal(await successfulExecution.run(async () => 'delivered'), 'delivered');
    assert.equal(getNovel('gate-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 1);
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});

test('LLM execution gate enforces concurrency and refunds a waiter that times out', async () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-llm-gate-concurrency-${Date.now()}.db`);
  initDb(dbPath);
  __llmExecutionGateTestHooks.reset();
  createNovel({
    id: 'concurrency-novel', title: 'Gate', authorId: 'local', summary: '', status: 'ongoing',
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      commercialMode: 'free', quotaLimits: { generateProseCount: 0, generateProseMax: 5 },
    },
    createdAt: 1, updatedAt: 1,
  });

  try {
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstActive!: () => void;
    const firstActive = new Promise<void>((resolve) => { markFirstActive = resolve; });
    const first = await createLlmExecution({
      operation: 'limited-operation', novelId: 'concurrency-novel', quotaType: 'generateProse', timeoutMs: 1_000, concurrency: 1,
    });
    const firstRun = first.run(async () => {
      markFirstActive();
      await firstStarted;
      return 'first';
    });
    await firstActive;

    const waiting = await createLlmExecution({
      operation: 'limited-operation', novelId: 'concurrency-novel', quotaType: 'generateProse', timeoutMs: 15, concurrency: 1,
    });
    await assert.rejects(waiting.run(async () => 'must not start'), /timed out/);
    assert.equal(getNovel('concurrency-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 1);

    releaseFirst();
    assert.equal(await firstRun, 'first');
    assert.equal(getNovel('concurrency-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 1);
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});

test('LLM execution gate returns on timeout when a provider ignores AbortSignal', async () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-llm-gate-provider-timeout-${Date.now()}.db`);
  initDb(dbPath);
  __llmExecutionGateTestHooks.reset();

  try {
    const execution = await createLlmExecution({
      operation: 'provider-timeout',
      novelId: undefined,
      timeoutMs: 15,
    });
    const startedAt = Date.now();
    await assert.rejects(
      execution.run(async () => new Promise<string>((resolve) => {
        setTimeout(() => resolve('late provider result'), 1_000);
      })),
      /timed out/,
    );
    assert.ok(Date.now() - startedAt < 500, 'timeout must not wait for an AbortSignal-ignoring provider');
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});

test('paid novel can execute inside an explicit database generation without a quota reservation', async () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-llm-gate-paid-${Date.now()}.db`);
  initDb(dbPath);
  __llmExecutionGateTestHooks.reset();
  createNovel({
    id: 'paid-generation-novel', title: 'Paid', authorId: 'local', summary: '', status: 'ongoing',
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      commercialMode: 'paid',
    },
    createdAt: 1, updatedAt: 1,
  });

  try {
    const execution = await createLlmExecution({
      operation: 'paid-generation',
      novelId: 'paid-generation-novel',
      quotaType: 'advancedAudit',
      timeoutMs: 1_000,
      databaseGeneration: getDatabaseGeneration(),
    });
    assert.equal(await execution.run(async () => 'delivered'), 'delivered');
    assert.equal(
      getNovel('paid-generation-novel')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount,
      undefined,
    );
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});

test('LLM execution gate aborts active provider work when database generation changes', async () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-llm-gate-generation-${Date.now()}.db`);
  initDb(dbPath);
  __llmExecutionGateTestHooks.reset();

  try {
    const execution = await createLlmExecution({
      operation: 'generation-change',
      novelId: undefined,
      timeoutMs: 1_000,
      databaseGeneration: getDatabaseGeneration(),
    });
    let providerSignal: AbortSignal | undefined;
    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => { markProviderStarted = resolve; });
    const running = execution.run(async ({ signal }) => {
      providerSignal = signal;
      markProviderStarted();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return 'unreachable';
    });

    await providerStarted;
    advanceDatabaseGeneration();

    await assert.rejects(running, /数据库已切换|database.*changed/i);
    assert.equal(providerSignal?.aborted, true);
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});

test('basic BYOK execution bypasses exhausted quota without creating a reservation', async () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-llm-gate-byok-${Date.now()}.db`);
  initDb(dbPath);
  __llmExecutionGateTestHooks.reset();
  createNovel({
    id: 'byok-exhausted-novel', title: 'BYOK', authorId: 'local', summary: '', status: 'ongoing',
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      commercialMode: 'free', quotaLimits: { generateProseCount: 1, generateProseMax: 1 },
    },
    createdAt: 1, updatedAt: 1,
  });

  try {
    const execution = await createLlmExecution({
      operation: 'byok-basic', novelId: 'byok-exhausted-novel', quotaType: 'generateProse',
      accessContext: 'basic-byok', timeoutMs: 1_000,
    });
    assert.equal(await execution.run(async () => 'delivered'), 'delivered');
    assert.equal(getNovel('byok-exhausted-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 1);
  } finally {
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});
