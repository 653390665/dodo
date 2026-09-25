/**
 * 批次 B「步骤卡片槽位」测试（docs/specs/capability-flow-graph-consolidation.md §5.1）。
 *
 * ① 纯函数：优先级（cardRef > assetId）、空槽、五种槽位诊断、角色投影与「不一致仍注入」；
 * ② 集成：真实链路步骤挂卡 → 声明的每个阶段 prompt 命中卡片正文（planner / writer / critic 各一条用例）；
 *    未挂卡 / 槽位不可用 → 回退 assetId 路径（stagePrompts 缺省）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { resolveProjectExecutionContract, resolveWritingStyleRequest } from '../server/helpers/writing-style-service.js';
import { SKILL_SERIES_FLOWS, PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import {
  CAPABILITY_STAGES,
  renderFlowStepCardBlock,
  resolveFlowStepCard,
  type FlowStepCardDeps,
} from '../shared/lib/flow-step-card-slot.js';
import type { CapabilityKind, CapabilityManifestEntry } from '../shared/types/capability-manifest.js';
import type {
  FlowStepCardRef,
  GovernedPromptAsset,
  SkillSeriesFlowStep,
} from '../shared/types/prompt-assets-governed.js';
import type { Novel } from '../shared/types.js';

// ---------------------------------------------------------------------------
// 夹具（注入依赖，不触碰真实目录）
// ---------------------------------------------------------------------------

const CARD_TEMPLATE = '根据大纲设定，展开前三章，每章必须建立一个强烈钩子。';

const asset = (overrides: Partial<GovernedPromptAsset> = {}): GovernedPromptAsset =>
  ({
    id: 'card-x',
    title: '示例卡',
    stage: 'polish',
    template: CARD_TEMPLATE,
    primaryCategory: 'author-workflow',
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    isRuntimeReady: true,
    ...overrides,
  }) as unknown as GovernedPromptAsset;

const manifest = (
  kind: CapabilityKind,
  output: CapabilityManifestEntry['output'] = 'configuration'
): CapabilityManifestEntry =>
  ({
    id: 'card-x',
    version: '1',
    kind,
    stages: ['writer'],
    input: 'text',
    output,
    action: 'use-technique',
    allowedScopes: ['project'],
    sideEffect: 'configuration',
    runtimeStatus: 'active',
    sourceType: 'built-in',
  }) as unknown as CapabilityManifestEntry;

const deps = (
  assets: GovernedPromptAsset[],
  manifests: CapabilityManifestEntry[] = [],
  isRejectedTemplate?: FlowStepCardDeps['isRejectedTemplate']
): FlowStepCardDeps => ({
  findAsset: (id) => assets.find((item) => item.id === id),
  findManifest: (id) => manifests.find((item) => item.id === id),
  // 缺省不注入 → 走真实默认判定 isShellTemplatePrompt
  ...(isRejectedTemplate ? { isRejectedTemplate } : {}),
});

// ---------------------------------------------------------------------------
// ① 纯函数
// ---------------------------------------------------------------------------

test('阶段 canonical 顺序：planner → writer → critic', () => {
  assert.deepEqual([...CAPABILITY_STAGES], ['planner', 'writer', 'critic']);
});

test('未声明 cardRef → 回退 assetId 且无诊断', () => {
  const attempt = resolveFlowStepCard({}, deps([asset()]));
  assert.equal(attempt.resolution, null);
  assert.equal(attempt.warning, undefined);
});

test('空槽（声明了槽位但未挂卡）→ 回退 assetId，不产生诊断', () => {
  const refs: FlowStepCardRef[] = [
    { role: 'rule', stages: ['writer'] },
    { role: 'rule', stages: ['writer'], cardId: '' },
    { role: 'rule', stages: ['writer'], cardId: '   ' },
  ];
  for (const cardRef of refs) {
    const attempt = resolveFlowStepCard({ cardRef }, deps([asset()]));
    assert.equal(attempt.resolution, null, JSON.stringify(cardRef));
    assert.equal(attempt.warning, undefined, JSON.stringify(cardRef));
  }
});

test('stages 非法（空 / 未知值 / 重复）→ FLOW_STEP_CARD_STAGES_INVALID 并回退', () => {
  const invalid: unknown[] = [[], ['draft'], ['planner', 'planner'], ['writer', 'unknown']];
  for (const stages of invalid) {
    const attempt = resolveFlowStepCard(
      { cardRef: { role: 'rule', stages, cardId: 'card-x' } as unknown as FlowStepCardRef },
      deps([asset()])
    );
    assert.equal(attempt.resolution, null, JSON.stringify(stages));
    assert.equal(attempt.warning, 'FLOW_STEP_CARD_STAGES_INVALID', JSON.stringify(stages));
  }
});

test('卡片不在治理目录 → FLOW_STEP_CARD_UNRESOLVED 并回退', () => {
  const attempt = resolveFlowStepCard(
    { cardRef: { role: 'rule', stages: ['writer'], cardId: 'missing-card' } },
    deps([asset()])
  );
  assert.equal(attempt.resolution, null);
  assert.equal(attempt.warning, 'FLOW_STEP_CARD_UNRESOLVED');
});

test('非 runtime-ready（三项任一不满足）→ FLOW_STEP_CARD_NOT_RUNTIME_READY 并回退', () => {
  const variants = [
    asset({ isRuntimeReady: false }),
    asset({ runtimeStatus: 'candidate' }),
    asset({ sanitizationStatus: 'needs-sanitization' }),
  ];
  for (const variant of variants) {
    const attempt = resolveFlowStepCard(
      { cardRef: { role: 'rule', stages: ['writer'], cardId: 'card-x' } },
      deps([variant])
    );
    assert.equal(attempt.resolution, null);
    assert.equal(attempt.warning, 'FLOW_STEP_CARD_NOT_RUNTIME_READY');
  }
});

test('壳卡（默认 isShellTemplatePrompt）→ FLOW_STEP_CARD_SHELL 并回退', () => {
  const shell = asset({ template: '[书名简介体] 围绕爆款书名简介策划引擎执行' });
  const attempt = resolveFlowStepCard(
    { cardRef: { role: 'rule', stages: ['writer'], cardId: 'card-x' } },
    deps([shell]) // 不注入 isRejectedTemplate → 走默认 isShellTemplatePrompt
  );
  assert.equal(attempt.resolution, null);
  assert.equal(attempt.warning, 'FLOW_STEP_CARD_SHELL');
});

test('挂卡成功：stages 归一化（canonical 顺序 + 去重）、正文来自治理货架、无诊断', () => {
  const attempt = resolveFlowStepCard(
    { cardRef: { role: 'rule', stages: ['critic', 'planner', 'writer'], cardId: 'card-x' } },
    deps([asset()])
  );
  assert.ok(attempt.resolution);
  const card = attempt.resolution!;
  assert.deepEqual([...card.stages], ['planner', 'writer', 'critic']);
  assert.equal(card.prompt, CARD_TEMPLATE);
  assert.equal(card.role, 'rule');
  assert.equal(card.projectedRole, 'rule'); // primaryCategory=author-workflow
  assert.equal(card.warning, undefined);
  assert.equal(attempt.warning, undefined);
  assert.equal(
    renderFlowStepCardBlock(card, '【流程步骤：示例】'),
    `【流程步骤：示例】\n【步骤卡：card-x（rule）】\n${CARD_TEMPLATE}`
  );
});

test('角色投影：有 manifest 走 kind 投影；无 manifest 走治理分类投影', () => {
  const byManifest = resolveFlowStepCard(
    { cardRef: { role: 'transform', stages: ['writer'], cardId: 'card-x' } },
    deps([asset()], [manifest('technique', 'transform-preview')])
  );
  assert.equal(byManifest.resolution?.projectedRole, 'transform');
  assert.equal(byManifest.warning, undefined);

  const byCategory = resolveFlowStepCard(
    { cardRef: { role: 'guardrail', stages: ['writer'], cardId: 'card-x' } },
    deps([asset({ primaryCategory: 'quality-guardrail' })])
  );
  assert.equal(byCategory.resolution?.projectedRole, 'guardrail');
  assert.equal(byCategory.warning, undefined);
});

test('声明角色与投影不一致 → 仍注入，只记 FLOW_STEP_CARD_ROLE_MISMATCH', () => {
  const attempt = resolveFlowStepCard(
    { cardRef: { role: 'rule', stages: ['writer'], cardId: 'card-x' } },
    deps([asset()], [manifest('technique', 'transform-preview')])
  );
  assert.ok(attempt.resolution, '角色不一致不得阻断注入');
  assert.equal(attempt.resolution?.prompt, CARD_TEMPLATE);
  assert.equal(attempt.resolution?.projectedRole, 'transform');
  assert.equal(attempt.resolution?.warning, 'FLOW_STEP_CARD_ROLE_MISMATCH');
  assert.equal(attempt.warning, 'FLOW_STEP_CARD_ROLE_MISMATCH');
});

test('卡面正文不受壳判定误伤：注入自定义 isRejectedTemplate 也只拦壳', () => {
  const attempt = resolveFlowStepCard(
    { cardRef: { role: 'rule', stages: ['writer'], cardId: 'card-x' } },
    deps([asset()], [], (template) => template === '壳')
  );
  assert.ok(attempt.resolution);
  assert.equal(attempt.resolution?.prompt, CARD_TEMPLATE);
});

// ---------------------------------------------------------------------------
// ② 集成（真实目录 + 内存库）
// ---------------------------------------------------------------------------

const FLOW_ID = 'generic-novel-flow';
const STEP_ID = 'generic-novel-flow-step5'; // assetId=core-slop-shield（asset 阶段=writer）
const MOUNT_CARD_ID = 'plaza-golden-three';
const SHELL_CARD_ID = 'square-182';

/**
 * 卡片正文块（唯一可归因的命中特征）：`【步骤卡：ID（role）】` + 治理货架 template。
 * 不用裸 template 文本 ——  同一张卡的 template 可能经「推荐资产」等其它通道进入某些阶段 prompt。
 */
function mountCardBlock(): string {
  const entry = PROMPT_GOVERNANCE_CATALOG.find((item) => item.id === MOUNT_CARD_ID);
  assert.ok(entry, `${MOUNT_CARD_ID} must exist in governed catalog`);
  return `【步骤卡：${MOUNT_CARD_ID}（rule）】\n${entry!.template}`;
}

function baseNovel(tags: string[]): Novel {
  return {
    id: 'step-card-novel',
    title: 'Step Card Novel',
    authorId: 'author',
    summary: '',
    status: 'ongoing',
    projectPreferenceProfile: {
      tags,
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        activeFlowId: FLOW_ID,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: [],
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function step(): SkillSeriesFlowStep {
  const flow = SKILL_SERIES_FLOWS.find((item) => item.id === FLOW_ID);
  const found = flow?.steps.find((item) => item.id === STEP_ID);
  assert.ok(found, `${STEP_ID} must exist`);
  return found!;
}

function mountCard(cardRef: FlowStepCardRef | undefined): void {
  (step() as unknown as { cardRef?: FlowStepCardRef }).cardRef = cardRef;
}

function setupNovel(): void {
  closeDb();
  initDb(':memory:');
  db.createNovel(baseNovel([`current-step:${FLOW_ID}:${STEP_ID}`]));
}

test('集成：未挂卡（assetId-only）→ stagePrompts 缺省，三阶段与基线一致', () => {
  setupNovel();
  try {
    mountCard(undefined);
    const snapshot = resolveProjectExecutionContract('step-card-novel');
    assert.ok(snapshot.flowStep);
    assert.equal(snapshot.flowStep?.assetId, 'core-slop-shield');
    assert.equal(snapshot.flowStep?.stagePrompts, undefined);
    assert.equal(snapshot.flowStep?.cardId, undefined);
    assert.equal(snapshot.flowStep?.cardWarning, undefined);
    for (const stage of CAPABILITY_STAGES) {
      assert.doesNotMatch(snapshot.stagePrompts[stage], /展开前三章/, `${stage} 不得命中未挂卡卡面`);
    }
  } finally {
    mountCard(undefined);
    closeDb();
  }
});

test('集成：声明 planner 阶段 → 仅 planner prompt 命中卡片正文', () => {
  setupNovel();
  try {
    mountCard({ role: 'rule', stages: ['planner'], cardId: MOUNT_CARD_ID });
    const snapshot = resolveProjectExecutionContract('step-card-novel');
    assert.ok(snapshot.stagePrompts.planner.includes(mountCardBlock()), 'planner 命中卡片正文块');
    assert.ok(!snapshot.stagePrompts.writer.includes(mountCardBlock()), 'writer 不得命中未声明阶段的卡面');
    assert.ok(!snapshot.stagePrompts.critic.includes(mountCardBlock()), 'critic 不得命中未声明阶段的卡面');
  } finally {
    mountCard(undefined);
    closeDb();
  }
});

test('集成：声明 writer 阶段 → 仅 writer prompt 命中卡片正文', () => {
  setupNovel();
  try {
    mountCard({ role: 'rule', stages: ['writer'], cardId: MOUNT_CARD_ID });
    const snapshot = resolveProjectExecutionContract('step-card-novel');
    assert.ok(snapshot.stagePrompts.writer.includes(mountCardBlock()), 'writer 命中卡片正文块');
    assert.ok(!snapshot.stagePrompts.planner.includes(mountCardBlock()), 'planner 不得命中未声明阶段的卡面');
    assert.ok(!snapshot.stagePrompts.critic.includes(mountCardBlock()), 'critic 不得命中未声明阶段的卡面');
  } finally {
    mountCard(undefined);
    closeDb();
  }
});

test('集成：声明 critic 阶段 → 仅 critic prompt 命中卡片正文', () => {
  setupNovel();
  try {
    mountCard({ role: 'rule', stages: ['critic'], cardId: MOUNT_CARD_ID });
    const snapshot = resolveProjectExecutionContract('step-card-novel');
    assert.ok(snapshot.stagePrompts.critic.includes(mountCardBlock()), 'critic 命中卡片正文块');
    assert.ok(!snapshot.stagePrompts.planner.includes(mountCardBlock()), 'planner 不得命中未声明阶段的卡面');
    assert.ok(!snapshot.stagePrompts.writer.includes(mountCardBlock()), 'writer 不得命中未声明阶段的卡面');
  } finally {
    mountCard(undefined);
    closeDb();
  }
});

test('集成：三阶段全声明 → 卡片进快照元数据与 capabilityRefs', () => {
  setupNovel();
  try {
    mountCard({ role: 'rule', stages: ['planner', 'writer', 'critic'], cardId: MOUNT_CARD_ID });
    const snapshot = resolveProjectExecutionContract('step-card-novel');
    for (const stage of CAPABILITY_STAGES) {
      assert.ok(
        snapshot.stagePrompts[stage].includes(mountCardBlock()),
        `${stage} 命中卡片正文块`
      );
    }
    assert.equal(snapshot.flowStep?.cardId, MOUNT_CARD_ID);
    assert.equal(snapshot.flowStep?.cardRole, 'rule');
    assert.deepEqual([...(snapshot.flowStep?.cardStages ?? [])], ['planner', 'writer', 'critic']);
    assert.equal(snapshot.flowStep?.cardWarning, undefined);
    assert.ok(snapshot.capabilityRefs?.includes(MOUNT_CARD_ID));
    assert.equal(Object.isFrozen(snapshot.flowStep), true);
  } finally {
    mountCard(undefined);
    closeDb();
  }
});

test('集成：挂壳卡 → 回退 assetId 路径 + cardWarning 可见', () => {
  setupNovel();
  try {
    const before = resolveProjectExecutionContract('step-card-novel');
    mountCard({ role: 'rule', stages: ['planner', 'writer', 'critic'], cardId: SHELL_CARD_ID });
    const after = resolveProjectExecutionContract('step-card-novel');
    assert.equal(after.flowStep?.cardId, SHELL_CARD_ID);
    assert.equal(after.flowStep?.cardWarning, 'FLOW_STEP_CARD_SHELL');
    assert.equal(after.flowStep?.stagePrompts, undefined, '壳卡不得进阶段注入');
    assert.equal(after.stagePrompts.planner, before.stagePrompts.planner);
    assert.equal(after.stagePrompts.writer, before.stagePrompts.writer);
    assert.equal(after.stagePrompts.critic, before.stagePrompts.critic);
  } finally {
    mountCard(undefined);
    closeDb();
  }
});

test('集成：挂卡不改写作风格解析的其它面（writingStyle / stageSkills 保持可用）', () => {
  setupNovel();
  try {
    mountCard({ role: 'rule', stages: ['writer'], cardId: MOUNT_CARD_ID });
    const resolved = resolveWritingStyleRequest('step-card-novel');
    assert.ok(resolved.executionSnapshot.stagePrompts.writer.includes(mountCardBlock()));
    assert.ok(Array.isArray(resolved.candidates));
    assert.deepEqual(Object.keys(resolved.executionSnapshot.stageSkills).sort(), [
      'critic',
      'planner',
      'writer',
    ]);
  } finally {
    mountCard(undefined);
    closeDb();
  }
});
