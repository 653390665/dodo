import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGoogleGenerateContentRequest, buildOpenAICompatibleChatRequest, generateEmbedding } from '../server/lib/server-llm';
import { DEFAULT_PROMPT_TEMPLATES } from '../shared/config/prompt-templates';

test('buildGoogleGenerateContentRequest forwards system instruction and max output tokens', () => {
  const request = buildGoogleGenerateContentRequest({
    prompt: '把资料包整理成 JSON',
    systemInstruction: '只输出 JSON',
    maxTokens: 4096,
    responseMimeType: 'application/json',
    disableThinking: true,
  });

  assert.equal(request.model, 'gemini-2.5-pro');
  assert.equal(request.contents, '把资料包整理成 JSON');
  assert.deepEqual(request.config, {
    systemInstruction: '只输出 JSON',
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
    thinkingConfig: {
      thinkingBudget: 0,
      includeThoughts: false,
    },
  });
});

test('buildGoogleGenerateContentRequest omits config when no overrides are provided', () => {
  const request = buildGoogleGenerateContentRequest({
    prompt: '继续',
    systemInstruction: undefined,
    maxTokens: undefined,
  });

  assert.equal(request.model, 'gemini-2.5-pro');
  assert.equal(request.contents, '继续');
  assert.equal('config' in request, false);
});

test('buildOpenAICompatibleChatRequest uses MiniMax-specific reasoning split and token field', () => {
  const request = buildOpenAICompatibleChatRequest(
    { baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.7' },
    {
      prompt: '把资料包整理成 JSON',
      systemInstruction: '只输出 JSON',
      maxTokens: 4096,
      responseMimeType: 'application/json',
      disableThinking: true,
    },
  );

  assert.equal(request.model, 'MiniMax-M2.7');
  assert.equal(request.stream, false);
  assert.equal(request.max_completion_tokens, 2048);
  assert.equal(request.reasoning_split, true);
  assert.equal('response_format' in request, false);
  assert.deepEqual(request.messages, [
    { role: 'system', content: '只输出 JSON' },
    { role: 'user', content: '把资料包整理成 JSON' },
  ]);
});

test('buildOpenAICompatibleChatRequest uses generic OpenAI json response format', () => {
  const request = buildOpenAICompatibleChatRequest(
    { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
    {
      prompt: '输出 JSON',
      systemInstruction: undefined,
      maxTokens: 512,
      responseMimeType: 'application/json',
      disableThinking: true,
    },
  );

  assert.equal(request.model, 'gpt-4.1-mini');
  assert.equal(request.stream, false);
  assert.equal(request.max_tokens, 512);
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.equal('reasoning_split' in request, false);
});

test('generateEmbedding sends correct POST request to OpenAI /embeddings endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = '';
  let calledInit: RequestInit | undefined;

  globalThis.fetch = async (url, init) => {
    calledUrl = String(url);
    calledInit = init;
    return new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2, 0.3] }]
    }));
  };

  try {
    const embedding = await generateEmbedding(
      { apiKey: 'mock-key', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', promptTemplates: DEFAULT_PROMPT_TEMPLATES },
      'hello world'
    );

    assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
    assert.equal(calledUrl, 'https://api.openai.com/v1/embeddings');
    assert.equal(calledInit?.method, 'POST');

    const body = JSON.parse(calledInit?.body as string);
    assert.equal(body.input, 'hello world');
    assert.equal(body.model, 'text-embedding-3-small');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
