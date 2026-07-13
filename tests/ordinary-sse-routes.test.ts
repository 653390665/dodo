import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { getConfig } from '../server/lib/config.js';
import { registerSimpleLlmRoutes } from '../server/routes/simple-llm.js';
import { registerWorldRoutes } from '../server/routes/world.js';

const originalFetch = globalThis.fetch;
const config = getConfig();
const originalConfig = {
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  model: config.model,
  promptGuardLevel: config.promptGuardLevel,
};

let server: ReturnType<express.Express['listen']>;
let baseUrl: string;

function mockUpstreamSse(content: string): Response {
  const encoder = new TextEncoder();
  const events = [
    `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n\n`,
    'data: [DONE]\n\n',
  ];
  let index = 0;

  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      pull(controller) {
        if (index >= events.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(events[index++]));
      },
    }),
  } as Response;
}

async function readSse(response: Response): Promise<{ body: string; done: boolean }> {
  const body = await response.text();
  return { body, done: body.split('\n').some((line) => line.trim() === 'data: [DONE]') };
}

before(() => {
  config.apiKey = 'test-api-key';
  config.baseUrl = 'https://api.openai.test/v1';
  config.model = 'test-model';
  config.promptGuardLevel = 'disabled';

  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(baseUrl)) {
      return originalFetch(url, init);
    }
    return mockUpstreamSse('流式测试内容');
  };

  const app = express();
  app.use(express.json());
  registerWorldRoutes(app);
  registerSimpleLlmRoutes(app);
  server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  baseUrl = `http://localhost:${port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  Object.assign(config, originalConfig);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('人物简介生成正常完成时发送 token 和 [DONE]', async () => {
  const response = await fetch(`${baseUrl}/api/generate-bio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '叶半夏' }),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const sse = await readSse(response);
  assert.match(sse.body, /"token":"流式测试内容"/);
  assert.equal(sse.done, true);
});

test('片段扩写正常完成时发送 token 和 [DONE]', async () => {
  const response = await fetch(`${baseUrl}/api/expand-fragment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '雨夜来客', type: '悬疑' }),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const sse = await readSse(response);
  assert.match(sse.body, /"token":"流式测试内容"/);
  assert.equal(sse.done, true);
});
