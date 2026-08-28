import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantSeedPrompt } from '../src/lib/assistant-context';
import type { AssistantLaunchContext } from '../shared/types';

function makeContext(overrides: Partial<AssistantLaunchContext> = {}): AssistantLaunchContext {
  return {
    source: 'workspace',
    novelId: 'novel-1',
    novelTitle: '雨夜刀客',
    novelSummary: '一个被玄铁令牵连的年轻刀客卷入多方追杀。',
    chapterId: 'chapter-6',
    chapterTitle: '第六章 雨巷埋伏',
    sceneBeats: '主角发现埋伏；误判来敌；被迫借巷道反击。',
    currentExcerpt: '刀客在雨幕里停住脚步，听见瓦檐下有第二道呼吸。',
    selectedText: '听见瓦檐下有第二道呼吸。',
    intent: '帮我把这一段冲突升级，给三个不同推进方案。',
    ...overrides,
  };
}

test('buildAssistantSeedPrompt includes novel, chapter, and explicit user intent', () => {
  const prompt = buildAssistantSeedPrompt(makeContext());
  assert.match(prompt, /当前作品：雨夜刀客/);
  assert.match(prompt, /当前章节：第六章 雨巷埋伏/);
  assert.match(prompt, /用户目标：帮我把这一段冲突升级/);
});

test('buildAssistantSeedPrompt includes selected text when present', () => {
  const prompt = buildAssistantSeedPrompt(makeContext());
  assert.match(prompt, /选中文段：听见瓦檐下有第二道呼吸。/);
});

test('buildAssistantSeedPrompt falls back to chapter excerpt when no selection exists', () => {
  const prompt = buildAssistantSeedPrompt(
    makeContext({
      selectedText: '',
    }),
  );
  assert.doesNotMatch(prompt, /选中文段：/);
  assert.match(prompt, /当前片段：刀客在雨幕里停住脚步/);
});

test('assistant seed includes story memory dimensions and capability snapshot', () => {
  const prompt = buildAssistantSeedPrompt({
    source: 'editor', novelId: 'n1', novelTitle: '灯城',
    worldRules: '灯光不会自动熄灭', globalOutline: '主角追查城门后的失落城市',
    charactersContext: '林舟：调查者；当前目标是找到失踪者',
    foreshadowingsContext: '旧印记：只能提示，不得提前揭示身份',
    timelineContext: '第1章：城门亮灯', capabilitySnapshot: 'writer-card@3; critic-card@2',
  });

  assert.match(prompt, /世界规则：灯光不会自动熄灭/);
  assert.match(prompt, /全局大纲：主角追查城门后的失落城市/);
  assert.match(prompt, /关键人物：林舟/);
  assert.match(prompt, /开放伏笔：旧印记/);
  assert.match(prompt, /时间线：第1章/);
  assert.match(prompt, /能力快照：writer-card@3/);
});
