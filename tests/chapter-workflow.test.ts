import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { computeChapterWorkflowHash } from '../shared/lib/chapter-workflow.js';

test('chapter workflow hash matches SHA-256 vectors and normalizes line endings', () => {
  const expected = (content: string, sceneBeats: string) => createHash('sha256').update(JSON.stringify({ content, sceneBeats })).digest('hex');
  assert.equal(computeChapterWorkflowHash('', ''), expected('', ''));
  assert.equal(computeChapterWorkflowHash('a\r\nb', 'x\r y'), expected('a\nb', 'x\n y'));
  assert.equal(computeChapterWorkflowHash('hello', 'scene'), expected('hello', 'scene'));
  assert.equal(computeChapterWorkflowHash('正文', '场景一：进入废墟'), expected('正文', '场景一：进入废墟'));
  assert.equal(computeChapterWorkflowHash('a\nb', 'x'), computeChapterWorkflowHash('a\r\nb', 'x'));
});

test('workflow hash changes when scene beats change', () => {
  assert.notEqual(computeChapterWorkflowHash('same', 'one'), computeChapterWorkflowHash('same', 'two'));
});
