import assert from 'node:assert/strict';
import test from 'node:test';

import { compactTextLength } from '../shared/lib/local-repair';

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
  contextStr?: string;
  runBudgetMs?: number;
  writerHangs?: boolean;
  writerPartialThenHangs?: boolean;
  partialDraft?: string;
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
  const budgetEvents: Array<{ stage: string; elapsedMs: number; budgetMs: number }> = [];
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
    } else if (options.writerPartialThenHangs) {
      // Plan 284（R-283-1）：模拟「流到一半就挂住」的上游（不发送结束帧）；预算看门狗 abort 后
      // 将流置为错误，好让管线走预算兜底分支（裁到完整句）。
      const partial = options.partialDraft ?? '';
      const signal = (init as RequestInit | undefined)?.signal ?? undefined;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (let i = 0; i < partial.length; i += 40) {
            const piece = partial.slice(i, i + 40);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: piece }, finish_reason: null }] })}\n\n`
              )
            );
          }
          const onAbort = () => controller.error(new Error('writer stream aborted'));
          if (signal) {
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
          }
        },
      });
      return { ok: true, status: 200, body: stream, json: async () => ({ choices: [{ message: { content: partial } }] }) } as Response;
    } else if (prompt.includes('WRITER_SENTINEL')) {
      if (options.writerHangs) {
        // Plan 284（R-283-2）：模拟一个不会自己返回的挂死调用（除非被 abort），
        // 用于验证 run 预算看门狗能把 abort 传进治理门。
        const signal = (init as RequestInit | undefined)?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          if (!signal) return;
          const onAbort = () => reject(signal.reason ?? new Error('writer call aborted'));
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        });
      }
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
      contextStr: options.contextStr ?? '普通故事上下文',
      stagePrompts: { planner: 'PLANNER_SENTINEL', writer: 'WRITER_SENTINEL', critic: 'CRITIC_SENTINEL' },
      runBudgetMs: options.runBudgetMs,
      progress: {
        onRunBudget: (update) => budgetEvents.push(update),
      },
    });
    return { result, requests, bodies, budgetEvents };
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

// ---------------------------------------------------------------------------------------------
// Plan 279（R-278-1..3）：保底稿去年代道具（见 tests/fallback-draft-tone.test.ts）、续写可多轮、
// 脱敏后只剩篇幅缺陷也要采用。
// ---------------------------------------------------------------------------------------------

const BLANK = String.fromCharCode(10, 10);

const shortfallOf = (request: string) => {
  const marker = '还差约 ';
  const at = request.indexOf(marker);
  assert.ok(at >= 0, 'the continuation prompt states the shortfall');
  const tail = request.slice(at + marker.length);
  return Number(tail.slice(0, tail.indexOf(' 字')));
};

const padTo = (base: string, target: number) => {
  let out = base;
  let page = 901;
  while (compactTextLength(out) < target) {
    out += BLANK + body('E', page, 2);
    // body(..., 2) 产出 page/page+1 两段，下一次必须跳两页，否则第二段会重复。
    page += 2;
  }
  return out;
};

// R-278-2：一轮续写补不到下限时必须继续续，而不是把短稿交给下一道关卡。
test('a still-short continuation is continued again up to the round cap', async () => {
  const TINY_SCENES = [body('A', 1, 4), body('B', 1, 4), body('C', 1, 4)];
  const SHORT_CONTINUATION = body('A', 300, 2);
  const LONG_CONTINUATION = `${body('D', 1, 20)}${BLANK}${body('E', 1, 20)}`;

  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...TINY_SCENES, SHORT_CONTINUATION, LONG_CONTINUATION],
  });

  const writerRequests = writerRequestsOf(requests);
  assert.equal(writerRequests.length, 5, 'three scenes then two length continuations');
  assert.ok(writerRequests[3].includes('无缝续写'), 'the first continuation starts from the breakpoint');
  assert.ok(writerRequests[4].includes('无缝续写'), 'the still-short draft is continued again');
  const firstShortfall = shortfallOf(writerRequests[3]);
  const secondShortfall = shortfallOf(writerRequests[4]);
  assert.ok(secondShortfall > 0, 'the second continuation still measures a shortfall');
  assert.ok(secondShortfall < firstShortfall, 'the shortfall shrinks after the first continuation');
  assert.equal(result.source, 'model');
  assert.ok(result.draft.length >= 4000, 'the delivered draft meets the length contract');
  assert.ok(result.draft.includes('晒场'), 'the second continuation prose is appended');
});

// R-278-3：剥离后只剩篇幅缺陷时也要采用脱敏稿，否则泄漏正文会照旧送审。
test('a leak strip that only leaves a length shortfall is adopted and continued', async () => {
  const LEAK_CONTEXT = '关键人物：' + String.fromCharCode(10) + '- 林舟：潜伏在港务署的旧账房，负责核对每一条船期。';
  const LEAK_LINES = [
    '林舟是潜伏在港务署的旧账房，负责核对每一条船期。',
    '林舟潜伏在港务署的旧账房，负责核对每一条船期。',
    '林舟，潜伏在港务署的旧账房，负责核对每一条船期。',
  ];
  const leaking = `${padTo(body('C', 1, 20), 3000)}${BLANK}${LEAK_LINES.join(BLANK)}`;
  // R-278-2 与 R-278-3 叠加：采用后的脱敏稿仍不足合同，必须连补两轮才能交付。
  const SHORT_CONTINUATION = body('A', 300, 2);
  const LONG_CONTINUATION = body('A', 900, 20);

  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [leaking, body('A', 1, 2), body('B', 1, 2), SHORT_CONTINUATION, LONG_CONTINUATION],
    contextStr: LEAK_CONTEXT,
  });


  assert.ok(!result.draft.includes('负责核对每一条船期'), 'the leaked archive sentence never ships');
  assert.ok(!result.draft.includes('林舟是潜伏'), 'the leaked sentence is stripped before delivery');
  assert.equal(result.source, 'model');
  assert.ok(result.draft.length >= 4000, `delivered ${result.draft.length} chars`);
  const writerRequests = writerRequestsOf(requests);
  assert.equal(writerRequests.length, 5, 'the adopted strip is continued until the contract is met');
  assert.ok(writerRequests[3].includes('无缝续写'), 'the short stripped draft is continued');
  assert.ok(writerRequests[4].includes('无缝续写'), 'the still-short draft is continued again');
  assert.ok(result.draft.includes('序号900段记录中'), 'the continuation prose ships in the delivered draft');
});

// Plan 281（R-272-1）：split 模式下每个场景是独立调用，模型会用新的天色/环境/到场描写
// 重新起头，接起来像一串「新场景」而不是本章的连续推进（真机基线：9 个非首场，承接 0 次）。
test('split-scene prompts force every scene after the first to bridge the previous ending', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: CLEAN_SCENES,
  });

  const writerRequests = writerRequestsOf(requests);
  assert.equal(writerRequests.length, 3, 'one writer call per scene');
  assert.ok(writerRequests[0].includes('本章第一个场景'), 'the opening scene sets the stage');
  assert.ok(!writerRequests[0].includes('本场景不是本章开头'), 'the opening scene is not asked to bridge');
  assert.ok(writerRequests[1].includes('本场景不是本章开头'), 'scene 2 must bridge from the previous ending');
  assert.ok(writerRequests[1].includes('承接上一场景末尾'), 'scene 2 carries the bridge rule');
  assert.ok(writerRequests[2].includes('本章最终场景'), 'the last scene is told to close the chapter');
  assert.ok(writerRequests[2].includes('承接上一场景末尾'), 'the closing scene still bridges');
  assert.equal(result.source, 'model');
});


// Plan 282（R-281-1）：split 模式下重试反馈必须收窄到本场景。整章级反馈（「请重写整章」
// + 全章证据片段）会被送进每个场景调用，模型于是在每场重写一章 —— 真机 ac754320 的
// attempt 1/2 单场 4.9–6.4k 字、跨场景约 480 字逐字重复，门禁判 duplicate-paragraph
// + repeated-opening。
test('scene-scoped retry feedback keeps only the snippets found in that scene', async () => {
  const { scopeRetryFeedbackToScene } = await import('../server/helpers/ai-production-pipeline');
  const chapterFeedback =
    '【上一稿未通过正文质量门禁，请重写整章】具体问题：正文有 3 处局部风格瑕疵。' +
    '需要改写的具体语句：极其简陋的黄色外 / 非常简陋的临街铺 / 极其简陋的废弃车。' +
    '重写要求：段首句式必须多样化。';

  const scoped = scopeRetryFeedbackToScene(chapterFeedback, '那是一间非常简陋的临街铺面，屋里的人却都没有抬头。');

  assert.ok(scoped.includes('请重写本场景'), 'chapter-level rewrite wording is rewritten');
  assert.ok(!scoped.includes('请重写整章'), 'no chapter-level rewrite wording reaches a scene call');
  assert.ok(scoped.includes('非常简陋的临街铺'), 'the snippet owned by this scene survives');
  assert.ok(!scoped.includes('极其简陋的黄色外'), 'snippets owned by other scenes are dropped');
  assert.ok(!scoped.includes('极其简陋的废弃车'), 'snippets owned by other scenes are dropped');
  assert.ok(scoped.includes('具体问题：'), 'chapter-level problem list survives');
  assert.ok(scoped.includes('【本场景范围】'), 'scope note is appended');
});

test('split-scene rewrite prompts carry scene-scoped feedback instead of chapter-level feedback', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...SOFT_SCENES, ...CLEAN_SCENES],
  });

  const retryRequests = writerRequestsOf(requests).slice(3);
  assert.equal(retryRequests.length, 3, 'three scenes rewritten once');
  assert.ok(
    retryRequests.every((request) => request.includes('【本场景范围】')),
    'every scene rewrite carries the scene scope note',
  );
  assert.ok(
    retryRequests.every((request) => !request.includes('请重写整章')),
    'chapter-level rewrite wording never reaches a scene call',
  );
  assert.ok(
    retryRequests.every((request) => request.includes('上一稿未通过正文质量门禁')),
    'rewrite pass still carries the targeted feedback',
  );
  assert.equal(result.source, 'model');
});


// Plan 283（R-282-3）：run 墙钟预算——到点停止重试，把手上的最优稿交人审。
const BUDGET_TEST_SCENES = [...SOFT_SCENES];

test('a run that has spent its budget stops retrying and ships the model draft for review', async () => {
  const { result, requests, budgetEvents } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...BUDGET_TEST_SCENES, ...CLEAN_SCENES],
    runBudgetMs: 0,
  });

  assert.equal(
    writerRequestsOf(requests).length,
    3,
    'the scene pass is not replayed once the budget is gone',
  );
  assert.equal(result.budgetExhaustedAt, 'gate-fail');
  assert.equal(result.source, 'model', 'the model draft is delivered, not the deterministic fallback');
  assert.equal(result.auditStatus, 'unknown', 'no audit happened, and the result says so');
  assert.equal(result.score, undefined);
  assert.ok(
    result.draft.includes('极其简陋'),
    'the delivered draft is the prose the model actually wrote',
  );
  assert.equal(budgetEvents.length, 1, 'the author side is told once');
  assert.equal(budgetEvents[0].stage, 'gate-fail');
  assert.equal(budgetEvents[0].budgetMs, 0);
});

test('a run that has spent its budget does not wait for the critic either', async () => {
  const { result, requests, budgetEvents } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [...CLEAN_SCENES],
    runBudgetMs: 0,
  });

  assert.ok(
    requests.every((request) => !request.includes('CRITIC_SENTINEL')),
    'the critic call is skipped instead of being allowed to hang for another minute',
  );
  assert.equal(result.budgetExhaustedAt, 'before-critic');
  assert.equal(result.source, 'model');
  assert.equal(result.auditStatus, 'unknown');
  assert.equal(budgetEvents.length, 1);
  assert.equal(budgetEvents[0].stage, 'before-critic');
});

test('a hung writer call cannot outlive the run budget (plan 284 R-283-2)', async () => {
  const started = Date.now();
  const { result, budgetEvents } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [body('A', 1, 4)],
    writerHangs: true,
    runBudgetMs: 1500,
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 4000, `budget watchdog must end the run, took ${elapsed}ms`);
  assert.ok(result.budgetExhaustedAt, 'the stop stage is reported');
  assert.ok(budgetEvents.length >= 1, 'the author side is told');
});

test('a budget-salvaged draft is trimmed back to its last complete sentence (plan 284 R-283-1)', async () => {
  const complete = body('A', 1, 6) + body('B', 1, 6);
  const dangling = '他抬手想把灯重新点亮，可指尖刚碰到灯罩，里面的火就熄了下去，他又把手收了回来，想等一等再说';
  const { result, budgetEvents } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: [],
    writerPartialThenHangs: true,
    partialDraft: complete + dangling,
    runBudgetMs: 1500,
  });
  assert.equal(result.source, 'model', 'the salvaged model draft ships');
  assert.equal(result.budgetExhaustedAt, 'writer-error');
  assert.ok(result.draft.endsWith('。'), 'the draft ends on a complete sentence');
  assert.ok(!result.draft.includes('可指尖刚碰到灯罩'), 'the dangling half-sentence is dropped');
  assert.ok(result.draft.includes(body('A', 1, 1).slice(0, 8)), 'the streamed prose is kept');
  assert.ok(budgetEvents.length >= 1);
});
