/**
 * Plan 262 B1 · 护栏配置语义单源与「净增」审计。
 *
 * 背景：`guardrailIds` 里配 core-default 护栏是「假控制」——运行时早已无条件注入
 * 全部 core-default 资产（buildGuardrails），再配置同一条只会被去重（Δ 恒为 0），
 * 而界面把它算进「增强护栏已开启 N 条」。引用壳（square-13/square-3）是第二种
 * 无净增形态：配置能通过校验，但注入阶段被壳卡过滤丢弃。
 *
 * 验收（对应计划 B1 三条判据）：
 * ① 分类与审计单源在 shared/lib/guardrail-scope（25 张质量护栏 → 可选 9 = 真净增 7 + 引用壳 2，默认生效 12）；
 * ② 服务端 Δ 实测：core-default 与引用壳配置后 stagePrompts 逐字节不变；真卡有净增；
 * ③ 写路径兼容：core-default 与引用壳仍可被接受（存量档案重存不 400），非质量护栏被拒 400。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import {
  resolveWritingStyleRequest,
  validateCapabilityProfile,
  WritingStyleRequestError,
} from '../server/helpers/writing-style-service.js';
import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import {
  auditGuardrailSelection,
  isDefaultOnGuardrail,
  isReadyQualityGuardrail,
  isSelectableGuardrail,
  isShellGuardrail,
} from '../shared/lib/guardrail-scope.js';
import type { Novel } from '../shared/types.js';

function v3Novel(guardrailIds: string[]): Novel {
  return {
    id: 'novel-1',
    title: '测试作品',
    authorId: 'author',
    summary: '',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: {
      tags: [],
      weights: {
        styleWeight: 1,
        characterWeight: 1,
        worldWeight: 1,
        plotWeight: 1,
        pacingWeight: 1,
      },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
        guardrailIds,
      },
    },
    createdAt: 1,
    updatedAt: 1,
  } as Novel;
}

function seed(guardrailIds: string[]): void {
  closeDb();
  initDb(':memory:');
  db.createNovel(v3Novel(guardrailIds));
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

type Snapshot = ReturnType<typeof resolveWritingStyleRequest>['executionSnapshot'];

function stageDigests(snapshot: Snapshot): Record<string, string> {
  return {
    planner: digest(snapshot.stagePrompts.planner),
    writer: digest(snapshot.stagePrompts.writer),
    critic: digest(snapshot.stagePrompts.critic),
  };
}

function guardrailKeys(snapshot: Snapshot): string[] {
  return snapshot.guardrails.map((guardrail) => `${guardrail.id}@${guardrail.stage}`);
}

function snapshotFor(guardrailIds: string[]): Snapshot {
  seed(guardrailIds);
  return resolveWritingStyleRequest('novel-1').executionSnapshot;
}

test('分类单源：25 张质量护栏 → 可选 9（真净增 7 + 引用壳 2）/ 默认生效 12', () => {
  closeDb();
  const guardrails = PROMPT_GOVERNANCE_CATALOG.filter(
    (asset) => asset.primaryCategory === 'quality-guardrail'
  );
  assert.equal(guardrails.length, 25);

  const optional = guardrails.filter((asset) => isSelectableGuardrail(asset));
  const defaultOn = guardrails.filter((asset) => isDefaultOnGuardrail(asset));
  assert.equal(optional.length, 9);
  assert.equal(defaultOn.length, 12);

  const shells = optional.filter((asset) => isShellGuardrail(asset)).map((asset) => asset.id);
  assert.deepEqual(shells.sort(), ['square-13', 'square-3']);
  // 真净增 7 张：模板都是 133–380 字的实际指令，不是 37/39 字的引用壳。
  const real = optional.filter((asset) => !isShellGuardrail(asset)).map((asset) => asset.id);
  assert.deepEqual(real, [
    'private-162',
    'private-130',
    'private-101',
    'private-100',
    'private-86',
    'private-85',
    'de-ai-tells-guard',
  ]);

  // 三项就绪门缺一不可：候选/未消毒资产不落入任何「可配置」桶。
  assert.equal(
    isReadyQualityGuardrail({
      id: 'candidate-guardrail',
      primaryCategory: 'quality-guardrail',
      isRuntimeReady: true,
      runtimeStatus: 'candidate',
      sanitizationStatus: 'runtime-ready',
    }),
    false
  );
  assert.equal(
    isSelectableGuardrail({
      id: 'candidate-guardrail',
      primaryCategory: 'quality-guardrail',
      isRuntimeReady: true,
      runtimeStatus: 'candidate',
      sanitizationStatus: 'runtime-ready',
    }),
    false
  );
});

test('auditGuardrailSelection：trim 去重 + 无净增/不可用逐条给出原因', () => {
  const audit = auditGuardrailSelection(
    [
      'core-slop-shield',
      ' de-ai-tells-guard ',
      'de-ai-tells-guard',
      'square-13',
      'core-dialogue-enhancer',
      'ghost-guardrail',
      'default-guardrail',
      '',
      '   ',
    ],
    PROMPT_GOVERNANCE_CATALOG
  );

  assert.deepEqual(audit.selectable, ['de-ai-tells-guard']);
  assert.deepEqual(
    audit.redundant.map((entry) => entry.id),
    ['core-slop-shield', 'square-13', 'default-guardrail']
  );
  assert.deepEqual(
    audit.unusable.map((entry) => entry.id),
    ['core-dialogue-enhancer', 'ghost-guardrail']
  );
  assert.match(audit.redundant[0].note, /默认已生效/);
  assert.match(audit.redundant[1].note, /引用壳/);
  assert.match(audit.redundant[2].note, /占位/);
  assert.match(audit.unusable[0].note, /不可用/);

  // 空账：三项皆空，不伪造条目。
  assert.deepEqual(auditGuardrailSelection([], PROMPT_GOVERNANCE_CATALOG), {
    selectable: [],
    redundant: [],
    unusable: [],
  });
});

test('服务端 Δ：core-default 与引用壳配置后三阶段提示词逐字节不变', () => {
  const baseline = snapshotFor([]);
  const coreDefault = snapshotFor(['core-slop-shield']);
  const shell = snapshotFor(['square-13']);

  assert.deepEqual(stageDigests(coreDefault), stageDigests(baseline));
  assert.deepEqual(guardrailKeys(coreDefault), guardrailKeys(baseline));
  assert.deepEqual(stageDigests(shell), stageDigests(baseline));
  assert.deepEqual(guardrailKeys(shell), guardrailKeys(baseline));
  // 去重：core-slop-shield 只出现一次（本来就是 core-default 注入项）。
  assert.equal(
    coreDefault.guardrails.filter((guardrail) => guardrail.id === 'core-slop-shield').length,
    1
  );
});

test('服务端 Δ：真卡（de-ai-tells-guard / private-162）注入 writer 且有净增', () => {
  const baseline = snapshotFor([]);
  const real = snapshotFor(['de-ai-tells-guard']);
  assert.notDeepEqual(stageDigests(real), stageDigests(baseline));
  assert.ok(real.stagePrompts.writer.length > baseline.stagePrompts.writer.length);
  assert.ok(guardrailKeys(real).includes('de-ai-tells-guard@writer'));
  // 审计与实测一致：这条卡被归入「可选」而不是「无净增」。
  assert.deepEqual(
    auditGuardrailSelection(['de-ai-tells-guard'], PROMPT_GOVERNANCE_CATALOG).selectable,
    ['de-ai-tells-guard']
  );

  const privateCard = snapshotFor(['private-162']);
  assert.ok(privateCard.stagePrompts.writer.length > baseline.stagePrompts.writer.length);
  assert.ok(guardrailKeys(privateCard).includes('private-162@writer'));
});

test('写路径兼容：core-default 与引用壳仍被接受，非质量护栏被拒 400', () => {
  seed([]);
  const profile = (guardrailIds: string[]) => ({
    version: 3,
    projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
    favoriteTechniqueIds: [],
    guardrailIds,
  });

  // 存量档案重存不得因为「配置无净增」而 400（收紧只在界面回执与审计层）。
  assert.deepEqual(validateCapabilityProfile('novel-1', profile(['core-slop-shield'])), []);
  assert.deepEqual(validateCapabilityProfile('novel-1', profile(['square-13', 'default-guardrail'])), []);
  assert.deepEqual(validateCapabilityProfile('novel-1', profile(['de-ai-tells-guard'])), []);

  for (const id of ['core-dialogue-enhancer', 'ghost-guardrail']) {
    assert.throws(
      () => validateCapabilityProfile('novel-1', profile([id])),
      (error: unknown) =>
        error instanceof WritingStyleRequestError &&
        error.status === 400 &&
        error.code === 'CAPABILITY_GUARDRAIL_UNAVAILABLE'
    );
  }
  closeDb();
});
