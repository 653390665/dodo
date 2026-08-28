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

test('buildOpenAICompatibleChatRequest disables DeepSeek thinking without changing other providers', () => {
  const request = buildOpenAICompatibleChatRequest(
    { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
    { prompt: '输出 JSON', maxTokens: 512, responseMimeType: 'application/json', disableThinking: true },
  );

  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.deepEqual(request.thinking, { type: 'disabled' });
});

test('audit-json mode bypasses prose quality gates while keeping JSON transport', async () => {
  const originalFetch = globalThis.fetch;
  const auditJson = JSON.stringify({
    scores: {
      '可读性': { score: 8, reason: '“他深吸一口气”仅作为待审计引用。' },
      '分镜执行度': { score: 8, reason: '动作落地' },
      '冲突推进度': { score: 8, reason: '风险前移' },
      '风格契合度': { score: 8, reason: '声口稳定' },
      '网文章节感': { score: 8, reason: '收束完整' },
    },
    totalScore: 40,
    pass: true,
    fatalIssues: [],
    surgerySuggestions: [],
  });
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: auditJson } }] }), { status: 200 });
  };
  try {
    const result = await generateText({
      apiKey: 'mock-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini',
      promptGuardLevel: 'strict', promptTemplates: DEFAULT_PROMPT_TEMPLATES,
    }, { prompt: '审稿章节并检查他深吸一口气这处引用', outputMode: 'audit-json', maxAttempts: 1 });
    assert.equal(result, auditJson);
    assert.deepEqual(requestBody?.response_format, { type: 'json_object' });
    const messages = requestBody?.messages as Array<{ role: string; content: string }>;
    assert.doesNotMatch(messages.map((message) => message.content).join('\n'), /PROMPT|去AI俗套/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('audit-json retries only without response_format after explicit incompatibility', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let secondBody: Record<string, unknown> | undefined;
  let diagnostic: any;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { param: 'response_format', code: 'unsupported_json' } }), { status: 400 });
    }
    secondBody = body;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }), { status: 200 });
  };
  try {
    const result = await generateText(
      { apiKey: 'mock-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', promptTemplates: DEFAULT_PROMPT_TEMPLATES },
      { prompt: '审稿 JSON', outputMode: 'audit-json', maxAttempts: 1, onComplete: (value) => { diagnostic = value.outputDiagnostic; } },
    );
    assert.equal(result, '{"ok":true}');
    assert.equal(calls, 2);
    assert.equal('response_format' in (secondBody || {}), false);
    assert.equal(diagnostic.responseFormatMode, 'plain_fallback');
    assert.equal(diagnostic.compatibilityMode, 'plain_fallback');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateText reports OpenAI length finish reason to JSON callers', async () => {
  const originalFetch = globalThis.fetch;
  let metadata: { finishReason?: string; truncated: boolean; outputDiagnostic?: { provider?: string; finishReason?: string } } | undefined;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'length', message: { content: '{"characters":[' } }],
  }), { status: 200 });
  try {
    await generateText({
      apiKey: 'mock-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', promptTemplates: DEFAULT_PROMPT_TEMPLATES,
    }, { prompt: '输出 JSON', maxAttempts: 1, onComplete: value => { metadata = value; } });
    assert.equal(metadata?.finishReason, 'length');
    assert.equal(metadata?.truncated, true);
    assert.equal(metadata?.outputDiagnostic?.provider, 'openai-compatible');
    assert.equal(metadata?.outputDiagnostic?.finishReason, 'length');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streaming generation treats an empty model response as an error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200 });
  try {
    await assert.rejects(
      generateText(
        { apiKey: 'mock-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', promptTemplates: DEFAULT_PROMPT_TEMPLATES },
        { prompt: '输出一句灵感', maxAttempts: 1, onToken: () => undefined },
      ),
      (error: any) => error.code === 'empty_response',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('empty response diagnostics distinguish transient, reasoning-only, and length exhaustion', async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    apiKey: 'mock-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', promptTemplates: DEFAULT_PROMPT_TEMPLATES,
  };
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }), { status: 200 });
    };
    await assert.rejects(generateText(config, { prompt: '输出一句灵感', maxAttempts: 2 }), (error: any) => {
      assert.equal(error.code, 'empty_response');
      assert.equal(error.reason, 'no_content');
      assert.equal(error.retriable, true);
      return true;
    });
    assert.equal(calls, 2);

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'private mock reasoning' } }] }), { status: 200 });
    };
    await assert.rejects(generateText(config, { prompt: '输出一句灵感', maxAttempts: 3 }), (error: any) => {
      assert.equal(error.reason, 'reasoning_only');
      assert.equal(error.retriable, false);
      assert.doesNotMatch(JSON.stringify(error), /private mock reasoning/);
      return true;
    });
    assert.equal(calls, 1);

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'private mock reasoning' } }] }), { status: 200 });
    };
    await assert.rejects(generateText(config, { prompt: '输出一句灵感', maxAttempts: 3 }), (error: any) => {
      assert.equal(error.reason, 'length_exhausted');
      assert.equal(error.retriable, false);
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DeepSeek removes only thinking after a parameter rejection and keeps JSON mode', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let firstBody: Record<string, unknown> | undefined;
  let secondBody: Record<string, unknown> | undefined;
  let diagnostic: any;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (calls === 1) {
      firstBody = body;
      return new Response(JSON.stringify({ error: { param: 'thinking', code: 'invalid_param', message: 'thinking is not accepted with JSON output' } }), { status: 400 });
    }
    secondBody = body;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }), { status: 200 });
  };
  try {
    const result = await generateText(
      { apiKey: 'mock-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', promptTemplates: DEFAULT_PROMPT_TEMPLATES },
      { prompt: '输出 JSON', responseMimeType: 'application/json', disableThinking: true, maxAttempts: 1, onComplete: value => { diagnostic = value.outputDiagnostic; } },
    );
    assert.equal(result, '{"ok":true}');
    assert.equal(calls, 2);
    assert.deepEqual(firstBody?.thinking, { type: 'disabled' });
    assert.deepEqual(firstBody?.response_format, { type: 'json_object' });
    assert.equal('thinking' in (secondBody || {}), false);
    assert.deepEqual(secondBody?.response_format, { type: 'json_object' });
    assert.equal(diagnostic.compatibilityMode, 'omit_thinking');
    assert.equal(diagnostic.responseFormatMode, 'json_object');
    assert.equal(diagnostic.thinkingMode, 'provider_default');
    assert.equal(diagnostic.providerRequestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DeepSeek omits thinking after a retryable socket failure and keeps JSON mode', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let firstBody: Record<string, unknown> | undefined;
  let secondBody: Record<string, unknown> | undefined;
  let diagnostic: any;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (calls === 1) {
      firstBody = body;
      throw new Error('UND_ERR_SOCKET: other side closed');
    }
    secondBody = body;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }), { status: 200 });
  };
  try {
    const result = await generateText(
      { apiKey: 'mock-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', promptTemplates: DEFAULT_PROMPT_TEMPLATES },
      { prompt: '输出 JSON', responseMimeType: 'application/json', disableThinking: true, maxAttempts: 2, onComplete: value => { diagnostic = value.outputDiagnostic; } },
    );
    assert.equal(result, '{"ok":true}');
    assert.equal(calls, 2);
    assert.deepEqual(firstBody?.thinking, { type: 'disabled' });
    assert.deepEqual(firstBody?.response_format, { type: 'json_object' });
    assert.equal('thinking' in (secondBody || {}), false);
    assert.deepEqual(secondBody?.response_format, { type: 'json_object' });
    assert.equal(diagnostic.compatibilityMode, 'omit_thinking');
    assert.equal(diagnostic.responseFormatMode, 'json_object');
    assert.equal(diagnostic.thinkingMode, 'provider_default');
    assert.equal(diagnostic.providerRequestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DeepSeek rejects a second parameter variant without plain fallback', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(body.response_format, { type: 'json_object' });
    if (calls === 1) return new Response(JSON.stringify({ error: { param: 'thinking', code: 'invalid_param' } }), { status: 400 });
    assert.equal('thinking' in body, false);
    return new Response(JSON.stringify({ error: { param: 'response_format', code: 'unsupported_json' } }), { status: 422 });
  };
  try {
    await assert.rejects(
      generateText(
        { apiKey: 'mock-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', promptTemplates: DEFAULT_PROMPT_TEMPLATES },
        { prompt: '输出 JSON', responseMimeType: 'application/json', disableThinking: true, maxAttempts: 1 },
      ),
      (error: any) => {
        assert.equal(error.code, 'parameter_incompatible');
        assert.equal(error.httpStatus, 422);
        assert.equal(error.rejectedParameter, 'response_format');
        assert.equal(error.compatibilityMode, 'omit_thinking');
        assert.equal(error.providerRequestCount, 2);
        return true;
      },
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unrelated OpenAI 400 does not trigger compatibility fallback', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'quota policy rejected request' } }), { status: 400 });
  };
  try {
    await assert.rejects(
      generateText({ apiKey: 'mock-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', promptTemplates: DEFAULT_PROMPT_TEMPLATES }, { prompt: '输出 JSON', responseMimeType: 'application/json', maxAttempts: 2 }),
      (error: any) => error.code === 'parameter_incompatible' && error.providerRequestCount === 1,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('OpenAI streaming never emits split reasoning tags or their content', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const tokens: string[] = [];

  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (const content of ['开头', '<thi', 'nk>内部分析', '</th', 'ink>正文']) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

  try {
    const result = await generateText({
      apiKey: 'mock-openai-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      promptGuardLevel: 'disabled',
      promptTemplates: DEFAULT_PROMPT_TEMPLATES,
    }, { prompt: 'continue', onToken: (token) => tokens.push(token), maxAttempts: 1 });

    assert.equal(tokens.join(''), '开头正文');
    assert.equal(result, '开头正文');
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
