import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlannerBeats, splitSceneBeats } from '../server/helpers/ai-production-pipeline';

test('splitSceneBeats splits structured beats into per-scene blocks', () => {
  const beats = [
    '### 场景 1：异动入场',
    '',
    '**入场钩子**：雨夜来人。',
    '**核心冲突**：初逢试探。',
    '',
    '### 场景 2：悬念收束',
    '',
    '**退场钩子**：身份成谜。',
  ].join('\n');
  const scenes = splitSceneBeats(beats);
  assert.equal(scenes.length, 2);
  assert.match(scenes[0], /^### 场景 1/);
  assert.match(scenes[1], /^### 场景 2/);
  assert.ok(scenes[0].includes('入场钩子'));
  assert.ok(scenes[1].includes('退场钩子'));
});

test('splitSceneBeats returns empty for unstructured beats', () => {
  assert.deepEqual(splitSceneBeats(''), []);
  assert.deepEqual(splitSceneBeats('自由文本分镜，没有结构化场景标题'), []);
  assert.deepEqual(splitSceneBeats('### 场景 1：只有一场'), []);
});

test('splitSceneBeats requires at least two scenes for split generation', () => {
  const beats = '前导说明\n\n### 场景 1：A\n内容\n\n### 场景 2：B\n内容\n\n### 场景 3：C\n内容';
  const scenes = splitSceneBeats(beats);
  assert.equal(scenes.length, 3);
  assert.match(scenes[0], /^### 场景 1：A/);
  assert.ok(!scenes[0].includes('前导说明'), 'leading prose is dropped');
});

// Plan 261 修复⑨：planner 携带的策划表格（节奏核验/伏笔清单/钩子选择）必须
// 在归一化时剥除——它们随最后一个场景块进入 writer prompt 会被整段抄进正文
// 尾部（run R fatalIssue#1：元数据残留强制 FAIL）。
test('normalizePlannerBeats strips planning sections and keeps scene blocks', () => {
  const beats = [
    '# 第二章场景分镜卡',
    '',
    '## 场景 1：桥墩淤痕',
    '',
    '**入场钩子**：赵桂芳攥着工牌。',
    '**退场钩子**：左妄说"我去"。',
    '',
    '## 场景 2：苏记赊账',
    '',
    '**核心冲突**：赊新账还是交代去处。',
    '',
    '## 本章节奏核验',
    '',
    '| 场景 | 节奏 | 核验 |',
    '| --- | --- | --- |',
    '| S1 | 慢起 | 通过 |',
    '',
    '## 规则伏笔清单',
    '',
    '- 淤痕：埋设',
    '',
    '## 章末钩子选择（二选一）',
    '',
    '**推荐A**——信息量更大',
    '**推荐B**——更克制',
  ].join('\n');
  const normalized = normalizePlannerBeats(beats);
  assert.ok(normalized.includes('场景 1：桥墩淤痕'), 'scene 1 kept');
  assert.ok(normalized.includes('场景 2：苏记赊账'), 'scene 2 kept');
  assert.ok(normalized.includes('入场钩子'), 'scene field lines kept');
  assert.ok(!normalized.includes('节奏核验'), 'planning table stripped');
  assert.ok(!normalized.includes('伏笔清单'), 'foreshadow ledger stripped');
  assert.ok(!normalized.includes('钩子选择'), 'hook options stripped');
  assert.ok(!normalized.includes('推荐A'), 'option rows stripped');
  assert.ok(!normalized.includes('第二章场景分镜卡'), 'non-scene title stripped');
  // 剥除后分场景通道可用
  assert.equal(splitSceneBeats(normalized).length, 2);
});

test('normalizePlannerBeats renumbers placeholder scenes and strips char budgets', () => {
  const beats = [
    '### 场景 N：案发现场（不超过 8 字）',
    '',
    '**出场人物**（≤20字）：左妄、赵桂芳',
    '',
    '### 场景 N：苏记欠条（不超过 8 字）',
    '',
    '**核心冲突**（≤40字）：赊账博弈',
  ].join('\n');
  const normalized = normalizePlannerBeats(beats);
  assert.ok(normalized.includes('### 场景 1：案发现场'), 'placeholder N renumbered');
  assert.ok(normalized.includes('### 场景 2：苏记欠条'), 'second placeholder renumbered');
  assert.ok(!normalized.includes('≤20字'), 'char budgets stripped');
  assert.ok(!normalized.includes('不超过 8 字'), 'char budgets stripped (long form)');
});