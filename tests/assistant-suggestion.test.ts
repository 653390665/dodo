import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAssistantSuggestion,
  getPrimaryAssistantAction,
} from '../src/lib/assistant-suggestion';
import type { AssistantLaunchContext } from '../src/types';

function makeContext(overrides: Partial<AssistantLaunchContext> = {}): AssistantLaunchContext {
  return {
    source: 'workspace',
    novelId: 'novel-1',
    novelTitle: '雨夜刀客',
    chapterId: 'chapter-5',
    chapterTitle: '第五章 酒馆试探',
    sceneBeats: '入馆；试探；爆发',
    currentExcerpt: '他握住刀柄，没有立刻出手。',
    ...overrides,
  };
}

test('classifyAssistantSuggestion returns scene-beat for bullet-heavy outlines', () => {
  const kind = classifyAssistantSuggestion('- 主角假装退让\n- 掌柜故意泄露假消息\n- 门外埋伏开始收口', makeContext());
  assert.equal(kind, 'scene-beat');
});

test('classifyAssistantSuggestion returns setting for structured entity text', () => {
  const kind = classifyAssistantSuggestion('角色：顾迟\n身份：酒馆掌柜\n特点：表面圆滑，实际替旧主观察江湖动向。', makeContext());
  assert.equal(kind, 'setting');
});

test('classifyAssistantSuggestion returns prose for full narrative paragraph', () => {
  const kind = classifyAssistantSuggestion('他故意把刀放慢了半寸，让对方误以为自己露了破绽，随后借着桌角反弹的力道斜切出去。', makeContext());
  assert.equal(kind, 'prose');
});

test('getPrimaryAssistantAction prefers selection replacement for prose when user launched from selected text', () => {
  const action = getPrimaryAssistantAction(
    'prose',
    makeContext({
      selectedText: '他握住刀柄，没有立刻出手。',
      selectionStart: 0,
      selectionEnd: 13,
    }),
  );
  assert.equal(action, 'replace-selection');
});

test('getPrimaryAssistantAction uses save-fragment for fragment-like suggestions', () => {
  const action = getPrimaryAssistantAction('fragment', makeContext());
  assert.equal(action, 'save-fragment');
});
