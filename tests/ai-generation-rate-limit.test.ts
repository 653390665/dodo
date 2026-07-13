import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { getConfig } from '../server/lib/config';
import { registerSimpleLlmRoutes } from '../server/routes/simple-llm';
import { registerWorldRoutes } from '../server/routes/world';

test('high-frequency AI generation routes stop before the LLM when rate limited', async (t) => {
  const originalFetch = globalThis.fetch;
  const config = getConfig();
  const originalConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    promptGuardLevel: config.promptGuardLevel,
  };
  const limiter = await import('../server/middleware/rate-limit') as typeof import('../server/middleware/rate-limit') & {
    __rateLimitTestHooks?: { reset: () => void };
  };

  const app = express();
  app.use(express.json());
  registerWorldRoutes(app);
  registerSimpleLlmRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let upstreamCalls = 0;

  const waitForUpstreamCalls = async (expected: number) => {
    for (let attempt = 0; attempt < 100 && upstreamCalls < expected; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(upstreamCalls, expected, 'expected the allowed request to enter the LLM handler');
  };

  const request = async (
    path: string,
    body: Record<string, unknown>,
    responseType: 'sse' | 'job',
  ) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (responseType === 'sse' && response.ok) {
      await response.text();
    } else if (response.ok) {
      const payload = await response.json() as { jobId?: string };
      assert.equal(typeof payload.jobId, 'string');
    }
    return response;
  };

  const assertRouteLimited = async (
    path: string,
    body: Record<string, unknown>,
    responseType: 'sse' | 'job',
  ) => {
    limiter.__rateLimitTestHooks?.reset();
    const initialCalls = upstreamCalls;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request(path, body, responseType);
      assert.equal(response.status, 200);
      await waitForUpstreamCalls(initialCalls + attempt);
    }

    const callsBeforeBlockedRequest = upstreamCalls;
    const blocked = await request(path, body, responseType);
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: 'Rate limited', retryAfter: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(upstreamCalls, callsBeforeBlockedRequest, 'rate-limited request must not call the LLM');
  };

  try {
    config.apiKey = 'test-api-key';
    config.baseUrl = 'https://rate-limit.test/v1';
    config.model = 'test-model';
    config.promptGuardLevel = 'disabled';

    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith(baseUrl)) {
        return originalFetch(input, init);
      }
      upstreamCalls += 1;
      const requestBody = JSON.parse(String(init?.body || '{}')) as { stream?: boolean };
      if (requestBody.stream) {
        return new Response(
          'data: {"choices":[{"delta":{"content":"生成内容"}}]}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }
      return Response.json({
        choices: [{
          message: {
            content: '{"entityType":"item","name":"玄铁剑","type":"武器","description":"测试描述"}',
          },
        }],
      });
    };

    await t.test('limits fragment expansion', () => assertRouteLimited(
      '/api/expand-fragment',
      { content: '雨夜来客', type: '悬疑' },
      'sse',
    ));
    await t.test('limits character bio generation', () => assertRouteLimited(
      '/api/generate-bio',
      { name: '叶半夏' },
      'sse',
    ));
    await t.test('limits outline generation', () => assertRouteLimited(
      '/api/generate-outline',
      { title: '测试小说', worldRules: '测试法则', seedOutline: '故事开端', expectedWordCount: 10_000 },
      'job',
    ));
    await t.test('limits entity detail generation', () => assertRouteLimited(
      '/api/generate-entity-details',
      { name: '玄铁剑', type: 'item', context: '主角在遗迹中拾得' },
      'job',
    ));
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    limiter.__rateLimitTestHooks?.reset();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
