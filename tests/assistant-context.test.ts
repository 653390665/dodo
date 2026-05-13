import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantSeedPrompt } from '../src/lib/assistant-context';
import type { AssistantLaunchContext } from '../src/types';

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
