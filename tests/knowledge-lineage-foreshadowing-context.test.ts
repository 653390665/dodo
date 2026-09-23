import test from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, getDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import {
  loadForeshadowingContext,
  runLineageEnrichment,
} from '../server/helpers/knowledge-lineage-enrich.js';

const XIGANG_FIXTURE = `
# 《测试》逐章细纲数据库

### Ch001 · 立交桥下的尸体
**核心事件**：左妄在桥下发现尸体。
**伏笔埋点**：左妄手腕的淤痕与死者同源
**回收章**：Ch005
`;

function now(): number {
  return Date.now();
}

function seedNovel(id: string): void {
  getDb()
    .prepare('INSERT INTO novels (id, title, created_at, updated_at) VALUES (?,?,?,?)')
    .run(id, '台账测试作品', now(), now());
}

function seedCharacter(novelId: string, id: string, name: string): void {
  getDb()
    .prepare('INSERT INTO characters (id, novel_id, name, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(id, novelId, name, now(), now());
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
      now(),
      now()
    );
}

function insertLedger(
  novelId: string,
  row: {
    id: string;
    title: string;
    status?: string;
    planted?: string | null;
    payoff?: string | null;
    notes?: string | null;
    cast?: string[];
  }
): void {
  getDb()
    .prepare(
      `INSERT INTO foreshadowings
        (id, novel_id, title, description, status, planted_chapter_id, payoff_chapter_id, related_character_ids, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      row.id,
      novelId,
      row.title,
      `${row.title}的描述`,
      row.status ?? 'planted',
      row.planted ?? null,
      row.payoff ?? null,
      JSON.stringify(row.cast ?? []),
      row.notes ?? null,
      now(),
      now()
    );
}

test('loadForeshadowingContext 把台账分成应埋 / 应回收 / 前文未回收三类', () => {
  closeDb();
  initDb(':memory:');
  const novelId = 'novel-ledger';
  seedNovel(novelId);
  seedCharacter(novelId, 'c-left', '左妄');
  insertLedger(novelId, { id: 'f-plant', title: '门上的便利贴', planted: 'Ch002', payoff: 'Ch009' });
  insertLedger(novelId, { id: 'f-sub', title: '子场景钩子', planted: 'Ch002_1', payoff: 'Ch020' });
  insertLedger(novelId, {
    id: 'f-payoff',
    title: '死者手腕淤痕',
    planted: 'Ch001',
    payoff: 'Ch002',
    notes: '通过差评破局回收',
    cast: ['c-left'],
  });
  insertLedger(novelId, { id: 'f-arrear', title: '雨夜的神秘来客', planted: 'Ch001', payoff: 'Ch012' });
  insertLedger(novelId, {
    id: 'f-done',
    title: '已回收的旧钩子',
    status: 'payoff',
    planted: 'Ch001',
    payoff: 'Ch002',
    cast: ['c-left'],
  });

  const context = loadForeshadowingContext(novelId, 2);

  assert.deepEqual(context.toPlant.map((row) => row.id), ['f-plant', 'f-sub']);
  assert.deepEqual(context.toPayOff.map((row) => row.id).sort(), ['f-done', 'f-payoff']);
  assert.deepEqual(context.arrears.map((row) => row.id), ['f-arrear']);
  // (b) 台账关联角色解析成名字，供 writer 图谱过滤扩展
  assert.deepEqual(context.relatedCharacterNames, ['左妄']);

  assert.match(context.promptBlock, /本章应回收/);
  assert.match(context.promptBlock, /本章应埋设/);
  assert.match(context.promptBlock, /仍未回收的旧伏笔/);
  assert.match(context.promptBlock, /雨夜的神秘来客/);
  assert.match(context.promptBlock, /回收说明：通过差评破局回收/);

  assert.match(context.checklistBlock, /应回收/);
  assert.match(context.checklistBlock, /应埋设/);
  assert.match(context.checklistBlock, /不应遗忘/);
  assert.doesNotMatch(context.checklistBlock, /不应遗忘[^\n]*已回收的旧钩子/);
  closeDb();
});

test('loadForeshadowingContext 无台账时返回空块，不污染提示词', () => {
  closeDb();
  initDb(':memory:');
  seedNovel('novel-empty');
  const context = loadForeshadowingContext('novel-empty', 3);
  assert.equal(context.promptBlock, '');
  assert.equal(context.checklistBlock, '');
  assert.deepEqual(context.relatedCharacterNames, []);
  assert.deepEqual(context.toPlant, []);
  assert.deepEqual(context.toPayOff, []);
  assert.deepEqual(context.arrears, []);
  closeDb();
});

test('runLineageEnrichment 在角色库就绪后回填台账 related_character_ids', () => {
  closeDb();
  initDb(':memory:');
  const novelId = 'novel-backfill';
  seedNovel(novelId);
  seedPack(novelId, '逐章细纲.md', XIGANG_FIXTURE);

  // 第一次：角色库还没有「左妄」，台账落库时 related_character_ids 为空。
  const first = runLineageEnrichment(novelId);
  assert.ok(first.ledgerInserted >= 1, `expected ledger insert, got ${first.ledgerInserted}`);
  const rowBefore = getDb()
    .prepare('SELECT related_character_ids AS ids FROM foreshadowings WHERE novel_id = ?')
    .get(novelId) as { ids: string };
  assert.deepEqual(JSON.parse(rowBefore.ids), []);

  // 确认入世界后角色已存在，再次 enrichment 必须回填关联角色（幂等且可修复）。
  seedCharacter(novelId, 'c-left', '左妄');
  const second = runLineageEnrichment(novelId);
  assert.ok(second.ledgerBackfilled >= 1, `expected backfill, got ${second.ledgerBackfilled}`);
  const rowAfter = getDb()
    .prepare('SELECT related_character_ids AS ids FROM foreshadowings WHERE novel_id = ?')
    .get(novelId) as { ids: string };
  assert.ok((JSON.parse(rowAfter.ids) as string[]).includes('c-left'));

  // 再跑一次不应重复回填（幂等）
  const third = runLineageEnrichment(novelId);
  assert.equal(third.ledgerBackfilled, 0);
  closeDb();
});
