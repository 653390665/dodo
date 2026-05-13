import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantIdeaFragment } from '../src/lib/assistant-fragment';
import type { AssistantLaunchContext } from '../src/types';

function makeContext(overrides: Partial<AssistantLaunchContext> = {}): AssistantLaunchContext {
  return {
    source: 'workspace',
    novelId: 'novel-1',
    novelTitle: '雨夜刀客',
    chapterId: 'chapter-3',
    chapterTitle: '第三章 雨巷追逐',
    sceneBeats: '主角误入雨巷；敌人封路；短兵相接。',
    currentExcerpt: '他踩进积水时，听见身后有人拔刀。',
    intent: '给这一段追加一个更狠的追杀转折。',
    ...overrides,
  };
}

test('buildAssistantIdeaFragment defaults to scene type when launched from chapter workspace', () => {
  const fragment = buildAssistantIdeaFragment('敌人提前在巷口布下第二层伏兵。', makeContext());
  assert.equal(fragment.novelId, 'novel-1');
  assert.equal(fragment.type, 'scene');
  assert.equal(fragment.status, 'raw');
});

test('buildAssistantIdeaFragment uses world type when no chapter context exists', () => {
  const fragment = buildAssistantIdeaFragment(
    '这座城市的地下水道原本就是旧王朝的逃生网。',
    makeContext({
      chapterId: undefined,
      chapterTitle: undefined,
      sceneBeats: undefined,
      currentExcerpt: undefined,
    }),
  );
  assert.equal(fragment.type, 'world');
});
