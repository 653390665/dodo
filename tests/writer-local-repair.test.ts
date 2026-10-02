import test from 'node:test';
import assert from 'node:assert/strict';

// Plan 269：门禁命中 → 段落级定点修复的集成用例。
// 夹具与 tests/writer-quality-gate-retry.test.ts 同源（都复现真机那次的失败形态）：
//  - 三场景生成，每场景恰好 1 条高置信软命中。provider 侧守卫容忍 ≤2 条（逐场景放行），
//    拼接稿累计 3 条 → 章程门判 literary-slop/P1 并把整章退回。这正是要看定点修复的场景。
//  - 行首分镜字段属结构类硬缺陷，定点修补救不回来，必须跳过修复直接回退。
// mock 必须按内容特征分类调用：provider 守卫不通过时会追加一次含 [SYSTEM CORRECTION GATE 的纠错调用，
// 按调用序号映射会错位。

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

// 三条软命中分别落在三个场景：单场景在 provider 守卫容忍范围内，拼接稿累计 3 条触发章程门。
const SOFT_SCENES = [
  `${body('A', 1, 20)}\n\n那是一个极其简陋的黄色外卖界面。`,
  `${body('B', 1, 20)}\n\n那是一间非常简陋的临街铺面。`,
  `${body('C', 1, 20)}\n\n那是一座极其简陋的废弃车站。`,
];

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

// 硬缺陷夹具：正文之后附两行行首元数据标签（勿加 markdown `**…**`，那会额外触发 provider 侧 markdown-residue）。
const RESIDUE_DRAFT = [
  body('A', 300, 40),
  '核心冲突：左妄必须确认尸体与桥墩下异象的同源性。',
  '关键动作链：左妄蹲下拨开碎发，小马在旁例行公事地试探盘问。',
].join('\n\n');

const REPAIR_MAP: Array<[string, string]> = [
  ['极其简陋的黄色外卖界面', '他推开门，油烟味先撞上来。'],
  ['非常简陋的临街铺面', '卷帘门半开着，灯泡忽明忽暗。'],
  ['极其简陋的废弃车站', '站台上的钟停在某个凌晨。'],
];

// Plan 276：批量定点修复走一次调用；第一轮若仍有残留，用扩展的干净表再修一轮。
const BATCH_PROMPT_MARKER = '【输出格式'

// 第一轮故意回一批「仍然有软命中」的句子，用来验证第二轮定点修复。
const RESIDUAL_REPAIR_MAP: Array<[string, string]> = [
  ['极其简陋的黄色外卖界面', '那是一间极其简陋的临街铺面。'],
  ['非常简陋的临街铺面', '那是一间非常简陋的黄色外卖界面。'],
  ['极其简陋的废弃车站', '那是一座极其简陋的废弃车站。'],
];

const CLEAN_REPAIR_MAP: Array<[string, string]> = [
  ...REPAIR_MAP,
  ['极其简陋的临街铺面', '棚顶的塑料布被风揀起一角。'],
  ['非常简陋的黄色外卖界面', '窗台上的水痕还没干。'],
];

// 第二轮真正落地的干净句子（第一轮的替换句是故意留下的软命中）。
const SECOND_ROUND_REPLACEMENTS = [
  '棚顶的塑料布被风揀起一角。',
  '窗台上的水痕还没干。',
  '站台上的钟停在某个凌晨。',
];

function slotBlocks(prompt: string): Array<{ slot: string; body: string }> {
  const parts = prompt.split(/【第\s*(\d+)\s*处】/);
  const blocks: Array<{ slot: string; body: string }> = [];
  for (let index = 1; index < parts.length; index += 2) {
    blocks.push({ slot: parts[index], body: parts[index + 1] || '' });
  }
  return blocks;
}

function batchRepairFor(
  prompt: string,
  map: Array<[string, string]>,
  omitSlot?: string
): string {
  return slotBlocks(prompt)
    .filter(({ slot }) => slot !== omitSlot)
    .map(({ slot, body }) => {
      const matched = map.find(([marker]) => body.includes(marker));
      return `@@FIX ${slot}@@\n${matched ? matched[1] : '他停了一下，把话咽了回去。'}`;
    })
    .join('\n\n');
}


const REPAIR_INSTRUCTION_MARKER = '只修复被点名的这一小段';

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

function repairFor(prompt: string): string {
  const matched = REPAIR_MAP.find(([marker]) => prompt.includes(marker));
  return matched ? matched[1] : '他停了一下，把话咽了回去。';
}

async function runPipeline(options: {
  plannerBeats: string;
  drafts: string[];
  // Plan 276：模拟模型漏了某一处编号，以及第一轮批量回一批仍有软命中的句子。
  omitBatchSlots?: string[];
  residualFirstBatch?: boolean;
}) {
  const previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.API_KEY,
    baseUrl: process.env.API_BASE_URL,
  };
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = 'writer-local-repair-key';
  process.env.API_BASE_URL = 'http://writer-local-repair.local/v1';

  const requests: string[] = [];
  const writerQueue = [...options.drafts];
  let batchCalls = 0;
  let singleCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const payload = JSON.parse(String(init?.body || '{}')) as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = payload.messages?.map((message) => message.content || '').join('\n') || '';
    requests.push(prompt);
    let content: string;
    if (prompt.includes('SYSTEM CORRECTION GATE')) {
      // 安全网：与参考夹具一致，纠错重写回一份干净场景。
      content = body('D', 1, 20);
    } else if (prompt.includes('PLANNER_SENTINEL')) {
      content = options.plannerBeats;
    } else if (prompt.includes('WRITER_SENTINEL')) {
      content = writerQueue.shift() || body('D', 1, 20);
    } else if (prompt.includes(BATCH_PROMPT_MARKER)) {
      // Plan 276：批量定点修复一次修全部目标。
      batchCalls += 1;
      const useResidual = Boolean(options.residualFirstBatch) && batchCalls === 1;
      const omitSlots = batchCalls === 1 ? options.omitBatchSlots || [] : [];
      const full = batchRepairFor(prompt, useResidual ? RESIDUAL_REPAIR_MAP : CLEAN_REPAIR_MAP);
      content = omitSlots.length
        ? full
            .split('\n\n')
            .filter((block) => !omitSlots.some((slot) => block.startsWith('@@FIX ' + slot + '@@')))
            .join('\n\n')
        : full;
    } else if (prompt.includes(REPAIR_INSTRUCTION_MARKER) || REPAIR_MAP.some(([marker]) => prompt.includes(marker))) {
      singleCalls += 1;
      const singleResidual = Boolean(options.residualFirstBatch) && singleCalls <= 2;
      const singleMatch = singleResidual
        ? RESIDUAL_REPAIR_MAP.find(([marker]) => prompt.includes(marker))
        : undefined;
      content = singleMatch ? singleMatch[1] : repairFor(prompt);
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
    return {
      ok: true,
      status: 200,
      body: stream,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as Response;
  }) as typeof fetch;

  try {
    const { reloadConfig } = await import('../server/lib/config');
    reloadConfig();
    const { runProductionPipeline } = await import('../server/helpers/ai-production-pipeline');
    const result = await runProductionPipeline({
      novelId: 'writer-local-repair-novel',
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
  requests.filter(
    (request) => request.includes('WRITER_SENTINEL') && !request.includes('SYSTEM CORRECTION GATE')
  );

const repairRequestsOf = (requests: string[]) =>
  requests.filter(
    (request) =>
      request.includes(REPAIR_INSTRUCTION_MARKER) && !request.includes('SYSTEM CORRECTION GATE')
  );

test('a soft-only gate failure is repaired sentence-by-sentence instead of rewritten', async () => {
  const { result, requests } = await runPipeline({ plannerBeats: PLANNER_BEATS, drafts: SOFT_SCENES });

  assert.equal(result.source, 'model', 'the repaired draft ships as a model draft');
  assert.equal(result.localRepair?.attempted, true);
  assert.equal(result.localRepair?.passed, true);
  assert.equal(result.localRepair?.targets, 3, 'one target per soft sentence');
  assert.equal(result.localRepair?.applied, 3);
  assert.equal(result.localRepair?.skipped, 0);
  assert.equal(result.localRepair?.rounds, 1, 'a single local round was enough');

  const writerRequests = writerRequestsOf(requests);
  assert.equal(writerRequests.length, 3, 'three scenes written once \u2014 no whole-chapter rewrite burned');
  assert.ok(
    !writerRequests.some((request) => request.includes('上一稿未通过正文质量门禁')),
    'no rewrite pass with targeted feedback'
  );

  assert.ok(
    !result.draft.includes('极其简陋') && !result.draft.includes('非常简陋'),
    'soft hits are gone from the shipped draft'
  );

  for (const [, replacement] of REPAIR_MAP) {
    assert.ok(result.draft.includes(replacement), `replacement ships: ${replacement}`);
  }

  assert.equal(result.localRepair?.batchCalls, 2, 'three targets are split into batches of two');
  assert.equal(result.localRepair?.singleCalls, 0, 'every slot came back from a batch reply');

  const repairRequests = repairRequestsOf(requests);
  assert.equal(repairRequests.length, 2, 'three targets = two batch calls, no single top-up');
  for (const [marker] of REPAIR_MAP) {
    assert.ok(
      repairRequests.some((request) => request.includes(marker)),
      `the named sentence was sent for repair: ${marker}`
    );
  }
});

test('structural hard defects still skip local repair and fall back', async () => {
  const { result, requests } = await runPipeline({ plannerBeats: 'BEATS', drafts: [RESIDUE_DRAFT] });

  assert.equal(result.source, 'fallback');
  assert.equal(result.localRepair?.attempted, false, 'a hard defect is never sent to a sentence-level repair');
  assert.equal(result.localRepair?.passed, false);
  assert.match(
    String(result.localRepair?.reason || ''),
    /^hard-defect/,
    'the refusal reason names the blocking finding'
  );
  assert.equal(writerRequestsOf(requests).length, 1, 'one writer attempt only, no rewrite pass');
  assert.equal(repairRequestsOf(requests).length, 0, 'no repair call at all');
});

test('tops up a slot the batch response missed with a single-sentence call', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: SOFT_SCENES,
    omitBatchSlots: ['2'],
  });

  assert.equal(result.source, 'model');
  assert.equal(result.localRepair?.passed, true);
  assert.equal(result.localRepair?.targets, 3);
  assert.equal(result.localRepair?.applied, 3, 'the missed slot is still repaired');
  assert.equal(result.localRepair?.rounds, 1);

  assert.equal(result.localRepair?.batchCalls, 2, 'two batch chunks were sent');
  assert.equal(result.localRepair?.singleCalls, 1, 'exactly one slot needed a single top-up');

  const repairRequests = repairRequestsOf(requests);
  assert.equal(repairRequests.length, 3, 'two batch chunks plus one top-up for the missing slot');
  assert.ok(repairRequests[2].includes('临街铺面'), 'the top-up names the missed sentence');
  for (const [, replacement] of REPAIR_MAP) {
    assert.ok(result.draft.includes(replacement), `replacement ships: ${replacement}`);
  }
});

test('runs a second local round on the residue before burning a whole-chapter rewrite', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: SOFT_SCENES,
    residualFirstBatch: true,
    omitBatchSlots: ['2'],
  });

  assert.equal(result.source, 'model', 'the twice-repaired draft still ships as a model draft');
  assert.equal(result.localRepair?.passed, true);
  assert.equal(result.localRepair?.rounds, 2, 'the second local round closed the residue');
  assert.equal(result.localRepair?.targets, 5, 'three targets in round one, two re-picked in round two');
  assert.equal(result.localRepair?.applied, 5);
  assert.equal(result.localRepair?.batchCalls, 3, 'two chunks in round one, one chunk in round two');
  assert.equal(result.localRepair?.singleCalls, 1, 'the omitted slot needed one top-up');

  assert.equal(writerRequestsOf(requests).length, 3, 'no whole-chapter rewrite was burned');
  const repairRequests = repairRequestsOf(requests);
  assert.equal(
    repairRequests.filter((request) => request.includes(BATCH_PROMPT_MARKER)).length,
    3,
    'two chunked batch calls in round one plus one in round two'
  );
  assert.equal(repairRequests.length, 4, 'round one also topped up the missed slot');
  assert.ok(!result.draft.includes('简陋'), 'no slop from either round ships');
  for (const replacement of SECOND_ROUND_REPLACEMENTS) {
    assert.ok(result.draft.includes(replacement), `clean replacement ships: ${replacement}`);
  }
});

// Plan 277（R-276-2）：过门也可能留下可定点修复的软残留——不再等门禁失败才开第二轮。
test('runs a second local round when the gate passes but localizable residue stays', async () => {
  const { result, requests } = await runPipeline({
    plannerBeats: PLANNER_BEATS,
    drafts: SOFT_SCENES,
    residualFirstBatch: true,
  });

  assert.equal(result.source, 'model');
  assert.equal(result.localRepair?.passed, true);
  assert.equal(result.localRepair?.rounds, 2, 'the residue alone justified a second round');
  assert.equal(result.localRepair?.targets, 5, 'three targets in round one, two picked up in round two');
  assert.equal(result.localRepair?.applied, 5);
  assert.equal(result.localRepair?.batchCalls, 3, 'two chunks in round one, one chunk in round two');
  // Plan 277（R-276-1）：补丁回执走 patch 输出模式，不再被散文守卫改写，两处槽位都由批量回执补上。
  assert.equal(result.localRepair?.singleCalls, 0, 'the batch payload is returned verbatim, so nothing fell back');
  assert.equal(writerRequestsOf(requests).length, 3, 'the gate never failed, so no rewrite was burned');
  assert.equal(repairRequestsOf(requests).length, 3, 'three chunked batch calls, no single top-up');
  assert.ok(!result.draft.includes('简陋'), 'residual slop is gone from the shipped draft');
  for (const replacement of SECOND_ROUND_REPLACEMENTS) {
    assert.ok(result.draft.includes(replacement), `second-round replacement ships: ${replacement}`);
  }
});
