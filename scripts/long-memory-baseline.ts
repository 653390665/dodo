/**
 * 长篇记忆基线：中段章节的实体/伏笔命中率（接入前 → 图谱选择性注入 → 接入后）
 *
 * 固定长书样本（48 章 / 12 角色 / 4 地点 / 3 道具 / 3 势力 / 12 条长程回声），
 * 全程离线：桩 provider 抓三阶段请求，桩 SemanticRecallDeps 用确定性 bigram 向量检索。
 * 只读隔离内存库（initDb(':memory:')），不碰生产库。
 *
 * 三态（口径）：
 *   A 接入前     = 分镜不含 `**出场人物**` ⇒ 图谱全量注入（等同批次 C 修复前）
 *                  + 无语义召回
 *   B 图谱选择性 = 分镜含 `**出场人物**` ⇒ 按 cast 过滤 + 无语义召回
 *   C 接入后     = 分镜含 cast + 语义召回（§5.8）
 *
 * 命中定义（写在 docs/specs/capability-flow-graph-consolidation.md §5.10）：
 *   实体 recall  = 本章细纲声明实体 ∩ 请求 system 注入中出现的实体 / 声明实体数
 *   实体精确率   = 声明实体在注入实体中的占比（1 − 噪声率）
 *   长程回声命中 = 引入于 ≥10 章前的回声标记是否出现在三阶段请求内容中
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { closeDb, getDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import { buildProductionPromptContexts } from '../shared/lib/chapter-production.js';
import {
  SEMANTIC_RECALL_MARKER,
  buildSemanticRecallSection,
  type SemanticRecallDeps,
} from '../server/helpers/story-context.js';

const NOVEL_ID = 'lb-novel';
const TOTAL_CHAPTERS = 48;
const MID_CHAPTERS = [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];

const CHARACTERS = ['林舟', '苏晚', '陈九', '顾长安', '沈砚', '阿禾', '陆青', '白芷', '裴无咎', '温若雪', '秦望', '江离'];
const LOCATIONS = ['雾港渡口', '旧盐仓', '北塔钟楼', '青石巷'];
const ITEMS = ['铜铃', '盐票', '赤霄剑'];
const FACTIONS = ['夜航司', '盐铁帮', '清议堂'];
const ALL_ENTITIES = [...CHARACTERS, ...LOCATIONS, ...ITEMS, ...FACTIONS];

/** 中段章声明出场（4 人） */
const MID_CAST: Record<number, string[]> = {
  25: ['林舟', '苏晚', '陈九', '阿禾'],
  26: ['顾长安', '沈砚', '陆青', '白芷'],
  27: ['林舟', '裴无咎', '温若雪', '秦望'],
  28: ['苏晚', '江离', '陈九', '沈砚'],
  29: ['林舟', '顾长安', '阿禾', '白芷'],
  30: ['苏晚', '陆青', '裴无咎', '江离'],
  31: ['林舟', '陈九', '温若雪', '秦望'],
  32: ['顾长安', '沈砚', '阿禾', '白芷'],
  33: ['苏晚', '林舟', '陆青', '裴无咎'],
  34: ['江离', '温若雪', '秦望', '陈九'],
  35: ['林舟', '顾长安', '苏晚', '阿禾'],
  36: ['沈砚', '陆青', '白芷', '裴无咎'],
};

/** 长程回声：埋设章 ≤ 中段章 − 10（也超出近期 2–5 章台账窗口） */
const ECHOES = MID_CHAPTERS.map((midChapter, index) => ({
  token: `回响-${String(index + 1).padStart(2, '0')}`,
  words: [
    ['铜铃', '渡口', '守夜人'],
    ['盐票', '暗仓', '账册'],
    ['钟楼', '刻痕', '巡夜'],
    ['药草', '偏院', '旧方'],
    ['信纸', '蜡封', '驿道'],
    ['灯芯', '地道', '木牌'],
    ['潮汐', '标尺', '渔火'],
    ['玉佩', '当铺', '掌纹'],
    ['铁券', '军械', '旧部'],
    ['河图', '沙盘', '烽燧'],
    ['墨笔', '书阁', '残页'],
    ['铜锁', '牢门', '刻字'],
  ][index],
  fromChapter: 3 + index,
  midChapter,
}));

const narrative = (order: number): string =>
  `第${order}章记录：${CHARACTERS[order % CHARACTERS.length]}在${LOCATIONS[order % LOCATIONS.length]}处理日常事务，天色转暗。`;

function earlyChapterText(order: number): string {
  const echo = ECHOES.find((e) => e.fromChapter === order);
  if (!echo) return narrative(order);
  const [w0, w1, w2] = echo.words;
  const hints = [w0, w0, w0, w1, w1, w1, w2, w2, w2].join('、');
  return `${narrative(order)}关键线索${echo.token}：${hints}的痕迹被反复记下。${w0}与${w1}在${w2}处对上了。`;
}

function midBeats(order: number, withCast: boolean): string {
  const echo = ECHOES.find((e) => e.midChapter === order);
  const words = echo ? echo.words : ['雾', '灯'];
  const lines = [
    `## 场景 1：${words[0]}之前的${words[1]}`,
    withCast ? `**出场人物**：${MID_CAST[order].join('、')}` : '',
    `**地点**：${LOCATIONS[order % LOCATIONS.length]}`,
    `**事件**：围绕${words.join('、')}展开的当面对质。`,
    `**退场钩子**：${words[1]}的去向尚未交代。`,
    '## 场景 2：回程',
    withCast ? `**出场人物**：${MID_CAST[order].slice(0, 2).join('、')}` : '',
    `**地点**：${LOCATIONS[(order + 1) % LOCATIONS.length]}`,
    '**事件**：把线索收回并确认下一步。',
    '**退场钩子**：有人提前等在门口。',
  ];
  return lines.filter((line) => line !== '').join('\n');
}

const DRAFT = Array.from(
  { length: 36 },
  (_, i) =>
    `序号${i + 1}段记录中，林舟沿着潮湿的石阶向前走，记下墙面上新鲜的划痕和远处逐渐靠近的脚步。` +
    `他在第${i + 1}次确认时暂缓回应门后的询问，先确认手中的物件仍然完整，随后把下一步行动拆成几个可以回收的选择。` +
    `第${i + 1}阵风从巷口穿过，带来陌生的药草气味，守在灯下的人终于抬起头，示意他把信纸放到桌面中央。`
).join('\n\n');

const AUDIT = JSON.stringify({
  score: 82,
  fatalIssues: [],
  sceneChecks: [],
  surgerySuggestions: [],
  evidence: [
    { category: 'scene_execution', severity: 'low', quote: 'q', explanation: 'e', suggestedFix: 'f' },
    { category: 'character_state', severity: 'low', quote: 'q', explanation: 'e', suggestedFix: 'f' },
    { category: 'hard_canon', severity: 'low', quote: 'q', explanation: 'e', suggestedFix: 'f' },
    { category: 'foreshadowing', severity: 'low', quote: 'q', explanation: 'e', suggestedFix: 'f' },
  ],
});

// ---------------------------------------------------------------- 确定性向量
const DIM = 256;
function embedText(text: string): number[] {
  const vector = new Array<number>(DIM).fill(0);
  const chars = [...String(text).replace(/\s+/g, '')];
  for (let i = 0; i < chars.length - 1; i += 1) {
    let hash = 0;
    for (const ch of chars[i] + chars[i + 1]) {
      hash = (hash * 131 + (ch.codePointAt(0) || 0)) % 1_000_003;
    }
    vector[hash % DIM] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < DIM; i += 1) dot += a[i] * b[i];
  return dot;
}

const CHUNKS: Array<{ novelId: string; chapterId: string; text: string }> = [];

function stubDeps(): SemanticRecallDeps {
  return {
    getChunkCount: (novelId) => CHUNKS.filter((c) => c.novelId === novelId).length,
    getEmbeddingStatus: () => ({ status: 'ready' }),
    embedWithMetadata: async (text) => ({ values: embedText(text), modelId: 'stub-bigram-64' }),
    searchSimilar: (values, novelId, _modelId, topK) =>
      CHUNKS.filter((chunk) => chunk.novelId === novelId)
        .map((chunk) => ({
          text: chunk.text,
          score: cosine(values, embedText(chunk.text)),
          chapterId: chunk.chapterId,
        }))
        .sort((a, b) => b.score - a.score || a.chapterId.localeCompare(b.chapterId))
        .slice(0, topK),
  };
}

// ---------------------------------------------------------------- 固定样本种子
function seedSample(): void {
  const db = getDb();
  const now = 1_700_000_000_000;
  db.prepare(
    'INSERT INTO novels (id, title, author_id, summary, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run(NOVEL_ID, '长篇记忆基线样本', 'local-user', '', 'ongoing', now, now);

  const insertChapter = db.prepare(
    `INSERT INTO chapters (id, novel_id, volume_name, title, content, "order", word_count, scene_beats, workflow_meta, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (let order = 1; order <= TOTAL_CHAPTERS; order += 1) {
    const quietChapter = !MID_CHAPTERS.includes(order);
    const content = quietChapter ? earlyChapterText(order) : `${narrative(order)}这一章把此前记下的线索摆到桌面上。`;
    const beats = MID_CHAPTERS.includes(order) ? midBeats(order, true) : '';
    insertChapter.run(
      `Ch${String(order).padStart(3, '0')}`,
      NOVEL_ID,
      '第一卷',
      `第${order}章`,
      content,
      order,
      content.length,
      beats,
      '{}',
      now + order,
      now + order
    );
  }

  const insertCharacter = db.prepare(
    'INSERT INTO characters (id, novel_id, name, role, summary, traits, bio, current_state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  );
  CHARACTERS.forEach((name, index) => {
    insertCharacter.run(`c-${index + 1}`, NOVEL_ID, name, index < 4 ? 'main' : 'supporting', `${name}的设定`, '[]', '', '', now, now);
  });
  const insertLocation = db.prepare(
    'INSERT INTO locations (id, novel_id, name, description, region, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  );
  LOCATIONS.forEach((name, index) => insertLocation.run(`l-${index + 1}`, NOVEL_ID, name, `${name}的环境`, '雾港', now, now));
  const insertItem = db.prepare(
    'INSERT INTO items (id, novel_id, name, description, type, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  );
  ITEMS.forEach((name, index) => insertItem.run(`i-${index + 1}`, NOVEL_ID, name, `${name}的道具`, 'prop', now, now));
  const insertFaction = db.prepare(
    'INSERT INTO factions (id, novel_id, name, description, leader, territory, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  FACTIONS.forEach((name, index) => insertFaction.run(`f-${index + 1}`, NOVEL_ID, name, `${name}的势力`, CHARACTERS[index], '雾港', now, now));

  const insertEdge = db.prepare(
    'INSERT INTO entity_relationships (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  for (let i = 0; i < CHARACTERS.length; i += 1) {
    const source = `c-${i + 1}`;
    const target = `c-${((i + 1) % CHARACTERS.length) + 1}`;
    insertEdge.run(`e-${i + 1}`, NOVEL_ID, 'character', source, 'character', target, '同行', '同一条线索上的人', now);
  }
  for (let i = 0; i < 4; i += 1) {
    insertEdge.run(`e-loc-${i + 1}`, NOVEL_ID, 'character', `c-${i + 1}`, 'location', `l-${i + 1}`, '常驻', '常在此处活动', now);
  }

  const insertForeshadowing = db.prepare(
    'INSERT INTO foreshadowings (id, novel_id, title, description, status, planted_chapter_id, payoff_chapter_id, related_character_ids, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  const longRange = [
    ['fs-1', '伏笔·铜铃的第三道划痕', 'Ch003', 'c-1'],
    ['fs-2', '伏笔·盐票背面的小字', 'Ch007', 'c-2'],
    ['fs-3', '伏笔·钟楼未敲的那一响', 'Ch012', 'c-3'],
    ['fs-4', '伏笔·药草中的旧方', 'Ch030', 'c-6'],
  ];
  longRange.forEach(([id, title, planted, character], index) => {
    insertForeshadowing.run(id, NOVEL_ID, title, `${title} 的记录`, 'planted', planted, null, JSON.stringify([character]), null, now + index, now + index);
  });
  insertForeshadowing.run('fs-5', NOVEL_ID, '伏笔·已回收的旧账', '旧账的记录', 'payoff', 'Ch004', 'Ch020', '[]', null, now, now);

  // 细纲（资料包）——供台账 toPlant/payOff 渲染
  const xigang = ['# 逐章细纲', ''];
  for (let order = 1; order <= TOTAL_CHAPTERS; order += 1) {
    xigang.push(`### Ch${String(order).padStart(3, '0')} · 第${order}章`);
    xigang.push(`- 出场角色：${MID_CAST[order] ? MID_CAST[order].join('、') : CHARACTERS[order % CHARACTERS.length]}`);
    xigang.push(`- 场景：${LOCATIONS[order % LOCATIONS.length]}`);
    xigang.push(`- 目标：推进第${order}章的线索。`);
    xigang.push('');
  }
  const docs = [
    { filename: '逐章细纲.md', kind: 'outline', text: xigang.join('\n') },
    { filename: '元设定.md', kind: 'world', text: '雾港、盐运与夜航司的三角关系。' },
  ];
  db.prepare(
    `INSERT INTO continuation_packs
      (id, novel_id, title, status, source_documents, canon_facts, character_states, plot_state, style_profile, contradictions, continuation_task, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    'pack-lb',
    NOVEL_ID,
    '长篇记忆基线资料包',
    'approved',
    JSON.stringify(docs),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify({ currentTimeline: '雾港纪年', latestScene: '渡口', immediateConflict: '对质', nextLikelyMove: '回程', unresolvedHooks: [] }),
    JSON.stringify({ pov: '第三人称', pacing: '慢火', dialogueDensity: '中', proseTraits: [], avoidTraits: [] }),
    JSON.stringify([]),
    JSON.stringify({ summary: '继续推进线索' }),
    now,
    now
  );

  // 向量索引：早期章节正文（= 长程回声的唯一载体）
  const insertChunk = db.prepare(
    'INSERT INTO vector_chunks (id, novel_id, chapter_id, chunk_index, text, embedding) VALUES (?,?,?,?,?,?)'
  );
  ECHOES.forEach((echo, index) => {
    const chapterId = `Ch${String(echo.fromChapter).padStart(3, '0')}`;
    const text = earlyChapterText(echo.fromChapter);
    insertChunk.run(`vc-${index + 1}`, NOVEL_ID, chapterId, 0, text, JSON.stringify(embedText(text)));
    CHUNKS.push({ novelId: NOVEL_ID, chapterId, text });
  });
}

// ---------------------------------------------------------------- 三阶段请求抓取
interface CapturedRequest {
  stage: 'planner' | 'writer' | 'critic' | 'other';
  system: string;
  all: string;
}

async function runState(order: number, withCast: boolean, withSemantic: boolean): Promise<CapturedRequest[]> {
  const captured: CapturedRequest[] = [];
  const beats = midBeats(order, withCast);
  let plannerCalls = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      messages?: Array<{ role?: string; content?: string }>;
      systemInstruction?: { parts?: Array<{ text?: string }> } | string;
    };
    const messages = body.messages || [];
    const systemRaw =
      typeof body.systemInstruction === 'string'
        ? body.systemInstruction
        : body.systemInstruction?.parts?.map((part) => part.text || '').join('\n') || '';
    const flat = messages.map((m) => m.content || '').join('\n');
    const stage: CapturedRequest['stage'] = /Planner Agent/.test(flat)
      ? 'planner'
      : /Writer Agent/.test(flat)
        ? 'writer'
        : /Critic Agent/.test(flat)
          ? 'critic'
          : 'other';
    captured.push({
      stage,
      system: [systemRaw, ...messages.filter((m) => m.role === 'system').map((m) => m.content || '')].join('\n'),
      all: flat,
    });
    if (process.env.LB_DUMP === '1') {
      writeFileSync(
        `/tmp/lb-dump-${withCast ? 'cast' : 'nocast'}${withSemantic ? '-sem' : ''}-ch${order}-n${captured.length}.txt`,
        `STATE withCast=${withCast} semantic=${withSemantic}\n===== SYSTEM =====\n${systemRaw}\n${messages
          .filter((m) => m.role === 'system')
          .map((m) => m.content || '')
          .join('\n')}\n===== MESSAGES =====\n${messages
          .map((m) => `[${m.role}] ${m.content || ''}`)
          .join('\n---\n')}`,
        'utf-8'
      );
    }

    plannerCalls += 1;
    const isAudit = /fatalIssues|sceneChecks/.test(messages.map((m) => m.content || '').join('\n'));
    const content = isAudit ? AUDIT : plannerCalls === 1 ? beats : DRAFT;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`)
        );
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return { ok: true, status: 200, body: stream, json: async () => ({ choices: [{ message: { content } }] }) } as Response;
  }) as typeof fetch;

  try {
    let semanticContext: string | undefined;
    if (withSemantic) {
      const chapter = getDb().prepare('SELECT title FROM chapters WHERE id = ?').get(`Ch${String(order).padStart(3, '0')}`) as
        | { title: string }
        | undefined;
      const section = await buildSemanticRecallSection(
        { novelId: NOVEL_ID, queryText: `${chapter?.title || ''}\n${beats}\n推进本章冲突` },
        stubDeps()
      );
      semanticContext = section ? `${section.marker}\n${section.text}` : undefined;
    }
    const stageContexts = buildProductionPromptContexts({
      layeredContext: '',
      plannerContext: '',
      writerContext: '',
      criticContext: '',
      semanticContext,
    });
    const { runProductionPipeline } = await import('../server/helpers/ai-production-pipeline.js');
    await runProductionPipeline({
      novelId: NOVEL_ID,
      chapterOrder: order,
      userIntent: '推进本章冲突',
      contextStr: stageContexts.writer,
      stageContexts,
      stagePrompts: { planner: '', writer: '', critic: '' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return captured;
}

// ---------------------------------------------------------------- 指标
interface Row {
  chapter: number;
  state: string;
  declared: number;
  writerInjected: number;
  writerRelevant: number;
  writerRecall: number;
  writerPrecision: number;
  plannerInjected: number;
  criticInjected: number;
  echoToken: string;
  echoHit: number;
}

function measure(order: number, state: string, captured: CapturedRequest[]): Row {
  const declared = MID_CAST[order];
  const writer = captured.filter((request) => request.stage === 'writer');
  const planner = captured.filter((request) => request.stage === 'planner');
  const critic = captured.filter((request) => request.stage === 'critic');
  const systemOf = (subset: CapturedRequest[]) => subset.map((request) => request.system).join('\n');
  const writerSystem = systemOf(writer);
  const writerInjected = ALL_ENTITIES.filter((name) => writerSystem.includes(name));
  const relevant = declared.filter((name) => writerSystem.includes(name));
  const echo = ECHOES.find((e) => e.midChapter === order);
  return {
    chapter: order,
    state,
    declared: declared.length,
    writerInjected: writerInjected.length,
    writerRelevant: relevant.length,
    writerRecall: declared.length ? relevant.length / declared.length : 1,
    writerPrecision: writerInjected.length ? relevant.length / writerInjected.length : 1,
    plannerInjected: ALL_ENTITIES.filter((name) => systemOf(planner).includes(name)).length,
    criticInjected: ALL_ENTITIES.filter((name) => systemOf(critic).includes(name)).length,
    echoToken: echo ? echo.token : '-',
    echoHit: writer.some((request) => request.all.includes(echo ? echo.token : '\u0000')) ? 1 : 0,
  };
}

const mean = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

async function main(): Promise<void> {
  closeDb();
  initDb(':memory:');
  seedSample();

  process.env.NODE_ENV = 'test';
  process.env.INKFLOW_CONFIG_DIR = '/tmp/inkflow-lb-config';
  mkdirSync(process.env.INKFLOW_CONFIG_DIR, { recursive: true });
  writeFileSync(
    `${process.env.INKFLOW_CONFIG_DIR}/config.json`,
    JSON.stringify({ apiKey: 'lb-key', baseUrl: 'http://lb.local/v1', model: 'lb-model' }),
    'utf-8'
  );
  process.env.API_KEY = 'lb-key';
  process.env.API_BASE_URL = 'http://lb.local/v1';
  process.env.API_MODEL = 'lb-model';
  const { reloadConfig } = await import('../server/lib/config.js');
  reloadConfig();

  const allStates: Array<{ key: string; withCast: boolean; withSemantic: boolean }> = [
    { key: 'A-接入前', withCast: false, withSemantic: false },
    { key: 'B-图谱选择性注入', withCast: true, withSemantic: false },
    { key: 'C-接入后', withCast: true, withSemantic: true },
  ];
  const states = process.env.LB_STATES
    ? allStates.filter((state) => process.env.LB_STATES!.split(',').includes(state.key[0]))
    : allStates;
  const activeChapters = process.env.LB_CHAPTERS
    ? process.env.LB_CHAPTERS.split(',').map(Number)
    : MID_CHAPTERS;

  const rows: Row[] = [];
  for (const state of states) {
    for (const order of activeChapters) {
      const captured = await runState(order, state.withCast, state.withSemantic);
      rows.push(measure(order, state.key, captured));
    }
  }

  const summary = states.map((state) => {
    const subset = rows.filter((row) => row.state === state.key);
    return {
      state: state.key,
      chapters: subset.length,
      recall: mean(subset.map((row) => row.writerRecall)),
      precision: mean(subset.map((row) => row.writerPrecision)),
      echoHitRate: mean(subset.map((row) => row.echoHit)),
      avgInjectedEntities: mean(subset.map((row) => row.writerInjected)),
      avgPlannerEntities: mean(subset.map((row) => row.plannerInjected)),
      avgCriticEntities: mean(subset.map((row) => row.criticInjected)),
    };
  });

  const summaryByKey = new Map(summary.map((entry) => [entry.state[0], entry]));
  const summaryOf = (key: string) => summaryByKey.get(key) ?? summary[0];

  const table = [
    '| 状态 | 实体 recall(writer) | 实体精确率(writer) | 长程回声命中率 | 平均注入实体数(writer) | 规划期实体数 | 审稿期实体数 |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const row of summary) {
    table.push(
      `| ${row.state} | ${row.recall.toFixed(3)} | ${row.precision.toFixed(3)} | ${row.echoHitRate.toFixed(3)} | ${row.avgInjectedEntities.toFixed(1)} | ${row.avgPlannerEntities.toFixed(1)} | ${row.avgCriticEntities.toFixed(1)} |`
    );
  }
  const baseline = summaryOf('A');
  const castOnly = summaryOf('B');
  const after = summaryOf('C');

  const checks = [
    { name: '基线长程回声命中率为 0', ok: baseline.echoHitRate === 0, detail: baseline.echoHitRate.toFixed(3) },
    { name: '接入后长程回声命中率 > 0 且高于基线', ok: after.echoHitRate > baseline.echoHitRate && after.echoHitRate >= 0.9, detail: after.echoHitRate.toFixed(3) },
    { name: '实体精确率提升（接入前 → 图谱选择性注入）', ok: castOnly.precision > baseline.precision, detail: `${baseline.precision.toFixed(3)} → ${castOnly.precision.toFixed(3)}` },
    { name: '实体 recall 不下降', ok: after.recall >= baseline.recall - 1e-9, detail: `${baseline.recall.toFixed(3)} → ${after.recall.toFixed(3)}` },
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    sample: {
      novel: NOVEL_ID,
      chapters: TOTAL_CHAPTERS,
      midChapters: MID_CHAPTERS,
      entities: ALL_ENTITIES.length,
      echoes: ECHOES.length,
      marker: SEMANTIC_RECALL_MARKER,
    },
    summary,
    checks,
    rows,
  };
  writeFileSync('/tmp/long-memory-baseline.json', JSON.stringify(report, null, 2), 'utf-8');
  writeFileSync(
    '/tmp/long-memory-baseline.md',
    ['# 长篇记忆基线（中段命中率）', '', ...table, '', '## 判定', ...checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.name}：${c.detail}`)].join('\n'),
    'utf-8'
  );

  console.log(table.join('\n'));
  console.log('\n判定：');
  for (const check of checks) console.log(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.name}：${check.detail}`);
  const failed = checks.filter((check) => !check.ok);
  console.log(`\n报告：/tmp/long-memory-baseline.json / /tmp/long-memory-baseline.md`);
  if (failed.length > 0) {
    console.error(`\n${failed.length} 项判定未通过`);
    process.exitCode = 1;
  }
  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
