import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeDb, getDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import { createNovel } from '../server/lib/db.js';
import { loadChapterContract } from '../server/helpers/knowledge-lineage-enrich.js';
import { resolveProjectExecutionContract } from '../server/helpers/writing-style-service.js';
import { buildProductionExecutionReceipt } from '../shared/lib/chapter-production.js';
import type { ExecutionSnapshot, StoryStateLedger } from '../shared/types.js';

/**
 * Plan 262 C4（2026-09-28）：死字段 / 半接线处置——
 * ① `ChapterContract.foreshadowingTasks`/`payoffNote` 接进 critic 核对清单；
 * ② `ExecutionSnapshot.sessionCards`（`overlays` 同值拷贝、零读方）删除；
 * ③ `ExecutionSnapshot.skillStack`/`techniques` 接进运行回执 + 阶段收据计数。
 */

const XIGANG_FIXTURE = `
# 《测试》逐章细纲数据库

### Ch001 · 立交桥下的尸体
**核心事件**：左妄在桥下发现尸体。
**伏笔埋点**：左妄手腕的淤痕与死者同源；订单编号 112 指向左妄住址
**回收章**：Ch005（暴走骑手首次击退）
`;

function seedNovelWithPack(novelId: string): void {
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO novels (id, title, created_at, updated_at) VALUES (?,?,?,?)')
    .run(novelId, 'C4 测试作品', now, now);
  getDb()
    .prepare(
      `INSERT INTO continuation_packs
        (id, novel_id, title, status, source_documents, canon_facts, character_states, plot_state, style_profile, contradictions, continuation_task, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      `pack-${novelId}`,
      novelId,
      'C4 资料包',
      'approved',
      JSON.stringify([{ filename: '左道指南-逐章细纲.md', kind: 'outline', text: XIGANG_FIXTURE }]),
      '[]',
      '[]',
      '{}',
      '{}',
      '[]',
      '{}',
      now,
      now
    );
}

const LEDGER: StoryStateLedger = {
  novelId: 'n',
  title: 't',
  summary: '',
  worldRules: '',
  globalOutline: '',
  recentChapters: [],
  entityStates: { characters: [], locations: [], items: [], factions: [], powerLevels: [] },
  timeline: [],
  openForeshadowings: [],
};

test('C4-1/2：细纲合同把逐条伏笔任务与回收安排送进 critic 核对清单', () => {
  closeDb();
  initDb(':memory:');
  try {
    seedNovelWithPack('c4-novel');
    const contract = loadChapterContract('c4-novel', 1);
    assert.ok(contract, '有细纲时应生成合同');
    assert.equal(contract.foreshadowingTasks.length, 2, '两句伏笔埋点拆成两条任务');
    assert.match(contract.payoffNote, /Ch005/);
    assert.match(contract.checklistText, /- 伏笔任务（逐条兑现，未兑现须在 fatalIssues 中指出）：/);
    assert.match(contract.checklistText, /1\. 左妄手腕的淤痕与死者同源/);
    assert.match(contract.checklistText, /2\. 订单编号 112 指向左妄住址/);
    assert.match(contract.checklistText, /- 回收安排（本条伏笔的回收章与方式）：Ch005/);
  } finally {
    closeDb();
  }
});

test('C4-3：执行快照不再暴露 sessionCards（overlays 同值拷贝）', () => {
  closeDb();
  initDb(':memory:');
  try {
    createNovel({
      id: 'c4-contract',
      title: 'Contract',
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
        skillLoadoutSchemaVersion: 2,
      } as never,
      createdAt: 1,
      updatedAt: 1,
    } as never);
    const contract = resolveProjectExecutionContract('c4-contract');
    assert.equal('sessionCards' in contract, false, '快照不再带 sessionCards');
    assert.ok(Array.isArray(contract.overlays), 'overlays 仍是唯一卡面出口');
  } finally {
    closeDb();
  }
});

test('C4-4：运行回执带上卡组结构与三阶段技法 id', () => {
  const snapshot = {
    capabilityRefs: ['main-card', 'main-card', 'tech-p'],
    writingStyleFingerprint: 'fp-1',
    resolvedAtGeneration: 7,
    skillStack: {
      mainCard: { id: 'main-card' },
      projectSupportCards: [{ id: 'support-world' }],
      chapterCards: [{ id: 'deconstruct-card-pacing' }],
    },
    techniques: {
      planner: [{ id: 'tech-p' }],
      writer: [{ id: 'tech-w' }],
      critic: [],
    },
  } as unknown as Pick<
    ExecutionSnapshot,
    'capabilityRefs' | 'writingStyleFingerprint' | 'resolvedAtGeneration'
  > &
    Partial<Pick<ExecutionSnapshot, 'skillStack' | 'techniques'>>;
  const receipt = buildProductionExecutionReceipt(snapshot, LEDGER);
  assert.deepEqual(receipt.capabilityRefs, ['main-card', 'tech-p'], 'capabilityRefs 去重口径不变');
  assert.deepEqual(receipt.skillStack, {
    mainCard: 'main-card',
    projectSupportCards: ['support-world'],
    chapterCards: ['deconstruct-card-pacing'],
  });
  assert.deepEqual(receipt.techniques, { planner: ['tech-p'], writer: ['tech-w'], critic: [] });

  const bare = buildProductionExecutionReceipt(
    { capabilityRefs: [], writingStyleFingerprint: 'fp-2' },
    LEDGER
  );
  assert.equal('skillStack' in bare, false, '旧调用方不带卡组字段时回执不变形');
  assert.equal('techniques' in bare, false);
});

test('C4-5：阶段收据条目数计入技法（此前少报）', () => {
  const source = readFileSync(
    new URL('../server/routes/production.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /const techniqueCount = executionSnapshot\.techniques\[stage\]\.length;/);
  assert.match(
    source,
    /roleSkillCount \+ overlayCount \+ guardrailCount \+ flowStepCount \+ techniqueCount/
  );
});
