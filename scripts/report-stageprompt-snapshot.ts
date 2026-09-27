/**
 * stagePrompts 快照（批次 A 不变量工具）：对三种装配场景抓取各阶段 prompt 的 sha256。
 * 用法：SNAPSHOT_OUT=/tmp/xxx.json node --import tsx scripts/report-stageprompt-snapshot.ts
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

process.env.INKFLOW_DB_PATH = `/tmp/inkflow-snapshot-${Date.now()}.db`;
process.env.NODE_ENV = 'test';

const { initDb } = await import('../server/lib/db-init.js');
const { closeDb, getDb } = await import('../server/lib/db-instance.js');
initDb();

const profile = (capabilityProfile: unknown) =>
  JSON.stringify({ capabilityModelVersion: 3, capabilityProfile });

/** 激活链路场景：activeFlowId + current-step 标签（assetId-only 步骤，用于回归 flowStep 注入路径）。 */
const flowProfile = (activeFlowId: string, currentStep: string) =>
  JSON.stringify({
    capabilityModelVersion: 3,
    capabilityProfile: { version: 3, activeFlowId },
    tags: [`current-step:${activeFlowId}:${currentStep}`],
  });

const scenarios: Array<[string, string | null]> = [
  ['bare', null],
  ['technique', profile({ version: 3, projectTechniqueIds: ['de-ai-slop-shield'] })],
  [
    'deck',
    profile({
      version: 3,
      projectSkillDeck: { mainCardId: 'deconstruct-suspense-hook', supportCardIds: [] },
    }),
  ],
  ['flow-shield', flowProfile('generic-novel-flow', 'generic-novel-flow-step5')],
  ['flow-outline', flowProfile('generic-novel-flow', 'generic-novel-flow-step1')],
  ['flow-square', flowProfile('xiaofeiji-novel-flow', 'xiaofeiji-novel-flow-step1')],
];

const now = Date.now();
const insert = getDb().prepare(
  'INSERT INTO novels (id, title, created_at, updated_at, project_preference_profile) VALUES (?,?,?,?,?)'
);
scenarios.forEach(([label], index) =>
  insert.run(`snap-${index}`, label, now, now, scenarios[index][1])
);

const { resolveProjectExecutionContract } = await import('../server/helpers/writing-style-service.js');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

type StageEntry = { sha256: string; length: number };
type FlowStepEntry = {
  currentStep: string;
  assetId: string;
  stage: string | null;
  warning?: string;
  promptSha256: string;
  promptLength: number;
};
type Snapshot = { stages: Record<string, StageEntry>; flowStep: FlowStepEntry | null };

const out: Record<string, Snapshot> = {};
for (const [index, [label]] of scenarios.entries()) {
  const snapshot = resolveProjectExecutionContract(`snap-${index}`);
  const stages: Record<string, StageEntry> = {};
  for (const stage of ['planner', 'writer', 'critic'] as const) {
    const text = snapshot.stagePrompts[stage];
    stages[stage] = { sha256: sha(text), length: text.length };
  }
  const step = snapshot.flowStep;
  out[label] = {
    stages,
    flowStep: step
      ? {
          currentStep: step.currentStep,
          assetId: step.assetId,
          stage: step.stage ?? null,
          warning: step.warning,
          promptSha256: sha(step.prompt),
          promptLength: step.prompt.length,
        }
      : null,
  };
}

const target = process.env.SNAPSHOT_OUT || '/tmp/stageprompts-snapshot.json';
writeFileSync(target, JSON.stringify(out, null, 2));
console.log('snapshot →', target);
for (const [label, entry] of Object.entries(out)) {
  console.log(
    label,
    Object.entries(entry.stages)
      .map(([stage, value]) => `${stage}:${value.sha256.slice(0, 8)}(${value.length})`)
      .join(' '),
    '| flowStep:',
    entry.flowStep
      ? `${entry.flowStep.assetId}@${entry.flowStep.stage ?? '-'}(${entry.flowStep.promptLength})${
          entry.flowStep.warning ? `!${entry.flowStep.warning}` : ''
        }`
      : '-'
  );
}
closeDb();
