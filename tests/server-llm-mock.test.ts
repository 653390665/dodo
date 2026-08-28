import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../server/lib/server-llm.js';
import type { AppConfig } from '../server/lib/config';

/**
 * InkFlow Server LLM 边界与重试健壮性 Mock 测试
 * 
 * 通过拦截 globalThis.fetch 来 100% 模拟各种上游模型接口返回情况，
 * 验证非流式生成、空返回拦截、503 服务不稳定时的自动指数退避重试，以及 429 限额超限拦截。
 */
test.describe('InkFlow Server LLM Mock & Retry Robustness Tests', () => {
  const originalFetch = globalThis.fetch;
  const config: AppConfig = {
    apiKey: 'sk-mock-test-key-12345',
    baseUrl: 'https://api.openai-mock.com/v1',
    model: 'gpt-4o',
    promptTemplates: {} as any
  };

  test.afterEach(() => {
    // 每次测试用例执行完后物理还原 globalThis.fetch 干净状态
    globalThis.fetch = originalFetch;
  });

  test('generateText should return correct text on successful non-streaming API call', async () => {
    globalThis.fetch = async (_url, _init) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '这是非流式生成的完美小说片段。'
              }
            }
          ]
        })
      } as Response;
    };

    const result = await generateText(config, {
      prompt: '写一个开头',
      maxAttempts: 1
    });

    assert.equal(result, '这是非流式生成的完美小说片段。');
  });

  test('generateText should handle empty response error gracefully', async () => {
    globalThis.fetch = async (_url, _init) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: []
        })
      } as Response;
    };

    await assert.rejects(
      generateText(config, {
        prompt: '写一个开头',
        maxAttempts: 1
      }),
      /模型服务返回空结果/
    );
  });

  test('generateText should retry on 503 Service Unavailable and succeed on third try', async () => {
    let callCount = 0;
    globalThis.fetch = async (_url, _init) => {
      callCount++;
      if (callCount < 3) {
        return {
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable'
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '第三次终于重试成功'
              }
            }
          ]
        })
      } as Response;
    };

    const result = await generateText(config, {
      prompt: '写一个开头',
      maxAttempts: 3
    });

    assert.equal(result, '第三次终于重试成功');
    assert.equal(callCount, 3);
  });

  test('generateText should stop retrying and throw on 429 Quota Limit Exceeded', async () => {
    let callCount = 0;
    globalThis.fetch = async (_url, _init) => {
      callCount++;
      return {
        ok: false,
        status: 429,
        text: async () => 'QUOTA_LIMIT_EXCEEDED: Your quota has been exceeded'
      } as Response;
    };

    await assert.rejects(
      generateText(config, {
        prompt: '写一个开头',
        maxAttempts: 2
      }),
      /模型服务暂时限流/
    );

    assert.equal(callCount, 2);
  });

  test('generateText falls back to plain text when response_format is unsupported', async () => {
    let callCount = 0;
    let diagnostic: { responseFormatMode?: string } | undefined;
    globalThis.fetch = async (_url, init) => {
      callCount++;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (callCount === 1) {
        assert.deepEqual(body.response_format, { type: 'json_object' });
        return { ok: false, status: 400, text: async () => 'response_format is not supported' } as Response;
      }
      assert.equal('response_format' in body, false);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) } as Response;
    };

    assert.equal(await generateText(config, { prompt: '输出 JSON', responseMimeType: 'application/json', maxAttempts: 1, onComplete: value => { diagnostic = value.outputDiagnostic; } }), '{"ok":true}');
    assert.equal(callCount, 2);
    assert.equal(diagnostic?.responseFormatMode, 'plain_fallback');
  });

  test('generateText does not retry deterministic authentication failures', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return { ok: false, status: 401, text: async () => 'invalid api key' } as Response;
    };
    await assert.rejects(generateText(config, { prompt: '写一个开头', maxAttempts: 3 }), /模型服务鉴权失败/);
    assert.equal(callCount, 1);
  });

  test('generateText classifies HTTP 402 as a billing error without retrying', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return { ok: false, status: 402, text: async () => 'provider quota details must not escape' } as Response;
    };

    await assert.rejects(
      generateText(config, { prompt: '写一个开头', maxAttempts: 3 }),
      error => {
        assert.equal((error as { code?: string }).code, 'billing');
        assert.equal((error as { httpStatus?: number }).httpStatus, 402);
        assert.equal((error as Error).message, '模型服务额度不足，请充值或更换可用模型');
        assert.doesNotMatch((error as Error).message, /provider quota details/);
        return true;
      },
    );
    assert.equal(callCount, 1);
  });
});
