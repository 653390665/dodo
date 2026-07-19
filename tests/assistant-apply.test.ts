import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAssistantTextToChapterContent,
  appendAssistantTextToSceneBeats,
  replaceAssistantTextInSelection,
} from '../src/lib/assistant-apply';

test('appendAssistantTextToChapterContent appends with blank line separation', () => {
  const result = appendAssistantTextToChapterContent(
    '第一段正文。',
    '第二段建议。',
  );
  assert.equal(result, '第一段正文。\n\n第二段建议。');
});

test('appendAssistantTextToChapterContent trims empty inputs', () => {
  const result = appendAssistantTextToChapterContent(
    '   ',
    '  第二段建议。  ',
  );
  assert.equal(result, '第二段建议。');
});

test('appendAssistantTextToSceneBeats prefixes a new bullet when needed', () => {
  const result = appendAssistantTextToSceneBeats(
    '主角发现埋伏',
    '敌人提前封锁退路',
  );
  assert.equal(result, '主角发现埋伏\n- 敌人提前封锁退路');
});

test('appendAssistantTextToSceneBeats keeps existing bullet text intact', () => {
  const result = appendAssistantTextToSceneBeats(
    '- 主角发现埋伏',
    '- 敌人提前封锁退路',
  );
  assert.equal(result, '- 主角发现埋伏\n- 敌人提前封锁退路');
});

test('replaceAssistantTextInSelection replaces the selected slice when bounds match', () => {
  const source = '雨夜里，他听见第二道呼吸，立刻停步。';
  const selectedText = '第二道呼吸';
  const start = source.indexOf(selectedText);
  const end = start + selectedText.length;
  const result = replaceAssistantTextInSelection(
    source,
    {
      start,
      end,
      selectedText,
    },
    '屋檐下第三个人的呼吸',
  );
  assert.equal(result, '雨夜里，他听见屋檐下第三个人的呼吸，立刻停步。');
});

test('replaceAssistantTextInSelection rejects stale bounds when selected text no longer matches', () => {
  assert.throws(
    () =>
      replaceAssistantTextInSelection(
        '雨夜里，他听见风声，立刻停步。',
        {
          start: 7,
          end: 15,
          selectedText: '第二道呼吸',
        },
        '屋檐下第三个人的呼吸',
      ),
    /Selection no longer matches current chapter content/,
  );
});
