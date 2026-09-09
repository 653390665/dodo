import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../server/lib/server-llm.js';
import type { AppConfig } from '../server/lib/config';

/**
 * 流式重试卫生测试：
 * 1. 流中已向客户端下发 token 后发生可重试网络错误 —— 必须立即上抛，禁止重试
 *    （重试会把新完整文本经同一个 onToken 重发，造成正文重复拼接）。
 * 2. 0 token 即失败 —— 保持既有重试语义，重试成功且 onToken 序列无重复。
 *
 * 通过拦截 globalThis.fetch 模拟 SSE 流式返回，与 tests/server-llm-mock.test.ts 同一方式。
 */

const originalFetch = globalThis.fetch;

const config: AppConfig = {
  apiKey: 'sk-mock-test-key-12345',
  baseUrl: 'https://api.openai-mock.com/v1',
  model: 'gpt-4o',
  // 直接测 generateTextRaw 的流式重试语义，绕开 prompt/output guard 的改写与代理下发。
  promptGuardLevel: 'disabled',
  promptTemplates: {} as AppConfig['promptTemplates'],
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function sseDataLine(token: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n`;
}

/** 构造 SSE 流式响应体：依次下发 lines，可选在末尾抛出网络错误模拟 socket 中断。 */
function sseStreamBody(lines: string[], failure?: Error) {
  const encoder = new TextEncoder();
  let sent = 0;
  return {
    getReader() {
      return {
        read() {
          if (sent < lines.length) {
            const value = encoder.encode(lines[sent]);
            sent += 1;
            return Promise.resolve({ done: false, value } as ReadableStreamReadResult<Uint8Array>);
          }
          if (failure) return Promise.reject(failure);
          return Promise.resolve({ done: true, value: undefined } as ReadableStreamReadResult<Uint8Array>);
        },
      };
    },
  };
}

function okStreamResponse(body: unknown): Response {
  return { ok: true, status: 200, body } as unknown as Response;
}

test('does not retry a streaming attempt that already emitted tokens', async () => {
  let fetchCalls = 0;
  const receivedTokens: string[] = [];
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return okStreamResponse(sseStreamBody(
      [sseDataLine('雨'), sseDataLine('落')],
      new Error('read ECONNRESET — socket hung up mid-stream'),
    ));
  };

  await assert.rejects(
    generateText(config, {
      prompt: '写一个开头',
      maxAttempts: 3,
      onToken: (token) => receivedTokens.push(token),
    }),
    /ECONNRESET/,
  );

  // 已下发 2 个 token：不重试（仅 1 次请求）、不重发完整文本（恰 2 次 onToken）。
  assert.equal(fetchCalls, 1);
  assert.deepEqual(receivedTokens, ['雨', '落']);
});

test('retries a streaming attempt that failed before emitting any token', async () => {
  let fetchCalls = 0;
  const receivedTokens: string[] = [];
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      // 0 token 即失败：503 属可重试状态，保持既有重试语义。
      return {
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
      } as unknown as Response;
    }
    return okStreamResponse(sseStreamBody([
      sseDataLine('雨落在窗沿上。'),
      sseDataLine('他收起了伞。'),
      'data: [DONE]\n',
    ]));
  };

  const result = await generateText(config, {
    prompt: '写一个开头',
    maxAttempts: 3,
    onToken: (token) => receivedTokens.push(token),
  });

  assert.equal(fetchCalls, 2);
  assert.equal(result, '雨落在窗沿上。他收起了伞。');
  assert.deepEqual(receivedTokens, ['雨落在窗沿上。', '他收起了伞。']);
});
