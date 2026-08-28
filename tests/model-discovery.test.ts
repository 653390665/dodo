import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { normalizeModels, discoverModels } from '../server/helpers/model-discovery';
import { registerConfigRoutes } from '../server/routes/config';
import { getConfig } from '../server/lib/config';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';

// ── Unit: normalizeModels ──

test('normalizeModels trims, deduplicates, sorts, and caps', () => {
  const input = ['  gpt-4o  ', 'gpt-4o', 'claude-3', 'b-model', 'a-model'];
  const result = normalizeModels(input);
  assert.deepEqual(result, ['a-model', 'b-model', 'claude-3', 'gpt-4o']);
});

test('normalizeModels drops empty and oversized entries', () => {
  const long = 'x'.repeat(501);
  const result = normalizeModels(['', '  ', long, 'ok']);
  assert.deepEqual(result, ['ok']);
});

test('normalizeModels caps at 500 items', () => {
  const input = Array.from({ length: 600 }, (_, i) => `model-${String(i).padStart(3, '0')}`);
  const result = normalizeModels(input);
  assert.equal(result.length, 500);
  // Sorted, so first 500 alphabetically
  assert.equal(result[0], 'model-000');
  assert.equal(result[499], 'model-499');
});

// ── Integration: OpenAI model discovery via test-connection ──

function setupTestServer() {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-model-discovery-'));
  process.env.INKFLOW_DB_PATH = path.join(testDir, 'model-discovery.test.db');

  const config = getConfig();
  const originalConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    promptGuardLevel: config.promptGuardLevel,
  };
  config.apiKey = 'test-key';
  config.promptGuardLevel = 'disabled';
  config.baseUrl = 'https://api.openai-compat.test/v1';

  __rateLimitTestHooks.reset();

  const app = express();
  app.use(express.json());
  registerConfigRoutes(app);
  const server = app.listen(0, '127.0.0.1');

  return { app, server, config, originalConfig, testDir, ready: new Promise<void>(resolve => server.once('listening', resolve)) };
}

function teardownTestServer(ctx: ReturnType<typeof setupTestServer>, originalFetch: typeof fetch) {
  globalThis.fetch = originalFetch;
  const { server, config, originalConfig, testDir } = ctx;
  Object.assign(config, originalConfig);
  __rateLimitTestHooks.reset();
  server.close();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
}

function makeModelsResponse(models: string[]): Response {
  return Response.json({
    data: models.map(id => ({ id })),
  });
}

test('OpenAI discovery returns model list and skips probe for unknown model', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = setupTestServer();
  await ctx.ready;
  const { server } = ctx;
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/config/test-connection`;

  let modelsCalled = false;
  let chatCalled = false;

  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    const u = String(input);
    if (u.includes('/models')) {
      modelsCalled = true;
      return makeModelsResponse(['gpt-4o', 'gpt-4o-mini', 'claude-3']);
    }
    if (u.includes('/chat/completions')) {
      chatCalled = true;
      return Response.json({ choices: [{ message: { content: 'OK' } }] });
    }
    return Response.json({ error: 'unexpected' }, { status: 404 });
  }) as typeof fetch;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'unknown-model' }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.modelDiscovery, 'available');
    assert.ok(Array.isArray(data.models) && data.models.length === 3);
    assert.equal(data.selectedModelValid, false);
    assert.equal(data.modelTested, false);
    assert.ok(data.message.includes('不在可用列表中'));
    assert.ok(modelsCalled);
    assert.ok(!chatCalled, 'chat completions must not be called for unknown model');
  } finally {
    teardownTestServer(ctx, originalFetch);
  }
});

test('OpenAI discovery + known model triggers connection probe', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = setupTestServer();
  await ctx.ready;
  const { server } = ctx;
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/config/test-connection`;

  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    const u = String(input);
    if (u.includes('/models')) {
      return makeModelsResponse(['deepseek-chat', 'deepseek-coder']);
    }
    if (u.includes('/chat/completions')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        max_tokens?: number;
        max_completion_tokens?: number;
      };
      const outputBudget = body.max_tokens ?? body.max_completion_tokens ?? 0;
      assert.ok(outputBudget >= 128, 'connection probe output budget must support reasoning models');
      return Response.json({ choices: [{ message: { content: 'OK' } }] });
    }
    return Response.json({ error: 'unexpected' }, { status: 404 });
  }) as typeof fetch;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat' }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.connectionOk, true);
    assert.equal(data.selectedModelValid, true);
    assert.equal(data.modelTested, true);
    assert.equal(data.message, 'OK');
  } finally {
    teardownTestServer(ctx, originalFetch);
  }
});

test('404 from /models degrades to unsupported without models', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = setupTestServer();
  await ctx.ready;
  const { server } = ctx;
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/config/test-connection`;

  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    const u = String(input);
    if (u.includes('/models')) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    if (u.includes('/chat/completions')) {
      return Response.json({ choices: [{ message: { content: 'OK' } }] });
    }
    return Response.json({ error: 'unexpected' }, { status: 404 });
  }) as typeof fetch;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'my-custom-model' }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.modelDiscovery, 'unsupported');
    assert.equal(data.models.length, 0);
    // Custom model + unsupported → probe succeeds, model is valid
    assert.equal(data.modelTested, true);
    assert.equal(data.selectedModelValid, true);
    assert.equal(data.connectionOk, true);
    assert.equal(data.ok, true);
  } finally {
    teardownTestServer(ctx, originalFetch);
  }
});

test('401 from /models surfaces as API Key credential error', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = setupTestServer();
  await ctx.ready;
  const { server } = ctx;
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/config/test-connection`;

  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    const u = String(input);
    if (u.includes('/models')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  }) as typeof fetch;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o' }),
    });
    assert.equal(response.status, 401);
    const data = await response.json();
    assert.ok(data.error.includes('API Key'));
  } finally {
    teardownTestServer(ctx, originalFetch);
  }
});

test('bad JSON from /models degrades to unsupported', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = setupTestServer();
  await ctx.ready;
  const { server } = ctx;
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/config/test-connection`;

  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    const u = String(input);
    if (u.includes('/models')) {
      return new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  }) as typeof fetch;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'custom' }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.modelDiscovery, 'unsupported');
    assert.equal(data.models.length, 0);
  } finally {
    teardownTestServer(ctx, originalFetch);
  }
});

test('discovery normalizes and deduplicates model list', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = setupTestServer();
  await ctx.ready;
  const { server } = ctx;
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/config/test-connection`;

  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    const u = String(input);
    if (u.includes('/models')) {
      return makeModelsResponse(['  z-model  ', 'z-model', 'a-model', 'b-model']);
    }
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  }) as typeof fetch;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'a-model' }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(data.models, ['a-model', 'b-model', 'z-model']);
  } finally {
    teardownTestServer(ctx, originalFetch);
  }
});

test('empty model field with available discovery returns model list for selection', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = setupTestServer();
  await ctx.ready;
  const { server } = ctx;
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/config/test-connection`;

  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    const u = String(input);
    if (u.includes('/models')) {
      return makeModelsResponse(['gpt-4o', 'gpt-4o-mini']);
    }
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  }) as typeof fetch;

  try {
    // Set model to empty in config
    ctx.config.model = '';

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: '' }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.modelDiscovery, 'available');
    assert.ok(data.models.length === 2);
    assert.equal(data.selectedModelValid, false);
    assert.equal(data.modelTested, false);
    assert.ok(data.message.includes('请从已发现的模型中选择'));
  } finally {
    ctx.config.model = '';
    teardownTestServer(ctx, originalFetch);
  }
});

// ── Additional discovery unit tests ──

test('discoverModels with pre-aborted signal propagates error', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  // The error is re-thrown by discoverOpenAIModels when signal is aborted.
  await assert.rejects(
    () => discoverModels(
      { apiKey: 'test', baseUrl: 'https://api.example.com/v1', model: 'test', promptTemplates: {} as any },
      controller.signal,
    ),
    /cancelled/i,
  );
});

test('discoverModels with pre-aborted signal without reason still throws', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => discoverModels(
      { apiKey: 'test', baseUrl: 'https://api.example.com/v1', model: 'test', promptTemplates: {} as any },
      controller.signal,
    ),
    /aborted/i,
  );
});

test('403 from /models surfaces as API Key credential error', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = setupTestServer();
  await ctx.ready;
  const { server } = ctx;
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/config/test-connection`;

  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    const u = String(input);
    if (u.includes('/models')) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  }) as typeof fetch;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o' }),
    });
    assert.equal(response.status, 401);
    const data = await response.json();
    assert.ok(data.error.includes('API Key'));
  } finally {
    teardownTestServer(ctx, originalFetch);
  }
});

test('discovery with empty API response returns unsupported', async () => {
  const originalFetch = globalThis.fetch;
  const ctx = setupTestServer();
  await ctx.ready;
  const { server } = ctx;
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/config/test-connection`;

  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    const u = String(input);
    if (u.includes('/models')) {
      return Response.json({ data: [] }, { status: 200 });
    }
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  }) as typeof fetch;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'custom-model' }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.modelDiscovery, 'unsupported');
    assert.equal(data.models.length, 0);
    // Unsupported discovery + custom model → probe attempted
    assert.equal(data.modelTested, true);
  } finally {
    teardownTestServer(ctx, originalFetch);
  }
});
