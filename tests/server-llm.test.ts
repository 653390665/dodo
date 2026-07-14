import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGoogleGenerateContentRequest, buildOpenAICompatibleChatRequest, generateEmbedding, generateText } from '../server/lib/server-llm';
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

test('generateEmbedding forwards abort to the provider request', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let providerSignal: AbortSignal | undefined;
  globalThis.fetch = async (_url, init) => {
    providerSignal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      providerSignal?.addEventListener('abort', () => reject(providerSignal?.reason), { once: true });
    });
  };

  try {
    const pending = generateEmbedding(
      { apiKey: 'mock-key', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', promptTemplates: DEFAULT_PROMPT_TEMPLATES },
      'cancel me',
      controller.signal,
    );
    controller.abort(new Error('caller cancelled'));
    await assert.rejects(pending, /caller cancelled/);
    assert.equal(providerSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Google generation aborted during SDK loading never reaches the provider', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let providerCalls = 0;

  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'late response' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const generation = generateText(
      {
        apiKey: 'mock-google-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-2.5-pro',
        promptGuardLevel: 'disabled',
        promptTemplates: DEFAULT_PROMPT_TEMPLATES,
      },
      { prompt: 'continue', signal: controller.signal, timeoutMs: 5_000, maxAttempts: 1 },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error('client disconnected'));

    await assert.rejects(generation, /client disconnected|abort/i);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pre-aborted Google embedding never reaches the provider', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let providerCalls = 0;
  controller.abort(new Error('embedding cancelled before start'));

  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ embedding: { values: [0.1, 0.2] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await assert.rejects(generateEmbedding(
      {
        apiKey: 'mock-google-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'text-embedding-004',
        promptTemplates: DEFAULT_PROMPT_TEMPLATES,
      },
      'cancel me',
      controller.signal,
    ), /embedding cancelled before start/i);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI streaming stops parsing the current chunk immediately after abort', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const encoder = new TextEncoder();
  const tokens: string[] = [];

  globalThis.fetch = async () => new Response(new ReadableStream({
    start(streamController) {
      streamController.enqueue(encoder.encode([
        'data: {"choices":[{"delta":{"content":"first"}}]}',
        'data: {"choices":[{"delta":{"content":"second"}}]}',
        'data: [DONE]',
        '',
      ].join('\n')));
      streamController.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

  try {
    await assert.rejects(generateText(
      {
        apiKey: 'mock-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        promptGuardLevel: 'disabled',
        promptTemplates: DEFAULT_PROMPT_TEMPLATES,
      },
      {
        prompt: 'continue',
        signal: controller.signal,
        timeoutMs: 5_000,
        maxAttempts: 1,
        onToken(token) {
          tokens.push(token);
          controller.abort(new Error('stop after first token'));
        },
      },
    ), /stop after first token|abort/i);
    assert.deepEqual(tokens, ['first']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Google streaming stops token callbacks immediately after abort', async () => {
  const originalFetch = globalThis.fetch;
  const externalController = new AbortController();
  const encoder = new TextEncoder();
  const tokens: string[] = [];
  let transportSignal: AbortSignal | undefined;

  globalThis.fetch = async (_url, init) => {
    transportSignal = init?.signal ?? undefined;
    return new Response(new ReadableStream({
      start(streamController) {
        streamController.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"first"}]}}]}\n\n'));
        setTimeout(() => {
          streamController.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"second"}]}}]}\n\n'));
          streamController.close();
        }, 5);
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  try {
    const generation = generateText(
      {
        apiKey: 'mock-google-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-2.5-pro',
        promptGuardLevel: 'disabled',
        promptTemplates: DEFAULT_PROMPT_TEMPLATES,
      },
      {
        prompt: 'continue',
        signal: externalController.signal,
        timeoutMs: 5_000,
        maxAttempts: 1,
        onToken(token) {
          tokens.push(token);
          externalController.abort(new Error('stop after first token'));
        },
      },
    );

    await assert.rejects(generation, /stop after first token|abort/i);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.deepEqual(tokens, ['first']);
    assert.equal(transportSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
