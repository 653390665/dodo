import { describe, expect, test } from 'vitest';

import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';
import { buildCapabilityPreviewApplication } from '../lib/capability-preview-apply';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('capability transform preview application', () => {
  test('EditorView offsets structural ranges by the selected text start', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/EditorView.tsx'), 'utf8');
    expect(source).toContain('selectionOffset + relativeStart');
    expect(source).toContain('selectionOffset + relativeEnd');
  });
  test('replaces only the baseline selection when it is still current', () => {
    const content = '甲乙丙丁';
    const selection = { start: 1, end: 3 };
    const baselineHash = computeChapterWorkflowHash('乙丙', '分镜');
    expect(buildCapabilityPreviewApplication({ content, sceneBeats: '分镜', selection, baselineHash, preview: '新段' }))
      .toEqual({ ok: true, nextContent: '甲新段丁' });
  });

  test('rejects a stale preview without changing正文', () => {
    expect(buildCapabilityPreviewApplication({
      content: '已经变化', sceneBeats: '分镜', baselineHash: computeChapterWorkflowHash('旧正文', '分镜'), preview: '预览',
    })).toEqual({ ok: false, code: 'CAPABILITY_PREVIEW_STALE' });
  });

  test('rejects invalid selection ranges before applying a preview', () => {
    const baselineHash = computeChapterWorkflowHash('', '分镜');

    expect(buildCapabilityPreviewApplication({
      content: '甲乙丙丁', sceneBeats: '分镜', selection: { start: 2, end: 2 }, baselineHash, preview: '新段',
    })).toEqual({ ok: false, code: 'CAPABILITY_PREVIEW_INVALID_SELECTION' });
    expect(buildCapabilityPreviewApplication({
      content: '甲乙丙丁', sceneBeats: '分镜', selection: { start: -1, end: 2 }, baselineHash, preview: '新段',
    })).toEqual({ ok: false, code: 'CAPABILITY_PREVIEW_INVALID_SELECTION' });
    expect(buildCapabilityPreviewApplication({
      content: '甲乙丙丁', sceneBeats: '分镜', selection: { start: 1, end: 99 }, baselineHash, preview: '新段',
    })).toEqual({ ok: false, code: 'CAPABILITY_PREVIEW_INVALID_SELECTION' });
  });

  test('rejects no-op and empty whole-chapter previews', () => {
    expect(buildCapabilityPreviewApplication({
      content: '旧正文', sceneBeats: '分镜', baselineHash: computeChapterWorkflowHash('旧正文', '分镜'), preview: '旧正文',
    })).toEqual({ ok: false, code: 'CAPABILITY_PREVIEW_NO_CHANGES' });
    expect(buildCapabilityPreviewApplication({
      content: '旧正文', sceneBeats: '分镜', baselineHash: computeChapterWorkflowHash('旧正文', '分镜'), preview: '',
    })).toEqual({ ok: false, code: 'CAPABILITY_PREVIEW_EMPTY_CHAPTER' });
  });

  test('allows an empty preview only when replacing a selected filler span', () => {
    const content = '甲废话乙';
    const selection = { start: 1, end: 3 };
    expect(buildCapabilityPreviewApplication({
      content, sceneBeats: '分镜', selection, baselineHash: computeChapterWorkflowHash('废话', '分镜'), preview: '',
    })).toEqual({ ok: true, nextContent: '甲乙' });
  });

  test('rejects a preview that introduces prompt or metadata residue', () => {
    const content = '门外传来脚步，林舟按住门闩。';
    const selection = { start: 0, end: content.length };
    expect(buildCapabilityPreviewApplication({
      content,
      sceneBeats: '分镜',
      selection,
      baselineHash: computeChapterWorkflowHash(content, '分镜'),
      preview: '答案：这是修改后的正文。',
    })).toEqual({
      ok: false,
      code: 'CAPABILITY_PREVIEW_QUALITY_GATE_FAILED',
      violations: expect.arrayContaining(['正文包含问答或说明性残片']),
    });
  });

  test('does not allow a whole-chapter preview to collapse a complete chapter', () => {
    const content = Array.from({ length: 28 }, (_, index) => `第${index + 1}段雨声压过脚步，林舟沿着石阶继续向下，手里的铜铃贴着掌心发冷。`).join('\n\n');
    expect(buildCapabilityPreviewApplication({
      content,
      sceneBeats: '分镜',
      baselineHash: computeChapterWorkflowHash(content, '分镜'),
      preview: '林舟停在门边。',
    })).toEqual({
      ok: false,
      code: 'CAPABILITY_PREVIEW_QUALITY_GATE_FAILED',
      violations: expect.arrayContaining([expect.stringContaining('正文不足')]),
    });
  });
});
