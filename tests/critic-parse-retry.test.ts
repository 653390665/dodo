import assert from 'node:assert/strict';
import test from 'node:test';

const draftContent = Array.from(
  { length: 36 },
  (_, index) =>
    `序号${index + 1}段记录中，林舟沿着潮湿的石阶向前走，记下墙面上新鲜的划痕和远处逐渐靠近的脚步。` +
    `林舟在第${index + 1}次确认时暂缓回应门后的询问，先确认手中的铜铃仍然完整，随后把下一步行动拆成几个可以回收的选择。` +
    `第${index + 1}阵风从巷口穿过，带来陌生的药草气味，守在灯下的人终于抬起头，示意他把信纸放到桌面中央。`
).join('\n\n');

const validPassJson = JSON.stringify({
  scores: {
    可读性: { score: 8, reason: '清晰' },
    分镜执行度: { score: 8, reason: '完整' },
    冲突推进度: { score: 8, reason: '推进' },
    风格契合度: { score: 8, reason: '契合' },
    网文章节感: { score: 8, reason: '有钩子' },
  },
  totalScore: 40,
  pass: true,
  failReason: '',
  fatalIssues: [],
  surgerySuggestions: [],
  evidence: [
    { category: 'scene_execution', severity: 'low', quote: '场景证据', explanation: '动作目标清晰', suggestedFix: '保持动作链' },
    { category: 'character_state', severity: 'low', quote: '角色证据', explanation: '人物选择一致', suggestedFix: '保持人物动机' },
    { category: 'hard_canon', severity: 'low', quote: '设定证据', explanation: '设定约束一致', suggestedFix: '保持规则约束' },
    { category: 'foreshadowing', severity: 'low', quote: '伏笔证据', explanation: '章末信息可追踪', suggestedFix: '后续回收线索' },
  ],
});

function sseResponse(content: string) {
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

/**
 * Runs the pipeline against a role-aware LLM mock. Each pipeline role is
 * identified by its soul marker and served from its own payload queue, so the
 * writer's corrective retry (output guard) cannot shift the critic's script.
 */
async function runPipelineWithCriticScript(criticScript: string[]) {
  const previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.API_KEY,
    baseUrl: process.env.API_BASE_URL,
  };
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = 'critic-retry-key';
  process.env.API_BASE_URL = 'http://critic-retry.test/v1';

  const criticQueue = [...criticScript];
  let criticCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ content?: string }> };
    const requestText = body.messages?.map((message) => message.content || '').join('\n') || '';
    let content: string;
    if (requestText.includes('Critic Agent')) {
      criticCalls += 1;
      content = criticQueue.shift() ?? '审稿完成，整体不错。';
    } else if (requestText.includes('Planner Agent')) {
      content = 'BEATS';
    } else {
      content = draftContent;
    }
    return sseResponse(content);
  }) as typeof fetch;

  try {
    const { reloadConfig, getConfig } = await import('../server/lib/config');
    reloadConfig();
    // Disable the prose prompt/output guards so the writer produces exactly one
    // request — this test isolates the critic retry, not the writer gate.
    const config = getConfig();
    const originalGuardLevel = config.promptGuardLevel;
    config.promptGuardLevel = 'disabled';
    const { runProductionPipeline } = await import('../server/helpers/ai-production-pipeline');
    const result = await runProductionPipeline({
      novelId: 'critic-retry-novel',
      userIntent: '推进本章冲突',
      contextStr: '普通故事上下文',
      stagePrompts: { planner: '', writer: '', critic: '' },
    });
    config.promptGuardLevel = originalGuardLevel;
    return { result, criticCalls };
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv.nodeEnv;
    if (previousEnv.apiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = previousEnv.apiKey;
    if (previousEnv.baseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = previousEnv.baseUrl;
  }
}

test('critic retries once with the same params when the audit JSON contract fails', async () => {
  const { result, criticCalls } = await runPipelineWithCriticScript([
    '{"scores": 可读性八分', // broken JSON — five-dim contract fails
    validPassJson,
  ]);

  assert.equal(criticCalls, 2, 'critic must be re-sent exactly once');
  assert.equal(result.auditStatus, 'pass');
  assert.equal(result.audit, validPassJson);
  assert.equal(result.attempts, 1, 'invalid critic JSON must not trigger a writer rewrite');
  assert.equal(result.source, 'model');
});

test('critic retry stays bounded — persistent unknown still ends the pipeline (plan 247)', async () => {
  const { result } = await runPipelineWithCriticScript([
    '审稿完成，整体不错。', // plain text — no JSON candidate
    '{"score": 95, "fatalIssues":', // still truncated JSON
  ]);

  // Plan 247 重锚：unknown 不再立即 break——Writer+Critic 追加一轮（最多 MAX_RETRIES 轮），
  // 但仍有上限（MAX_RETRIES=2 → 最多 3 轮）。persistent unknown 最终仍以 unknown 交付。
  assert.equal(result.auditStatus, 'unknown');
  assert.ok(result.attempts >= 1, 'unknown 应触发至少一次 writer 重试');
});
