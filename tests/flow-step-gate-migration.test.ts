/**
 * Plan 262 C2「双门合一」守卫：旧 `qualityGate: string` 字段整体删除，
 * 文本门迁移为 `gate.kind='advisory'`（不拦截），可判定门保留 `mechanical` / `critic`。
 *
 * 单一事实源：
 * - 提示词 `【质量门】` 行 → `flowStepGatePromptText(gate)`（server 侧唯一出口）；
 * - 界面展示 → `flowStepGateDisplay(gate)`；
 * - 判定 → `evaluateFlowStepGate`（advisory = pass + 警告，不拦截）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKILL_SERIES_FLOWS } from '../shared/lib/prompt-governance-catalog.js';
import {
  FLOW_STEP_GATE_KINDS,
  FLOW_STEP_GATE_KIND_LABELS,
  evaluateFlowStepGate,
  flowStepGateDisplay,
  flowStepGatePromptText,
} from '../shared/lib/flow-step-gate.js';

const STEPS = SKILL_SERIES_FLOWS.flatMap((flow) =>
  flow.steps.map((step) => ({ flowId: flow.id, step }))
);

test('目录 34 步全部带 gate（含 note），旧 qualityGate 字段清零', () => {
  assert.equal(STEPS.length, 34);
  const kinds: Record<string, number> = {};
  for (const { step } of STEPS) {
    assert.ok(step.gate, `${step.id} 缺 gate`);
    assert.ok((step.gate?.note || '').trim().length > 0, `${step.id} 缺 gate.note`);
    assert.ok(
      (FLOW_STEP_GATE_KINDS as readonly string[]).includes(String(step.gate?.kind)),
      `${step.id} gate.kind 非法：${String(step.gate?.kind)}`
    );
    assert.ok(!('qualityGate' in step), `${step.id} 仍带旧 qualityGate 字段`);
    kinds[String(step.gate?.kind)] = (kinds[String(step.gate?.kind)] || 0) + 1;
  }
  assert.deepEqual(kinds, { advisory: 32, mechanical: 1, critic: 1 });
});

test('提示词与界面文案同源（gate.note 是唯一文案）', () => {
  const step = STEPS.find((s) => s.step.id === 'xiaofeiji-novel-flow-step1')?.step;
  assert.ok(step?.gate);
  assert.equal(flowStepGatePromptText(step?.gate), step?.gate?.note);
  assert.equal(flowStepGatePromptText(step?.gate), '脑洞概念成型且具备初始爽点');
  const display = flowStepGateDisplay(step?.gate);
  assert.equal(display.text, step?.gate?.note);
  assert.equal(display.advisory, true);
  assert.equal(display.intercepting, false);
  assert.equal(display.kindLabel, FLOW_STEP_GATE_KIND_LABELS.advisory);

  const criticGate = STEPS.find((s) => s.step.id === 'generic-novel-flow-step6')?.step.gate;
  assert.equal(criticGate?.kind, 'critic');
  assert.equal(criticGate?.threshold, 80);
  // mechanical/critic 门带 note 时提示词仍走 note（旧文案逐字保留）
  assert.equal(flowStepGatePromptText(criticGate), '基础文本去AI腔完成，语流顺畅');
  assert.equal(flowStepGateDisplay(criticGate).intercepting, true);
});

test('advisory 门不拦截推进：pass + ADVISORY 警告（阈值被忽略并记录）', () => {
  const plain = evaluateFlowStepGate({ gate: { kind: 'advisory', note: '文本验收' } });
  assert.equal(plain.status, 'pass');
  assert.equal(plain.kind, 'advisory');
  assert.deepEqual(plain.reasons, []);
  assert.ok(plain.warnings.includes('FLOW_STEP_GATE_ADVISORY'));

  const withThreshold = evaluateFlowStepGate({
    gate: { kind: 'advisory', threshold: 5, note: '文本验收' },
  });
  assert.equal(withThreshold.status, 'pass');
  assert.ok(withThreshold.warnings.includes('FLOW_STEP_GATE_THRESHOLD_IGNORED'));

  // 空草稿也不拦（文本门不吃草稿/审稿证据）
  const blank = evaluateFlowStepGate({ gate: { kind: 'advisory', note: 'x' }, draftText: '' });
  assert.equal(blank.status, 'pass');
});

test('gate 类型常量与标签表一一对应（含 advisory）', () => {
  for (const kind of FLOW_STEP_GATE_KINDS) {
    assert.ok(FLOW_STEP_GATE_KIND_LABELS[kind], `缺 label：${kind}`);
  }
  assert.deepEqual(
    [...FLOW_STEP_GATE_KINDS].sort(),
    Object.keys(FLOW_STEP_GATE_KIND_LABELS).sort()
  );
  // 未声明 gate：显式不判定，且不产生拦截
  assert.equal(flowStepGatePromptText(null), '未声明质量门（不判定）');
  const undeclared = evaluateFlowStepGate({});
  assert.equal(undeclared.status, 'pass');
  assert.ok(undeclared.warnings.includes('FLOW_STEP_GATE_UNDECLARED'));
  assert.equal(flowStepGateDisplay(null).kindLabel, '未声明');
});

/** 剥离行注释与块注释：文档注释里说明历史字段名不算引用。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('源码与生成物中不再出现旧 qualityGate 字段', () => {
  const files = [
    'shared/lib/prompt-governance-catalog.ts',
    'shared/lib/public-skill-catalog.ts',
    'shared/types/prompt-assets-governed.ts',
    'shared/types/capability-execution.ts',
    'shared/lib/flow-step-gate.ts',
    'server/helpers/writing-style-service.ts',
    'src/components/book-factory/PlanningTab.tsx',
    'src/components/SkillsStudioView.tsx',
  ];
  for (const rel of files) {
    const raw = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
    const text = rel.endsWith('.ts') ? stripComments(raw) : raw;
    assert.ok(!text.includes('qualityGate'), `${rel} 仍引用旧字段 qualityGate`);
  }
});
