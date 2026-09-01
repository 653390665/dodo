import assert from 'node:assert/strict';
import test from 'node:test';
import { splitSceneBeats } from '../server/helpers/ai-production-pipeline';

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