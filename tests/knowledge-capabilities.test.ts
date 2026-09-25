/**
 * 批次 C · 图谱能力卡（knowledge-extract / foreshadow-settle）验收测试。
 *
 * 覆盖三条小类验收：
 * ① 两张卡可被卡组（projectSkillDeck）与本章使用卡（sessionCardIds）解析；
 * ② knowledge-extract 触发幂等 enrich 并返回 coverage 数值；
 * ③ foreshadow-settle 对未回收伏笔给出核对清单。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { closeDb, getDb, getDatabaseGeneration } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { registerUtilityRoutes } from '../server/routes/utilities.js';
import { resolveWritingStyleRequest } from '../server/helpers/writing-style-service.js';
import {
  KnowledgeCapabilityError,
  runKnowledgeCapability,
} from '../server/helpers/knowledge-capabilities.js';
import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import { getCatalogCapabilityManifest } from '../shared/lib/capability-manifest-catalog.js';
import { cardRoleForManifest } from '../shared/lib/capability-card-role.js';
import type { Novel } from '../shared/types.js';

const app = express();
app.use(express.json());
registerUtilityRoutes(app);
const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
  const instance = app.listen(0, () => resolve(instance));
  instance.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

test.after(() => {
  closeDb();
  server.close();
});

function novel(id: string, overrides: Partial<Novel> = {}): Novel {
  return {
    id,
    title: '图谱能力卡测试作品',
    authorId: 'local',
    summary: '',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Novel;
}

function seedPack(novelId: string, filename: string, text: string): void {
  getDb()
    .prepare(
      `INSERT INTO continuation_packs
        (id, novel_id, title, status, source_documents, canon_facts, character_states, plot_state, style_profile, contradictions, continuation_task, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      `pack-${novelId}`,
      novelId,
      '测试资料包',
      'approved',
      JSON.stringify([{ filename, kind: 'outline', text }]),
      '[]',
      '[]',
      '{}',
      '{}',
      '[]',
      '{}',
      1,
      1
    );
}

const XIGANG_FIXTURE = `
# 《测试》逐章细纲数据库

### Ch001 · 立交桥下的尸体
**核心事件**：左妄在桥下发现尸体。
**伏笔埋点**：左妄手腕的淤痕与死者同源
**回收章**：Ch005
`;

test('两张图谱能力卡已登记进 manifest 目录且角色投影为 transform/diagnostic', () => {
  const extract = getCatalogCapabilityManifest('knowledge-extract');
  const settle = getCatalogCapabilityManifest('foreshadow-settle');
  assert.ok(extract && settle);
  assert.equal(extract.kind, 'utility');
  assert.equal(extract.action, 'run-utility');
  assert.equal(extract.runtimeStatus, 'active');
  assert.ok(extract.allowedScopes.includes('project'));
  assert.equal(settle.kind, 'diagnostic');
  assert.equal(settle.action, 'run-diagnostic');
  assert.equal(settle.runtimeStatus, 'active');
  assert.equal(cardRoleForManifest(extract), 'transform');
  assert.equal(cardRoleForManifest(settle), 'diagnostic');
  // 工具卡不进护栏通道：货架卡必须是 optional-style（core-default 会被 buildGuardrails 收走）。
  for (const id of ['knowledge-extract', 'foreshadow-settle']) {
    assert.equal(PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === id)?.placementTier, 'optional-style');
  }
});

test('本章使用卡路径可解析两张图谱能力卡，且不把工具卡文本注入三阶段提示', () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(novel('kc-session'));
    const resolved = resolveWritingStyleRequest('kc-session', {
      sessionCardIds: ['knowledge-extract', 'foreshadow-settle'],
    });
    const cards = resolved.executionSnapshot.skillStack.chapterCards;
    assert.deepEqual(
      cards.map((card) => [card.id, card.type, card.stages.length]),
      [
        ['knowledge-extract', 'tool:utility', 0],
        ['foreshadow-settle', 'tool:diagnostic', 0],
      ]
    );
    const extractTemplate =
      PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === 'knowledge-extract')?.template ?? '';
    assert.ok(extractTemplate.length > 0);
    for (const prompt of [
      resolved.executionSnapshot.stagePrompts.planner,
      resolved.executionSnapshot.stagePrompts.writer,
      resolved.executionSnapshot.stagePrompts.critic,
      resolved.plannerPrompt,
      resolved.writerPrompt,
      resolved.criticPrompt,
    ]) {
      assert.ok(!prompt.includes(extractTemplate));
    }
  } finally {
    closeDb();
  }
});

test('作品卡组路径可把图谱能力卡解析为主卡（不再被 skill-card 门拒绝）', () => {
  closeDb();
  initDb(':memory:');
  try {
    const current = novel('kc-deck');
    current.projectPreferenceProfile!.capabilityProfile!.projectSkillDeck = {
      mainCardId: 'knowledge-extract',
      supportCardIds: [],
      updatedAt: 1,
    };
    db.createNovel(current);
    const resolved = resolveWritingStyleRequest('kc-deck');
    const mainCard = resolved.executionSnapshot.skillStack.mainCard;
    assert.ok(mainCard);
    assert.equal(mainCard.id, 'knowledge-extract');
    assert.equal(mainCard.type, 'tool:utility');
    assert.equal(resolved.resolution.mode, 'skill-deck');
  } finally {
    closeDb();
  }
});

test('knowledge-extract 触发幂等 enrich 并返回 coverage 数值', () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(novel('kc-extract'));
    seedPack('kc-extract', '逐章细纲.md', XIGANG_FIXTURE);
    const first = runKnowledgeCapability('kc-extract', 'knowledge-extract');
    assert.equal(first.kind, 'coverage');
    if (first.kind !== 'coverage') return;
    assert.equal(first.coverage.xigangEntries, 1);
    assert.equal(first.coverage.ledgerInserted, 1);
    assert.equal(first.coverage.coverage.foreshadowings, 1);
    assert.equal(typeof first.coverage.coverage.edges, 'number');

    const second = runKnowledgeCapability('kc-extract', 'knowledge-extract');
    assert.equal(second.kind, 'coverage');
    if (second.kind !== 'coverage') return;
    assert.equal(second.coverage.ledgerInserted, 0);
    assert.equal(second.coverage.ledgerSkipped, 1);
    assert.deepEqual(second.coverage.coverage, first.coverage.coverage);
  } finally {
    closeDb();
  }
});

test('foreshadow-settle 对未回收伏笔给出核对清单（含欠账与已回收排除）', () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(novel('kc-settle'));
    db.createChapter({
      id: 'kc-settle-ch1',
      novelId: 'kc-settle',
      title: '第一章',
      content: '',
      order: 1,
      wordCount: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    db.createChapter({
      id: 'kc-settle-ch2',
      novelId: 'kc-settle',
      title: '第二章',
      content: '',
      order: 2,
      wordCount: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    db.createForeshadowing({
      id: 'f-arrear',
      novelId: 'kc-settle',
      title: '雨夜的神秘来客',
      description: '来客身份未明',
      status: 'planted',
      plantedChapterId: 'Ch001',
      payoffChapterId: 'Ch012',
      relatedCharacterIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    db.createForeshadowing({
      id: 'f-hinted',
      novelId: 'kc-settle',
      title: '挂在墙上的旧照片',
      description: '已暗示但未回收',
      status: 'hinted',
      plantedChapterId: 'Ch002',
      payoffChapterId: 'Ch014',
      relatedCharacterIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    db.createForeshadowing({
      id: 'f-done',
      novelId: 'kc-settle',
      title: '已回收的旧钩子',
      description: '已回收',
      status: 'payoff',
      plantedChapterId: 'Ch001',
      payoffChapterId: 'Ch002',
      relatedCharacterIds: [],
      createdAt: 1,
      updatedAt: 1,
    });

    const result = runKnowledgeCapability('kc-settle', 'foreshadow-settle');
    assert.equal(result.kind, 'checklist');
    if (result.kind !== 'checklist') return;
    const checklist = result.checklist;
    assert.equal(checklist.currentChapterOrder, 2);
    assert.equal(checklist.openCount, 2);
    assert.equal(checklist.settledCount, 1);
    assert.equal(checklist.arrears, 1);
    assert.deepEqual(
      checklist.entries.map((entry) => entry.id),
      ['f-arrear', 'f-hinted']
    );
    assert.equal(checklist.entries[0].arrears, true);
    assert.match(checklist.entries[0].action, /仍未回收/);
    assert.equal(checklist.entries[1].arrears, false);
    assert.match(checklist.entries[1].action, /按计划推进/);
    assert.equal(checklist.summary, '未回收 2 条（其中欠账 1 条）/ 已回收 1 条');
    assert.ok(!checklist.entries.some((entry) => entry.id === 'f-done'));
  } finally {
    closeDb();
  }
});

function countRows(table: 'foreshadowings' | 'entity_relationships', novelId: string): number {
  // foreshadowings 用 snake_case 的 novel_id，entity_relationships 用 camelCase 的 novelId。
  const column = table === 'foreshadowings' ? 'novel_id' : 'novelId';
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
    .get(novelId) as { n: number };
  return row.n;
}

test('knowledge-extract 重跑不产生重复行（台账与关系边行数不变）', () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(novel('kc-idem'));
    seedPack('kc-idem', '逐章细纲.md', XIGANG_FIXTURE);
    db.createCharacter({
      id: 'kc-idem-c1',
      novelId: 'kc-idem',
      name: '左妄',
      role: 'protagonist',
      summary: '',
      traits: [],
      bio: '',
      createdAt: 1,
      updatedAt: 1,
    });
    db.createCharacter({
      id: 'kc-idem-c2',
      novelId: 'kc-idem',
      name: '车夫',
      role: 'supporting',
      summary: '',
      traits: [],
      bio: '',
      createdAt: 1,
      updatedAt: 1,
    });
    db.createEntityRelationship({
      id: 'kc-idem-rel1',
      novelId: 'kc-idem',
      sourceType: 'character',
      sourceId: 'kc-idem-c1',
      targetType: 'character',
      targetId: 'kc-idem-c2',
      relationshipType: '雇佣',
      createdAt: 1,
    });

    const edgesBefore = countRows('entity_relationships', 'kc-idem');
    assert.equal(countRows('foreshadowings', 'kc-idem'), 0);

    const first = runKnowledgeCapability('kc-idem', 'knowledge-extract');
    assert.equal(first.kind, 'coverage');
    if (first.kind !== 'coverage') return;
    assert.equal(first.coverage.ledgerInserted, 1);
    const ledgerAfterFirst = countRows('foreshadowings', 'kc-idem');
    assert.equal(ledgerAfterFirst, 1);

    const second = runKnowledgeCapability('kc-idem', 'knowledge-extract');
    assert.equal(second.kind, 'coverage');
    if (second.kind !== 'coverage') return;
    assert.equal(second.coverage.ledgerInserted, 0);
    assert.equal(second.coverage.ledgerSkipped, 1);
    // 幂等的硬断言：第二次重跑不产生任何新行。
    assert.equal(countRows('foreshadowings', 'kc-idem'), ledgerAfterFirst);
    assert.equal(countRows('entity_relationships', 'kc-idem'), edgesBefore);
  } finally {
    closeDb();
  }
});

test('无资料包时重跑被拒（KNOWLEDGE_SOURCE_PACK_MISSING）且零写入', async () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(novel('kc-nopack'));
    assert.throws(
      () => runKnowledgeCapability('kc-nopack', 'knowledge-extract'),
      (error) =>
        error instanceof KnowledgeCapabilityError &&
        error.status === 400 &&
        error.code === 'KNOWLEDGE_SOURCE_PACK_MISSING'
    );
    assert.equal(countRows('foreshadowings', 'kc-nopack'), 0);
    assert.equal(countRows('entity_relationships', 'kc-nopack'), 0);

    const response = await fetch(
      `${baseUrl}/api/novels/kc-nopack/knowledge-capabilities/knowledge-extract/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ databaseGeneration: getDatabaseGeneration() }),
      }
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { code: string; error: string };
    assert.equal(payload.code, 'KNOWLEDGE_SOURCE_PACK_MISSING');
    assert.match(payload.error, /未找到续写资料包/);
    assert.equal(countRows('foreshadowings', 'kc-nopack'), 0);
  } finally {
    closeDb();
  }
});

test('runKnowledgeCapability 对未知作品与未知卡给出可判定错误码', () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(novel('kc-errors'));
    assert.throws(
      () => runKnowledgeCapability('missing-novel', 'knowledge-extract'),
      (error) => error instanceof KnowledgeCapabilityError && error.status === 404 && error.code === 'KNOWLEDGE_NOVEL_NOT_FOUND'
    );
    assert.throws(
      () => runKnowledgeCapability('kc-errors', 'de-ai-slop-shield'),
      (error) => error instanceof KnowledgeCapabilityError && error.status === 400 && error.code === 'KNOWLEDGE_CAPABILITY_UNSUPPORTED'
    );
  } finally {
    closeDb();
  }
});

test('作品级路由返回 coverage/清单，代际过期与非法卡走 409/400/404', async () => {
  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(novel('kc-route'));
    seedPack('kc-route', '逐章细纲.md', XIGANG_FIXTURE);
    const generation = getDatabaseGeneration();
    const run = (assetId: string, body: unknown) =>
      fetch(`${baseUrl}/api/novels/kc-route/knowledge-capabilities/${assetId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const ok = await run('knowledge-extract', { databaseGeneration: generation });
    assert.equal(ok.status, 200);
    const payload = (await ok.json()) as { kind: string; coverage?: { ledgerInserted: number } };
    assert.equal(payload.kind, 'coverage');
    assert.equal(typeof payload.coverage?.ledgerInserted, 'number');

    const settle = await run('foreshadow-settle', { databaseGeneration: generation });
    assert.equal(settle.status, 200);
    assert.equal(((await settle.json()) as { kind: string }).kind, 'checklist');

    const stale = await run('knowledge-extract', { databaseGeneration: generation + 999 });
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { code: string }).code, 'DATABASE_GENERATION_STALE');

    const unsupported = await run('de-ai-slop-shield', { databaseGeneration: generation });
    assert.equal(unsupported.status, 400);
    assert.equal(((await unsupported.json()) as { code: string }).code, 'KNOWLEDGE_CAPABILITY_UNSUPPORTED');

    const missing = await fetch(
      `${baseUrl}/api/novels/missing-novel/knowledge-capabilities/knowledge-extract/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ databaseGeneration: generation }),
      }
    );
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { code: string }).code, 'KNOWLEDGE_NOVEL_NOT_FOUND');

    const invalid = await fetch(
      `${baseUrl}/api/novels/kc-route/knowledge-capabilities/knowledge-extract/run`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }
    );
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as { code: string }).code, 'KNOWLEDGE_INVALID_INPUT');
  } finally {
    closeDb();
  }
});
