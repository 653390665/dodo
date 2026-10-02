import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHoldbackSink,
  generateText,
  holdbackWindowForChunk,
  STREAM_HOLDBACK_CHARS,
  STREAM_HOLDBACK_MAX_CHARS,
  STREAM_HOLDBACK_MIN_CHARS,
} from '../server/lib/server-llm.js';
import type { AppConfig } from '../server/lib/config';

/**
 * Plan 273：strict 守门下的 holdback 分段透传。
 * 1. sink 语义：只回发末尾窗口之外的内容，flush 补尾、discard 丢弃尾部。
 * 2. 过门：正文在生成过程中就分段可见，且拼接结果与最终正文逐字一致（无重复投递）。
 * 3. 不过门：被否决那一稿的尾部留在窗口里被丢弃，纠正稿整段回发。
 * 4. 缺省（无 streamHoldback）：维持旧的整段回发行为。
 */

const originalFetch = globalThis.fetch;

const config: AppConfig = {
  apiKey: 'sk-mock-test-key-12345',
  baseUrl: 'https://api.openai-mock.com/v1',
  model: 'gpt-4o',
  promptGuardLevel: 'strict',
  promptTemplates: {} as AppConfig['promptTemplates'],
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

// 与 tests/prompt-guard.test.ts 同一组判据样本：一个必过、一个必挂。
const CLEAN_TEXT =
  '他捏紧了茶杯，指尖用力到发白。门外的冷雨敲打着青瓦，发出一声声冷硬的闷响。他没有回头。';
const SLOP_TEXT = '他忍不住倒吸一口凉气，嘴角勾起一抹邪笑。他不禁感到非常生气，瞳孔微缩。';

function sseDataLine(token: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n`;
}

/** 与 tests/llm-stream-retry.test.ts 同一方式：拦截 globalThis.fetch 模拟 SSE。 */
function sseStreamBody(lines: string[]) {
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
          return Promise.resolve({ done: true, value: undefined } as ReadableStreamReadResult<Uint8Array>);
        },
      };
    },
  };
}

function streamResponse(tokens: string[]): Response {
  return {
    ok: true,
    status: 200,
    body: sseStreamBody([...tokens.map(sseDataLine), 'data: [DONE]\n']),
  } as unknown as Response;
}

function jsonResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

test('createHoldbackSink keeps the trailing window pending until flush', () => {
  const emitted: string[] = [];
  const sink = createHoldbackSink((token) => emitted.push(token), 4);

  sink.push('abc');
  assert.deepEqual(emitted, []);
  sink.push('de');
  assert.deepEqual(emitted, ['a']);
  sink.push('fghij');
  assert.deepEqual(emitted, ['a', 'bcdef']);
  sink.flush();
  assert.equal(emitted.join(''), 'abcdefghij');

  sink.push('xyz');
  sink.discard();
  sink.flush();
  assert.equal(emitted.join(''), 'abcdefghij');
});

test('default holdback window stays inside the clamp', () => {
  assert.equal(STREAM_HOLDBACK_CHARS > 0, true);
  assert.equal(STREAM_HOLDBACK_CHARS <= STREAM_HOLDBACK_MAX_CHARS, true);
});

test('streams the draft while it is still being written when the gate passes', async () => {
  let fetchCalls = 0;
  const emitted: string[] = [];
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return streamResponse(chunkText(CLEAN_TEXT, 5));
  };

  const result = await generateText(config, {
    prompt: '写一个开头',
    streamHoldback: 8,
    onToken: (token) => emitted.push(token),
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result, CLEAN_TEXT);
  // 分段可见，但拼接结果与最终正文逐字一致（末尾窗口由 flush 补齐，无重复投递）。
  assert.equal(emitted.join(''), CLEAN_TEXT);
  assert.equal(emitted.length >= 3, true, `expected incremental delivery, got ${emitted.length} batches`);
  assert.equal(emitted[0].length < CLEAN_TEXT.length, true);
});

test('discards the rejected tail and republishes the corrected draft', async () => {
  let fetchCalls = 0;
  const emitted: string[] = [];
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return streamResponse(chunkText(SLOP_TEXT, 5));
    return jsonResponse(CLEAN_TEXT);
  };

  const result = await generateText(config, {
    prompt: '写一个开头',
    streamHoldback: 8,
    onToken: (token) => emitted.push(token),
  });

  assert.equal(fetchCalls, 2);
  assert.equal(result, CLEAN_TEXT);
  const streamed = emitted.join('');
  assert.equal(streamed.includes(CLEAN_TEXT), true);
  // 被否决那一稿的尾部留在 holdback 窗口里，必须被丢弃而不是送进正文。
  assert.equal(streamed.includes(SLOP_TEXT.slice(-8)), false);
});

test('without a holdback window the draft is emitted once, after the gate', async () => {
  const emitted: string[] = [];
  globalThis.fetch = async () => streamResponse(chunkText(CLEAN_TEXT, 5));

  const result = await generateText(config, {
    prompt: '写一个开头',
    onToken: (token) => emitted.push(token),
  });

  assert.equal(result, CLEAN_TEXT);
  assert.deepEqual(emitted, [CLEAN_TEXT]);
});

test('holdback window tracks the upstream chunk size inside the configured clamp', () => {
  // Plan 275（R-273-1）：窗口 = 2×块长，clamp 到 [min(下限, 配置窗口), 配置窗口]。
  assert.equal(holdbackWindowForChunk(2, STREAM_HOLDBACK_CHARS), STREAM_HOLDBACK_MIN_CHARS);
  assert.equal(holdbackWindowForChunk(8, STREAM_HOLDBACK_CHARS), STREAM_HOLDBACK_MIN_CHARS);
  assert.equal(holdbackWindowForChunk(35, STREAM_HOLDBACK_CHARS), STREAM_HOLDBACK_CHARS);
  assert.equal(holdbackWindowForChunk(1_000, STREAM_HOLDBACK_CHARS), STREAM_HOLDBACK_CHARS);
  // 调用方给出的窗口小于下限时不得越界（既有用例用窗口 4 / 8）。
  assert.equal(holdbackWindowForChunk(1, 4), 4);
  assert.equal(holdbackWindowForChunk(9, 8), 8);
});

test('narrows the window for fine-grained upstreams so the first batch lands sooner', () => {
  const emitted: string[] = [];
  const sink = createHoldbackSink((token) => emitted.push(token), STREAM_HOLDBACK_CHARS);

  // Sonnet 类上游 2 字/块：固定 64 字窗口要等 32 块才回发，自适应窗口是 16 字。
  for (let i = 0; i < 9; i += 1) sink.push('ab');
  assert.deepEqual(emitted, ['ab']);

  sink.flush();
  assert.equal(emitted.join(''), 'ab'.repeat(9));
});
