import assert from 'node:assert/strict';
import test from 'node:test';

// Plan 266 修复②：正文质量门失败若只由局部软命中（套话/副词弱化）引起，管线应带定向反馈
// 重写整章，而不是立刻丢弃整章退回确定性保底稿；硬缺陷（结构/元数据/长度/机械分）仍直接回退。
//
// 关键约束（实测，见 plans/266）：provider 侧 checkOutputGuard 容忍 ≤2 条高置信命中
// （GUARD_TOLERANT_VIOLATIONS = 2，且分数须 ≥85），而章程门按比例在 ≥3 条软命中时阻断。
// 因此「章程软阻断 + provider 放行」只可能出现在分场景生成（每场景各自过 provider 门、
// 拼接稿累计软命中）的路径上 —— 本用例用三场景夹具复现该累积缺口。
//
// mock 必须按内容特征分类调用，不能按调用序号：provider 守卫不通过时会追加一次
// 「去 AI 俗套自动纠错重写」调用（提示词含 [SYSTEM CORRECTION GATE），按序号映射会错位。

const TEMPLATES: Record<string, [string, string, string]> = {
  A: [
    '序号{n}段记录中，林舟沿着潮湿的石阶向前走，记下墙面上新鲜的划痕和远处逐渐靠近的脚步。',
    '林舟在第{n}次确认时暂缓回应门后的询问，先确认手中的铜铃仍然完整，随后把下一步行动拆成几个可以回收的选择。',
    '第{n}阵风从巷口穿过，带来陌生的药草气味，守在灯下的人终于抬起头，示意他把信纸放到桌面中央。',
  ],
  B: [
    '第{n}次巡夜时，苏晚把灯芯挑亮，逐页核对摊开的账册。',
    '她没有急着落笔，先把砚台里的残墨磨开，再把当晚听到的脚步顺序誊到纸页边上。',
    '更鼓响到第{n}下，屋檐的水滴落进铜盆，伏在梁上的猫换了个姿势。',
  ],
  C: [
    '破晓前的第{n}刻，老周的骡车碾过碎石路，车辙在霜面上压出浅浅的弧。',
    '他解开缰绳让牲口喘气，顺手把车辕下的麻绳重新打结。',
    '茶棚的伙计端来第{n}碗热汤，蒸汽裹着姜味，把整条街的寒意压了下去。',
  ],
  D: [
    '第{n}次收网时，阿禾把渔网摊在晒场上，挑出缠住网眼的断草与碎木。',
    '海风把潮声推近，她蹲下身数着网结的间距，再把补线一圈圈收进竹篮。',
    '晒场边的盐堆反着白亮的光，邻船的橹声从堤外传来。',
  ],
  E: [
    '第{n}页手札里，陈砚记下渡口的船期和沿江各驿的换马时辰。',
    '他把墨迹吹干，比对旧图上的河口位置，用朱笔在地名旁画了一个小圈。',
    '窗外第{n}盏灯笼被点亮，驿卒的脚步声由远及近。',
  ],
};

function body(key: string, from: number, count: number): string {
  const templates = TEMPLATES[key];
  return Array.from({ length: count }, (_, index) =>
    templates.map((t) => t.replace(/\{n\}/g, String(from + index))).join(''),
  ).join('\n\n');
}

// 三条软命中分别落在三个场景（实测：极其/非常 触发 tell_dont_show/P1，
// 单独一条在 provider 守卫容忍范围内；拼接稿累计 3 条 → 章程门 literary-slop/P1）。
const SOFT_SCENES = [
  `${body('A', 1, 20)}\n\n那是一个极其简陋的黄色外卖界面。`,
  `${body('B', 1, 20)}\n\n那是一间非常简陋的临街铺面。`,
  `${body('C', 1, 20)}\n\n那是一座极其简陋的废弃车站。`,
];

// 重写稿：三套不同词汇的干净场景（实测拼接稿章程门 ok=true），
// 第三场景的哨兵句用于断言「重写稿真的上屏」。
const CLEAN_SCENES = [body('D', 1, 20), body('E', 1, 20), body('A', 900, 20)];

const PLANNER_BEATS = [
  '### 场景 1：雨夜的石阶',
  '**核心冲突**：林舟必须在门与追兵之间作出选择。',
  '**关键动作链**：观察—确认—试探。',
  '**退场钩子**：门后的声音换了称呼。',
  '',
  '### 场景 2：账册里的出入',
  '**核心冲突**：苏晚发现账册缺了一页。',
  '**关键动作链**：核对—比对—收存。',
  '**退场钩子**：缺失的一页出现在别处。',
  '',
  '### 场景 3：车辙指向别处',
  '**核心冲突**：老周察觉车辙被人改过。',
  '**关键动作链**：勘察—推断—折返。',
  '**退场钩子**：路边多了一盏没点亮的灯。',
].join('\n');

// 硬缺陷夹具：正文之后附两行行首元数据标签（勿用 markdown `**…**`，那会额外触发
// provider 侧 markdown-residue）。实测章程门 codes=[metadata-residue/P1]、provider 守卫放行。
const RESIDUE_DRAFT = [
  body('A', 300, 40),
  '核心冲突：左妄必须确认尸体与桥墩下异象的同源性。',
  '关键动作链：左妄蹲下拨开碎发，小马在旁例行公事地试探盘问。',
].join('\n\n');

// Plan 266 修复④ 用例：让重写轮的 writer 调用直接抛错（provider 抖动）。
const WRITER_THROW = 'WRITER_THROW';

// Plan 266 修复⑤（证据契约）用例夹：五维高分 PASS 但省略 evidence —— 真机 run 334e123b 的
// 失败形态（classifyCriticFeedback 依约判 unknown，契约见 tests/critic-status-contract.test.ts）。
const FIVE_DIM_NO_EVIDENCE = JSON.stringify({
  scores: {
    可读性: { score: 9, reason: '清晰' },
    分镜执行度: { score: 9, reason: '完整' },
    冲突推进度: { score: 9, reason: '推进' },
    风格契合度: { score: 9, reason: '契合' },
    网文章节感: { score: 9, reason: '有钩子' },
  },
  totalScore: 45,
  pass: true,
  failReason: '',
  fatalIssues: [],
  surgerySuggestions: [],
});

const AUDIT_JSON = JSON.stringify({
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

const AUDIT_JSON_LOW = JSON.stringify({
  score: 30,
  fatalIssues: [],
  sceneChecks: [],
  surgerySuggestions: [],
  evidence: [
    { category: 'scene_execution', severity: 'high', quote: '场景证据', explanation: '场景执行不足', suggestedFix: '重写场景' },
    { category: 'character_state', severity: 'high', quote: '角色证据', explanation: '人物选择不稳', suggestedFix: '重写人物动机' },
    { category: 'hard_canon', severity: 'low', quote: '设定证据', explanation: '设定约束一致', suggestedFix: '保持规则约束' },
    { category: 'foreshadowing', severity: 'low', quote: '伏笔证据', explanation: '章末信息可追踪', suggestedFix: '后续回收线索' },
  ],
});

async function runPipeline(options: {
  plannerBeats: string;
  drafts: string[];
  criticThrows?: boolean;
  criticScript?: Array<'throw' | 'truncated' | 'no-evidence' | 'low-score' | 'ok'>;
}) {
  const previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.API_KEY,
    baseUrl: process.env.API_BASE_URL,
  };
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = 'writer-gate-retry-key';
  process.env.API_BASE_URL = 'http://writer-gate-retry.local/v1';

  const requests: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const writerQueue = [...options.drafts];
  const criticQueue = options.criticScript ? [...options.criticScript] : [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      messages?: Array<{ content?: string }>;
      max_tokens?: number;
    };
    const prompt = body.messages?.map((message) => message.content || '').join('\n') || '';
    requests.push(prompt);
    bodies.push(body);
    if (options.criticThrows && prompt.includes('CRITIC_SENTINEL')) {
      throw new Error('critic provider unavailable (mock)');
    }
    let criticMode: 'throw' | 'truncated' | 'no-evidence' | 'low-score' | 'ok' | null = null;
    if (prompt.includes('CRITIC_SENTINEL') && criticQueue.length) {
      criticMode = criticQueue.shift() ?? null;
      if (criticMode === 'throw') {
        throw new Error('fetch failed (mock critic transport)');
      }
      if (criticMode === 'truncated') {
        const truncated = '{"scores":{"可读性":{"score":5,"reason":"节奏尚可"}';
        const truncatedStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: truncated }, finish_reason: 'length' }] })}\n\n`
              )
            );
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return {
          ok: true,
          status: 200,
          body: truncatedStream,
          json: async () => ({ choices: [{ message: { content: truncated } }] }),
        } as Response;
      }
    }
    let content: string;
    if (prompt.includes('SYSTEM CORRECTION GATE')) {
      content = CLEAN_SCENES[0];
    } else if (prompt.includes('PLANNER_SENTINEL')) {
      content = options.plannerBeats;
    } else if (prompt.includes('WRITER_SENTINEL')) {
      const writerDraft = writerQueue.shift() || CLEAN_SCENES[0];
      if (writerDraft === WRITER_THROW) {
        throw new Error('writer provider network error (mock)');
      }
      content = writerDraft;
    } else if (criticMode === 'no-evidence') {
      content = FIVE_DIM_NO_EVIDENCE;
    } else if (criticMode === 'low-score') {
      content = AUDIT_JSON_LOW;
    } else {
      content = AUDIT_JSON;
    }
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
    return { ok: true, status: 200, body: stream, json: async () => ({ choices: [{ message: { content } }] }) } as Response;
  }) as typeof fetch;

  try {
    const { reloadConfig } = await import('../server/lib/config');
    reloadConfig();
    const { runProductionPipeline } = await import('../server/helpers/ai-production-pipeline');
    const result = await runProductionPipeline({
      novelId: 'writer-quality-gate-retry-novel',
      userIntent: '推进本章冲突',
      contextStr: '普通故事上下文',
      stagePrompts: { planner: 'PLANNER_SENTINEL', writer: 'WRITER_SENTINEL', critic: 'CRITIC_SENTINEL' },
    });
    return { result, requests, bodies };
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

const writerRequestsOf = (requests: string[]) =>
  requests.filter((request) => request.includes('WRITER_SENTINEL') && !request.includes('SYSTEM CORRECTION GATE'));

test('soft-only quality gate failure rewrites the chapter with targeted feedback', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...SOFT_SCENES, ...CLEAN_SCENES],
  });

  const writerRequests = writerRequestsOf(requests);
  assert.equal(writerRequests.length, 6, 'three scenes written twice');
  assert.ok(
    !writerRequests.slice(0, 3).some((request) => request.includes('上一稿未通过正文质量门禁')),
    'first pass carries no retry feedback'
  );
  assert.ok(
    writerRequests.slice(3).every((request) => request.includes('上一稿未通过正文质量门禁')),
    'rewrite pass carries targeted feedback'
  );
  assert.match(writerRequests[3], /简陋/, 'feedback quotes the offending snippets');
  assert.equal(result.source, 'model');
  assert.ok(result.draft.includes('序号900段记录中'), 'the rewritten draft is the one that ships');
});

test('hard metadata residue still falls back instead of burning a retry', async () => {
  const { result, requests } = await runPipeline({ plannerBeats: 'BEATS', drafts: [RESIDUE_DRAFT] });

  assert.equal(result.source, 'fallback');
  assert.equal(writerRequestsOf(requests).length, 1, 'one writer attempt only, no rewrite pass');
  assert.ok(result.draft.length >= 4000);
});

test('audit-unavailable retry does not discard a gate-passing model draft', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...CLEAN_SCENES, WRITER_THROW],
    criticThrows: true,
  });

  assert.equal(
    writerRequestsOf(requests).length,
    4,
    'clean first pass (3 scene calls) then one failing rewrite scene call',
  );
  assert.equal(result.source, 'model', 'gate-passing model draft still ships');
  assert.ok(
    result.draft.includes('序号900段记录中'),
    'the salvaged model draft is what gets delivered',
  );
  assert.equal(result.auditStatus, 'unknown', 'audit state stays honest');
});

// Plan 266 修复⑤：审稿重试必须升级参数 —— 截断（truncated）扩 max_tokens 并附压缩指令；
// 传输类失败（network）由（a）generateText 层 maxAttempts=2 与（b）管线层升级超时重试共同兜住。
test('truncated critic JSON is retried with an escalated token budget', async () => {
  const { result, requests, bodies } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...CLEAN_SCENES],
    criticScript: ['truncated', 'ok'],
  });

  const criticIndexes = requests
    .map((request, index) => (request.includes('CRITIC_SENTINEL') ? index : -1))
    .filter((index) => index >= 0);
  assert.equal(criticIndexes.length, 2, 'critic retried exactly once');
  assert.ok(
    !requests[criticIndexes[0]].includes('重试输出要求'),
    'first attempt uses the plain contract'
  );
  assert.ok(
    requests[criticIndexes[1]].includes('重试输出要求'),
    'retry carries the compactness directive'
  );
  assert.equal(bodies[criticIndexes[0]].max_tokens, 6000, 'first attempt keeps the base budget');
  assert.equal(bodies[criticIndexes[1]].max_tokens, 10000, 'retry raises the output budget');
  assert.notEqual(result.auditStatus, 'unknown', 'escalated retry recovers the audit');
});

test('transient critic transport failures are retried before reporting unknown', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...CLEAN_SCENES],
    criticScript: ['throw', 'throw', 'ok'],
  });

  const criticRequests = requests.filter((request) => request.includes('CRITIC_SENTINEL'));
  assert.equal(criticRequests.length, 3, 'two in-layer attempts then the escalated pipeline retry');
  assert.notEqual(result.auditStatus, 'unknown', 'the escalated retry keeps the audit usable');
});

// Plan 266 修复⑤（证据契约）：分数可解析但 evidence 四类不全 → classifyCriticFeedback 判 unknown
// （既有契约，不得放宽）；重试必须附「补齐四类证据」指令，补上了 audit 就恢复可用。
test('five-dim PASS without semantic evidence is retried with the evidence directive', async () => {
  const { result, requests, bodies } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...CLEAN_SCENES],
    criticScript: ['no-evidence', 'ok'],
  });

  const criticIndexes = requests
    .map((request, index) => (request.includes('CRITIC_SENTINEL') ? index : -1))
    .filter((index) => index >= 0);
  assert.equal(criticIndexes.length, 2, 'critic retried exactly once');
  assert.ok(
    !requests[criticIndexes[0]].includes('上一轮缺少 evidence'),
    'first attempt uses the plain contract'
  );
  assert.ok(
    requests[criticIndexes[1]].includes('上一轮缺少 evidence'),
    'retry carries the evidence directive'
  );
  assert.match(requests[criticIndexes[1]], /foreshadowing/, 'retry names every required category');
  assert.equal(bodies[criticIndexes[1]].max_tokens, 10000, 'retry raises the output budget');
  const criticFormat = (bodies[criticIndexes[0]].response_format || {}) as {
    type?: string;
    json_schema?: { name?: string; strict?: boolean };
  };
  assert.equal(criticFormat.type, 'json_schema', '审稿请求下发 json_schema 强制结构（Plan 266 修复⑤c）');
  assert.equal(criticFormat.json_schema?.name, 'audit_response');
  assert.equal(criticFormat.json_schema?.strict, true);
  assert.notEqual(result.auditStatus, 'unknown', 'evidence retry recovers the audit');
});

// 重试有界：每次审稿调用最多升级一次；证据始终补不上时诚实地停在 unknown（不放宽契约）。
test('an unmet evidence contract still reports unknown instead of rubber-stamping', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...CLEAN_SCENES],
    criticScript: ['no-evidence', 'no-evidence', 'no-evidence', 'no-evidence'],
  });

  const criticRequests = requests.filter((request) => request.includes('CRITIC_SENTINEL'));
  assert.equal(criticRequests.length, 4, 'two chapter attempts, one escalated retry each');
  assert.equal(result.auditStatus, 'unknown', 'no evidence means no pass');
});

// Plan 278(3)(4)：模型短稿不再用模板句填充（R-267-1 真因：ensureMinimumDraftLength 的
// 通用「年代戏」句式池会污染稿尾），改为带篇幅反馈重写整章。
const SHORT_SCENES = [body('A', 1, 8), body('B', 1, 8), body('C', 1, 8)];

test('a short model draft is continued to full length instead of being padded with template sentences', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...SHORT_SCENES, ...CLEAN_SCENES],
  });

  const writerRequests = requests.filter((request) => request.includes('WRITER_SENTINEL'));
  assert.equal(writerRequests.length, 4, 'three scenes then one length continuation');
  const continuationRequest = writerRequests[3];
  assert.ok(continuationRequest.includes('无缝续写'), 'the short chapter is continued, not rewritten');
  assert.ok(continuationRequest.includes('还差约'), 'the continuation carries the measured shortfall');
  assert.ok(
    continuationRequest.includes('【已写出的正文末尾'),
    'the continuation starts from the existing prose',
  );
  assert.ok(
    !continuationRequest.includes('上一稿未通过正文质量门禁'),
    'no whole-chapter rewrite for a short draft',
  );
  for (const filler of ['更漏', '银票', '马厩', '算命摊', '梆子']) {
    assert.ok(
      !result.draft.includes(filler),
      `no template filler (${filler}) in the delivered draft`,
    );
  }

  assert.ok(result.draft.includes('序号1段记录中'), 'the original short scenes stay in place');
  assert.ok(result.draft.includes('晒场'), 'the continuation prose is appended to the chapter');
  assert.equal(result.source, 'model', 'the model draft wins once it is long enough');
});

// Plan 278(5)：修复/续写标志必须逐 attempt 重置——否则审稿回路重写出的短稿会
// 沿用它上一轮的「已过门」状态被当成模型稿直接交付（真机 pro-low8 rep3：2846 字交付）。
test('a below-contract rewrite cannot ride a stale repair pass', async () => {
  const { result } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [
      ...SHORT_SCENES,
      CLEAN_SCENES[0],
      ...SHORT_SCENES,
      '短。',
      '短。',
      '短。',
      '短。',
      '短。',
    ],
    criticScript: ['low-score', 'low-score', 'low-score', 'low-score', 'low-score', 'low-score'],
  });

  // 不变式：模型稿一旦交付就必须达篇幅合同；短的重写稿不得沿上一轮的状态被放行。
  assert.ok(
    result.source !== 'model' || result.draft.length >= 4000,
    'a model draft is never delivered below the length contract',
  );
  assert.ok(!result.draft.includes('短。'), 'a below-contract rewrite body is never shipped');
});
