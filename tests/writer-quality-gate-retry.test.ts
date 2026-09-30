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

async function runPipeline(options: { plannerBeats: string; drafts: string[] }) {
  const previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.API_KEY,
    baseUrl: process.env.API_BASE_URL,
  };
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = 'writer-gate-retry-key';
  process.env.API_BASE_URL = 'http://writer-gate-retry.local/v1';

  const requests: string[] = [];
  const writerQueue = [...options.drafts];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ content?: string }> };
    const prompt = body.messages?.map((message) => message.content || '').join('\n') || '';
    requests.push(prompt);
    const content = prompt.includes('SYSTEM CORRECTION GATE')
      ? CLEAN_SCENES[0]
      : prompt.includes('PLANNER_SENTINEL')
        ? options.plannerBeats
        : prompt.includes('WRITER_SENTINEL')
          ? writerQueue.shift() || CLEAN_SCENES[0]
          : AUDIT_JSON;
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
    return { result, requests };
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
