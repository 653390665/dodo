import assert from 'node:assert/strict';
import test from 'node:test';

test('production pipeline injects isolated execution snapshot stage prompts', async () => {
  const previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.API_KEY,
    baseUrl: process.env.API_BASE_URL,
  };
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = 'prompt-sentinel-key';
  process.env.API_BASE_URL = 'http://prompt-sentinel.local/v1';

  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  const draftContent = Array.from({ length: 36 }, (_, index) => (
    `序号${index + 1}段记录中，林舟沿着潮湿的石阶向前走，记下墙面上新鲜的划痕和远处逐渐靠近的脚步。` +
    `林舟在第${index + 1}次确认时暂缓回应门后的询问，先确认手中的铜铃仍然完整，随后把下一步行动拆成几个可以回收的选择。` +
    `第${index + 1}阵风从巷口穿过，带来陌生的药草气味，守在灯下的人终于抬起头，示意他把信纸放到桌面中央。`
  )).join('\n\n');
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ content?: string }> };
    requests.push(body.messages?.map((message) => message.content || '').join('\n') || '');
    const content = requests.length === 1 ? 'BEATS' : requests.length === 2 ? draftContent : JSON.stringify({
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
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return { ok: true, status: 200, body: stream, json: async () => ({ choices: [{ message: { content } }] }) } as Response;
  }) as typeof fetch;

  try {
    const { reloadConfig } = await import('../server/lib/config');
    reloadConfig();
    const { runProductionPipeline } = await import('../server/helpers/ai-production-pipeline');
    const result = await runProductionPipeline({
      novelId: 'prompt-sentinel-novel',
      userIntent: '推进本章冲突',
      contextStr: 'LEGACY_CONTEXT_SENTINEL',
      stageContexts: {
        planner: 'PLANNER_CONTEXT_SENTINEL',
        writer: 'WRITER_CONTEXT_SENTINEL',
        critic: 'CRITIC_CONTEXT_SENTINEL',
      },
      stagePrompts: {
        planner: 'PLANNER_SENTINEL',
        writer: 'WRITER_SENTINEL\nSECRET_WRITER_OBJECT_FIELD',
        critic: 'CRITIC_SENTINEL',
      },
    });

    assert.equal(result.auditStatus, 'pass');
    assert.equal(result.source, 'model');
    assert.ok(requests.length >= 3);
    assert.match(requests[0], /PLANNER_SENTINEL|PLANNER_CONTEXT_SENTINEL/);
    assert.doesNotMatch(requests[0], /WRITER_SENTINEL|CRITIC_SENTINEL|WRITER_CONTEXT_SENTINEL|CRITIC_CONTEXT_SENTINEL/);
    assert.match(requests[1], /WRITER_SENTINEL|WRITER_CONTEXT_SENTINEL/);
    assert.doesNotMatch(requests[1], /PLANNER_SENTINEL|CRITIC_SENTINEL|PLANNER_CONTEXT_SENTINEL|CRITIC_CONTEXT_SENTINEL/);
    const criticRequest = requests.find((request) => /CRITIC_SENTINEL|CRITIC_CONTEXT_SENTINEL/.test(request));
    assert.ok(criticRequest, 'critic request should carry only the critic stage snapshot');
    assert.doesNotMatch(criticRequest, /SECRET_WRITER_OBJECT_FIELD|PLANNER_SENTINEL|PLANNER_CONTEXT_SENTINEL/);
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

test('rejects an unqualified deterministic fallback after writer failure', async () => {
  const previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.API_KEY,
    baseUrl: process.env.API_BASE_URL,
  };
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = 'pipeline-quality-test-key';
  process.env.API_BASE_URL = 'http://pipeline-quality.test/v1';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('provider unavailable');
  }) as typeof fetch;

  try {
    const { reloadConfig } = await import('../server/lib/config');
    reloadConfig();
    const { runProductionPipeline } = await import('../server/helpers/ai-production-pipeline');
    const writerTokens: string[] = [];

    await assert.rejects(
      () => runProductionPipeline({
        novelId: 'pipeline-quality-novel',
        userIntent: '推进冲突并确认来客身份',
        contextStr: '普通故事上下文',
        stagePrompts: { planner: '', writer: '', critic: '' },
        progress: { onWriterToken: (chunk) => writerTokens.push(chunk) },
      }),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /^DRAFT_QUALITY_GATE_FAILED:/);
        assert.match(error.message, /重复/);
        return true;
      },
    );
    assert.equal(writerTokens.length, 0);
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
