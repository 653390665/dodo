import assert from 'node:assert/strict';
import test from 'node:test';

/** Plan 272 harness: proves writer tokens are pushed live and that a replacement
 * (deterministic fallback) resets the provisional prose before it is replayed. */

function buildDraft(): string {
  return Array.from(
    { length: 36 },
    (_, index) =>
      `序号${index + 1}段记录中，林舟沿着潮湿的石阶向前走，记下墙面上新鲜的划痕和远处逐渐靠近的脚步。` +
      `林舟在第${index + 1}次确认时暂缓回应门后的询问，先确认手中的铜铃仍然完整，随后把下一步行动拆成几个可以回收的选择。` +
      `第${index + 1}阵风从巷口穿过，带来陌生的药草气味，守在灯下的人终于抬起头，示意他把信纸放到桌面中央。`
  ).join('\n\n');
}

const PASSING_AUDIT = JSON.stringify({
  score: 80,
  fatalIssues: [],
  sceneChecks: [],
  surgerySuggestions: [],
  evidence: [
    { category: 'scene_execution', severity: 'low', quote: '场景证据', explanation: '动作目标清晰', suggestedFix: '保持动作链' },
    { category: 'character_state', severity: 'low', quote: '角色证据', explanation: '人物选择一致', suggestedFix: '保持人物动机' },
    { category: 'hard_canon', severity: 'low', quote: '设定证据', explanation: '设定约束一致', suggestedFix: '保持规则约束' },
    { category: 'foreshadowing', severity: 'low', quote: '伏笔证据', explanation: '章末信息可追踪', suggestedFix: '后续回收线索' },
  ],
});

function sseResponse(content: string): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`
        )
      );
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body: stream,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

function failingResponse(): Response {
  return {
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'writer provider unavailable', code: 'invalid_request' } }),
    text: async () => 'writer provider unavailable',
  } as Response;
}

interface ProgressLog {
  events: string[];
  streamed: string;
  resets: number;
}

function makeProgress(): { log: ProgressLog; progress: Record<string, unknown> } {
  const log: ProgressLog = { events: [], streamed: '', resets: 0 };
  return {
    log,
    progress: {
      onPhase: (phase: string) => log.events.push(`phase:${phase}`),
      onBeats: () => log.events.push('beats'),
      onWriterToken: (chunk: string) => {
        log.events.push('token');
        log.streamed += chunk;
      },
      onWriterReset: () => {
        log.events.push('reset');
        log.resets += 1;
        log.streamed = '';
      },
      onWriterDone: () => log.events.push('writer-done'),
      onCriticDone: () => log.events.push('critic-done'),
    },
  };
}

const compact = (value: string): string => value.replace(/\s+/g, '');

test('writer tokens stream live and beats are pushed before the prose', async () => {
  const previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.API_KEY,
    baseUrl: process.env.API_BASE_URL,
  };
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = 'writer-live-stream-key';
  process.env.API_BASE_URL = 'http://writer-live-stream.local/v1';

  const draft = buildDraft();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = body.messages?.map((message) => message.content || '').join('\n') || '';
    if (prompt.includes('PLANNER_SENTINEL')) return sseResponse('场景：雨夜码头对峙，林舟收伞入场。');
    if (prompt.includes('WRITER_SENTINEL')) return sseResponse(draft);
    return sseResponse(PASSING_AUDIT);
  }) as typeof fetch;

  const { log, progress } = makeProgress();
  try {
    const { reloadConfig } = await import('../server/lib/config');
    reloadConfig();
    const { runProductionPipeline } = await import('../server/helpers/ai-production-pipeline');
    const result = await runProductionPipeline({
      novelId: 'writer-live-stream-novel',
      userIntent: '推进本章冲突',
      contextStr: 'WRITER_LIVE_CONTEXT',
      stagePrompts: {
        planner: 'PLANNER_SENTINEL',
        writer: 'WRITER_SENTINEL',
        critic: 'CRITIC_SENTINEL',
      },
      progress,
    });

    assert.equal(result.source, 'model');
    assert.equal(result.auditStatus, 'pass');
    const firstBeats = log.events.indexOf('beats');
    const firstToken = log.events.indexOf('token');
    assert.ok(firstBeats >= 0, 'beats must be pushed');
    assert.ok(
      firstToken > firstBeats,
      'beats must be pushed before the first live prose token'
    );
    assert.equal(log.resets, 0, 'a clean pass must not reset the streamed prose');
    assert.equal(
      compact(log.streamed),
      compact(result.draft),
      'the streamed prose must equal the delivered draft exactly once (no duplicate replay)'
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv.nodeEnv;
    if (previousEnv.apiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = previousEnv.apiKey;
    if (previousEnv.baseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = previousEnv.baseUrl;
  }
});

test('a deterministic fallback resets the provisional prose before it is replayed', async () => {
  const previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.API_KEY,
    baseUrl: process.env.API_BASE_URL,
  };
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = 'writer-live-stream-fallback-key';
  process.env.API_BASE_URL = 'http://writer-live-stream-fallback.local/v1';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = body.messages?.map((message) => message.content || '').join('\n') || '';
    if (prompt.includes('PLANNER_SENTINEL')) return sseResponse('场景：雨夜码头对峙，林舟收伞入场。');
    if (prompt.includes('WRITER_SENTINEL')) return failingResponse();
    return sseResponse(PASSING_AUDIT);
  }) as typeof fetch;

  const { log, progress } = makeProgress();
  try {
    const { reloadConfig } = await import('../server/lib/config');
    reloadConfig();
    const { runProductionPipeline } = await import('../server/helpers/ai-production-pipeline');
    const result = await runProductionPipeline({
      novelId: 'writer-live-stream-fallback-novel',
      userIntent: '推进本章冲突',
      contextStr: 'WRITER_LIVE_CONTEXT',
      stagePrompts: {
        planner: 'PLANNER_SENTINEL',
        writer: 'WRITER_SENTINEL',
        critic: 'CRITIC_SENTINEL',
      },
      progress,
    });

    assert.equal(result.source, 'fallback');
    assert.equal(log.resets, 1, 'a replaced draft must reset the client buffer exactly once');
    const resetIndex = log.events.indexOf('reset');
    const tokenAfterReset = log.events.findIndex(
      (event, index) => index > resetIndex && event === 'token'
    );
    assert.ok(tokenAfterReset > resetIndex, 'the fallback draft must be replayed after the reset');
    assert.equal(
      compact(log.streamed),
      compact(result.draft),
      'the replayed prose must equal the delivered fallback draft'
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv.nodeEnv;
    if (previousEnv.apiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = previousEnv.apiKey;
    if (previousEnv.baseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = previousEnv.baseUrl;
  }
});
