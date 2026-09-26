/**
 * 批次 C 第 4 条「步骤引用图谱能力卡」（Plan 262 C5）验收测试。
 *
 * 四层覆盖：
 * ① 解析器纯函数：未声明无诊断；六类失败各自给出诊断码，不静默回退；
 * ② 目录面：34 步里只有拆书 step3 / 小飞鸡 step9 声明能力引用，且都指向可运行的知识能力卡；
 * ③ 集成（真实契约）：能力引用步骤暴露可执行元数据，工具卡正文不进三层提示词；
 * ④ 执行面：步骤声明的资产 id 直接触发确定性动作（coverage / checklist），幂等且摘要可读。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, getDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import {
  KnowledgeCapabilityError,
  runKnowledgeCapability,
} from '../server/helpers/knowledge-capabilities.js';
import {
  resolveProjectExecutionContract,
  resolveWritingStyleRequest,
} from '../server/helpers/writing-style-service.js';
import { getCatalogCapabilityManifest } from '../shared/lib/capability-manifest-catalog.js';
import {
  FLOW_STEP_CAPABILITY_ENDPOINT,
  FLOW_STEP_CAPABILITY_WARNINGS,
  resolveFlowStepCapability,
} from '../shared/lib/flow-step-capability-ref.js';
import {
  KNOWLEDGE_CAPABILITY_IDS,
  summarizeKnowledgeCapabilityResult,
} from '../shared/lib/knowledge-capabilities.js';
import {
  PROMPT_GOVERNANCE_CATALOG,
  SKILL_SERIES_FLOWS,
} from '../shared/lib/prompt-governance-catalog.js';
import type { GovernedPromptAsset } from '../shared/types/prompt-assets-governed.js';
import type { Novel } from '../shared/types.js';

const EXTRACT_ID = 'knowledge-extract';
const SETTLE_ID = 'foreshadow-settle';

// ------------------------------------------------------------ ① 解析器纯函数

test('解析器：未声明能力引用 → null 且无诊断（旧行为不变）', () => {
  const attempt = resolveFlowStepCapability({});
  assert.equal(attempt.resolution, null);
  assert.equal(attempt.warning, undefined);
  for (const code of [
    'FLOW_STEP_CAPABILITY_UNRESOLVED',
    'FLOW_STEP_CAPABILITY_NOT_RUNNABLE',
    'FLOW_STEP_CAPABILITY_NO_KERNEL',
    'FLOW_STEP_CAPABILITY_NOT_RUNTIME_READY',
    'FLOW_STEP_CAPABILITY_SHELL',
    'FLOW_STEP_CAPABILITY_SCOPE_INVALID',
  ]) {
    assert.ok(FLOW_STEP_CAPABILITY_WARNINGS.includes(code as never), `${code} 应登记`);
  }
  assert.equal(
    FLOW_STEP_CAPABILITY_ENDPOINT,
    '/api/novels/:novelId/knowledge-capabilities/:assetId/run'
  );
});

test('解析器：未登记 / 非运行卡 / 无执行内核 / 作用域不合规 → 各自诊断码', () => {
  const ref = (assetId: string) => ({ capabilityRef: { assetId } });
  const manifest = (overrides: Record<string, unknown>) =>
    ({
      version: '1',
      kind: 'utility',
      stages: [],
      input: 'text',
      output: 'diagnostic',
      action: 'run-utility',
      allowedScopes: ['project'],
      persistence: 'project',
      sideEffect: 'none',
      runtimeStatus: 'active',
      sourceType: 'built-in',
      usageModes: ['single-run'],
      displayStages: [],
      ...overrides,
    }) as never;

  assert.equal(
    resolveFlowStepCapability(ref('not-registered'), { findManifest: () => undefined }).warning,
    'FLOW_STEP_CAPABILITY_UNRESOLVED'
  );
  assert.equal(
    resolveFlowStepCapability(ref('some-skill-card'), {
      findManifest: () => manifest({ kind: 'skill-card', action: 'inject' }),
    }).warning,
    'FLOW_STEP_CAPABILITY_NOT_RUNNABLE'
  );
  // 运行类工具卡但不在知识能力白名单：服务端没有内核，宁可拒绝。
  assert.equal(
    resolveFlowStepCapability(ref('other-tool'), { findManifest: () => manifest({}) }).warning,
    'FLOW_STEP_CAPABILITY_NO_KERNEL'
  );
  assert.equal(
    resolveFlowStepCapability(ref(EXTRACT_ID), {
      findManifest: () => manifest({ allowedScopes: ['chapter', 'single-run'] }),
    }).warning,
    'FLOW_STEP_CAPABILITY_SCOPE_INVALID'
  );
});

test('解析器：货架面缺失 / 未就绪 / 引用壳 → 各自诊断码（与执行内核同源判定）', () => {
  const realManifest = () => getCatalogCapabilityManifest(EXTRACT_ID);
  const ref = { capabilityRef: { assetId: EXTRACT_ID } };
  const asset = (overrides: Record<string, unknown>) =>
    ({
      id: EXTRACT_ID,
      title: '知识谱系抽取器',
      template: '真实正文：触发抽取并回报覆盖率。',
      isRuntimeReady: true,
      runtimeStatus: 'active',
      sanitizationStatus: 'runtime-ready',
      ...overrides,
    }) as unknown as GovernedPromptAsset;

  assert.equal(
    resolveFlowStepCapability(ref, { findManifest: realManifest, findAsset: () => undefined })
      .warning,
    'FLOW_STEP_CAPABILITY_UNRESOLVED'
  );
  assert.equal(
    resolveFlowStepCapability(ref, {
      findManifest: realManifest,
      findAsset: () => asset({ isRuntimeReady: false }),
    }).warning,
    'FLOW_STEP_CAPABILITY_NOT_RUNTIME_READY'
  );
  assert.equal(
    resolveFlowStepCapability(ref, {
      findManifest: realManifest,
      findAsset: () => asset({}),
      isRejectedTemplate: () => true,
    }).warning,
    'FLOW_STEP_CAPABILITY_SHELL'
  );

  // 真实目录 + 真实清单：两张卡均可解析，元数据全量带出。
  for (const id of KNOWLEDGE_CAPABILITY_IDS) {
    const resolution = resolveFlowStepCapability({ capabilityRef: { assetId: id } }).resolution;
    assert.ok(resolution, `${id} 应可解析`);
    assert.equal(resolution.assetId, id);
    assert.equal(resolution.scope, 'project');
    assert.ok(resolution.title.length > 0);
    assert.deepEqual(
      [...resolution.stages],
      [...(getCatalogCapabilityManifest(id)?.stages ?? [])],
      `${id} stages 应与清单一致`
    );
  }
});

// ---------------------------------------------------------------- ② 目录面

test('目录面：34 步里只两步声明能力引用，且都指向有执行内核的知识能力卡', () => {
  const rows = SKILL_SERIES_FLOWS.flatMap((flow) =>
    flow.steps.map((step) => ({ flowId: flow.id, step }))
  );
  assert.equal(rows.length, 34);
  const declared = rows.filter((row) => row.step.capabilityRef !== undefined);
  assert.deepEqual(
    declared.map((row) => row.step.id).sort(),
    ['book-deconstruction-flow-step3', 'xiaofeiji-novel-flow-step9']
  );
  for (const row of declared) {
    const assetId = row.step.capabilityRef?.assetId ?? '';
    assert.equal(assetId, row.step.assetId, '能力引用应与步骤资产同名（货架身份一致）');
    assert.ok(KNOWLEDGE_CAPABILITY_IDS.includes(assetId as never), `${assetId} 应在白名单`);
    const attempt = resolveFlowStepCapability(row.step);
    assert.equal(attempt.warning, undefined, `${row.step.id} 不应有诊断`);
    assert.equal(attempt.resolution?.scope, 'project');
  }
  // 能力引用是另一条通道：既有 cardRef 挂卡步骤数量不变（6）。
  assert.equal(rows.filter((row) => row.step.cardRef !== undefined).length, 6);
});

// ------------------------------------------------------------------- ③ 集成

function baseNovel(id: string, flowId: string, stepId: string): Novel {
  return {
    id,
    title: '能力引用测试作品',
    authorId: 'author',
    summary: '',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: {
      tags: [`current-step:${flowId}:${stepId}`],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        activeFlowId: flowId,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

test('集成：拆书 step3 / 小飞鸡 step9 带可执行元数据，工具卡正文不进三层提示', () => {
  const cases: ReadonlyArray<[string, string, string, string]> = [
    ['cap-step-decon', 'book-deconstruction-flow', 'book-deconstruction-flow-step3', EXTRACT_ID],
    ['cap-step-xiao', 'xiaofeiji-novel-flow', 'xiaofeiji-novel-flow-step9', SETTLE_ID],
  ];
  closeDb();
  initDb(':memory:');
  try {
    for (const [novelId, flowId, stepId, assetId] of cases) {
      db.createNovel(baseNovel(novelId, flowId, stepId));
      const flowStep = resolveProjectExecutionContract(novelId).flowStep;
      assert.ok(flowStep, `${stepId} 应有当前步骤快照`);
      assert.equal(flowStep?.capabilityRef?.assetId, assetId);
      assert.equal(flowStep?.capabilityWarning, undefined);
      // 可用性判定不变：工具卡正文真实可用 → asset（而非 guidance/unavailable）。
      assert.equal(flowStep?.availability, 'asset');
      assert.equal(flowStep?.guidanceOnly, false);
      assert.equal(flowStep?.stage, assetId === EXTRACT_ID ? 'planner' : 'critic');

      const template = PROMPT_GOVERNANCE_CATALOG.find((item) => item.id === assetId)?.template ?? '';
      assert.ok(template.length > 0, `${assetId} 应有真实正文`);
      assert.ok(flowStep?.prompt.includes('【流程步骤：'), `${stepId} 缺少步骤合同`);
      assert.ok(
        !flowStep?.prompt.includes(template),
        `${stepId} 工具卡正文泄漏进步骤 prompt（应只有步骤合同）`
      );
      assert.equal(flowStep?.stagePrompts, undefined, `${stepId} 不应挂卡片正文阶段文本`);

      const resolved = resolveWritingStyleRequest(novelId);
      for (const prompt of [
        resolved.executionSnapshot.stagePrompts.planner,
        resolved.executionSnapshot.stagePrompts.writer,
        resolved.executionSnapshot.stagePrompts.critic,
        resolved.plannerPrompt,
        resolved.writerPrompt,
        resolved.criticPrompt,
      ]) {
        assert.ok(!prompt.includes(template), `${stepId} 工具卡正文泄漏进三层写作提示`);
      }
    }
  } finally {
    closeDb();
  }
});

// ----------------------------------------------------------------- ④ 执行面

const XIGANG_FIXTURE = [
  '# 《测试》逐章细纲数据库',
  '',
  '### Ch001 · 立交桥下的尸体',
  '**核心事件**：左妄在桥下发现尸体。',
  '**伏笔埋点**：左妄手腕的淤痕与死者同源',
  '**回收章**：Ch005',
].join('\n');

function seedPack(novelId: string): void {
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
      JSON.stringify([{ filename: '逐章细纲.md', kind: 'outline', text: XIGANG_FIXTURE }]),
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

test('执行面：步骤声明的两张卡直接触发确定性动作，幂等且摘要可读', () => {
  const declaredIds = [
    ...new Set(
      SKILL_SERIES_FLOWS.flatMap((flow) => flow.steps)
        .map((step) => step.capabilityRef?.assetId)
        .filter((id): id is string => typeof id === 'string')
    ),
  ].sort();
  assert.deepEqual(declaredIds, [EXTRACT_ID, SETTLE_ID].sort());

  closeDb();
  initDb(':memory:');
  try {
    db.createNovel(
      baseNovel('cap-run', 'book-deconstruction-flow', 'book-deconstruction-flow-step3')
    );
    seedPack('cap-run');

    const first = runKnowledgeCapability('cap-run', EXTRACT_ID);
    assert.equal(first.kind, 'coverage');
    if (first.kind !== 'coverage') return;
    assert.equal(first.coverage.xigangEntries, 1);
    assert.equal(first.coverage.ledgerInserted, 1);

    const second = runKnowledgeCapability('cap-run', EXTRACT_ID);
    assert.equal(second.kind, 'coverage');
    if (second.kind !== 'coverage') return;
    assert.equal(second.coverage.ledgerInserted, 0, '重跑必须幂等（新增归零）');
    assert.deepEqual(second.coverage.coverage, first.coverage.coverage);

    const extractSummary = summarizeKnowledgeCapabilityResult(second);
    assert.ok(extractSummary.includes('细纲条目 1'), extractSummary);
    assert.ok(extractSummary.includes('图谱边 +'), extractSummary);
    assert.ok(extractSummary.includes('覆盖角色'), extractSummary);

    const settle = runKnowledgeCapability('cap-run', SETTLE_ID);
    assert.equal(settle.kind, 'checklist');
    if (settle.kind !== 'checklist') return;
    assert.ok(settle.checklist.openCount >= 1, '抽取出的伏笔应进入未回收清单');
    const settleSummary = summarizeKnowledgeCapabilityResult(settle);
    assert.ok(settleSummary.includes('未回收 '), settleSummary);
    assert.ok(settleSummary.includes('欠账 '), settleSummary);

    // 白名单之外的 id 必须被服务端拒绝（解析器 NO_KERNEL 守卫的现实依据）。
    assert.throws(
      () => runKnowledgeCapability('cap-run', 'other-tool'),
      (error: unknown) =>
        error instanceof KnowledgeCapabilityError &&
        error.code === 'KNOWLEDGE_CAPABILITY_UNSUPPORTED'
    );
  } finally {
    closeDb();
  }
});
