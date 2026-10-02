import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LOCAL_REPAIR_TARGETS,
  applyLocalRepairs,
  compactTextLength,
  parseLocalRepairBatchResponse,
  residualP2Codes,
  selectLocalRepairTargets,
} from '../shared/lib/local-repair';

const TEXT = [
  '雨停了，屋檐还在滴水。',
  '那是一个极其简陋的黄色外卖界面。',
  '他数着步子往前走。',
  '那是一间非常简陋的临街铺面。',
].join('\n');

const SOFT_FINDING = [{ code: 'literary-slop', severity: 'P1' }];

test('locates a soft hit by snippet when the mechanical range is absent', () => {
  const selection = selectLocalRepairTargets({
    text: TEXT,
    findings: SOFT_FINDING,
    hits: [
      {
        category: 'tell_dont_show',
        line: 2,
        snippet: '极其简陋的黄色外卖界面',
        suggestion: '副词弱化「极其」',
      },
    ],
  });

  assert.equal(selection.repair, true);
  assert.equal(selection.targets.length, 1);
  const target = selection.targets[0];
  assert.equal(TEXT.slice(target.start, target.end), '那是一个极其简陋的黄色外卖界面。');
  assert.ok(target.before.includes('雨停了'));
  assert.ok(target.after.includes('他数着步子'));
  assert.equal(target.suggestion, '副词弱化「极其」');
  assert.equal(selection.skipped, 0);
});

test('expands a truncated mechanical hit to the enclosing sentence', () => {
  const selection = selectLocalRepairTargets({
    text: TEXT,
    findings: SOFT_FINDING,
    hits: [
      {
        category: 'tell_dont_show',
        line: 2,
        snippet: '极其简陋的黄色外',
        suggestion: '副词弱化「极其」',
      },
    ],
  });

  assert.equal(selection.repair, true);
  assert.equal(selection.targets.length, 1);
  const target = selection.targets[0];
  assert.equal(target.snippet, '那是一个极其简陋的黄色外卖界面。');
  assert.equal(TEXT.slice(target.start, target.end), target.snippet);

  const application = applyLocalRepairs(TEXT, [
    { start: target.start, end: target.end, text: '他推开门，油烟味先撞上来。' },
  ]);
  assert.equal(application.applied, 1);
  assert.equal(application.text.includes('极其简陋'), false);
  assert.equal(application.text.includes('外卖界面。'), false);
  assert.ok(application.text.includes('他推开门，油烟味先撞上来。'));
});

test('prefers the mechanical character range over snippet search', () => {
  const start = TEXT.indexOf('他数着步子');
  const selection = selectLocalRepairTargets({
    text: TEXT,
    findings: SOFT_FINDING,
    hits: [
      {
        category: 'style_slop',
        line: 3,
        snippet: '这句在正文里根本不存在',
        range: { start, end: start + 8 },
      },
    ],
  });

  assert.equal(selection.repair, true);
  assert.equal(TEXT.slice(selection.targets[0].start, selection.targets[0].end), '他数着步子往前走。');
});

test('refuses to repair structural hard defects', () => {
  const selection = selectLocalRepairTargets({
    text: TEXT,
    findings: [{ code: 'metadata-residue', severity: 'P1' }],
    hits: [{ category: 'tell_dont_show', line: 2, snippet: '极其简陋的黄色外卖界面' }],
  });

  assert.equal(selection.repair, false);
  assert.equal(selection.targets.length, 0);
  assert.equal(selection.reason, 'hard-defect:metadata-residue');
});

test('refuses when the draft is below the length contract', () => {
  const selection = selectLocalRepairTargets({
    text: TEXT,
    findings: SOFT_FINDING,
    hits: [{ category: 'tell_dont_show', line: 2, snippet: '极其简陋的黄色外卖界面' }],
    minChars: 4000,
  });

  assert.equal(selection.repair, false);
  assert.equal(selection.reason, 'below-contract');
});

test('reports no-localizable-hits when nothing can be located', () => {
  const selection = selectLocalRepairTargets({
    text: TEXT,
    findings: [{ code: 'literary-polish', severity: 'P2' }],
    hits: [{ category: 'ai_cliche', line: 9, snippet: '完全找不到的句子' }],
  });

  assert.equal(selection.repair, false);
  assert.equal(selection.reason, 'no-localizable-hits');
  assert.equal(selection.skipped, 1);
});

test('drops overlapping hits and caps the number of repaired sentences', () => {
  const overlapping = selectLocalRepairTargets({
    text: '甲乙丙丁戊己',
    findings: SOFT_FINDING,
    hits: [
      { category: 'tell_dont_show', line: 1, snippet: '甲乙丙丁' },
      { category: 'tell_dont_show', line: 1, snippet: '丙丁戊' },
    ],
  });
  assert.equal(overlapping.targets.length, 1);
  assert.equal(overlapping.skipped, 1);

  const many = Array.from({ length: MAX_LOCAL_REPAIR_TARGETS + 2 }, (_, index) => `第${index}句命中。`).join('\n');
  const capped = selectLocalRepairTargets({
    text: many,
    findings: SOFT_FINDING,
    hits: Array.from({ length: MAX_LOCAL_REPAIR_TARGETS + 2 }, (_, index) => ({
      category: 'tell_dont_show',
      line: index + 1,
      snippet: `第${index}句命中。`,
    })),
  });
  assert.equal(capped.targets.length, MAX_LOCAL_REPAIR_TARGETS);
  assert.equal(capped.skipped, 2);
});

test('applies repairs right-to-left and leaves the rest of the draft intact', () => {
  const original = '开头。甲句。中间。乙句。结尾。';
  const application = applyLocalRepairs(original, [
    { start: original.indexOf('甲句。'), end: original.indexOf('甲句。') + 3, text: '他推开门。' },
    { start: original.indexOf('乙句。'), end: original.indexOf('乙句。') + 3, text: '油烟先撞上来。' },
  ]);

  assert.equal(application.applied, 2);
  assert.equal(application.skipped, 0);
  assert.equal(application.text, '开头。他推开门。中间。油烟先撞上来。结尾。');
});

test('skips invalid, empty and runaway replacements', () => {
  const original = '一二三四五六七八九十';
  const application = applyLocalRepairs(original, [
    { start: 0, end: 2, text: '' },
    { start: 3, end: 3, text: 'x' },
    { start: 2, end: 4, text: 'x'.repeat(400) },
    { start: 4, end: 6, text: '真的' },
  ]);

  assert.equal(application.applied, 1);
  assert.equal(application.skipped, 3);
  assert.equal(application.text, '一二三四真的七八九十');
});

test('compactTextLength matches the gate char-count convention', () => {
  assert.equal(compactTextLength(' 一 二\n三 '), 3);
});
test('parses a marked batch repair response by slot and cleans decorations', () => {
  const raw = [
    '@@FIX 1@@',
    '他推开门，油烟味先撞上来。',
    '@@FIX 2@@',
    '```',
    '卷帘门半开着，灯泡忽明忽暗。',
    '```',
    '@@FIX 3@@',
    '替换后：站台上的钟停在某个凌晨。',
  ].join('\n');

  assert.deepEqual(parseLocalRepairBatchResponse(raw, 3), [
    '他推开门，油烟味先撞上来。',
    '卷帘门半开着，灯泡忽明忽暗。',
    '站台上的钟停在某个凌晨。',
  ]);
});

test('keeps slots empty when the batch response misses or misnumbers them', () => {
  assert.deepEqual(parseLocalRepairBatchResponse('', 2), ['', '']);
  assert.deepEqual(
    parseLocalRepairBatchResponse('@@FIX 1@@\n甲句。\n@@FIX 4@@\n丁句。', 2),
    ['甲句。', '']
  );
  // 只有一处时容忍模型漏掉标记（单句调用与批量调用的退化形态）。
  assert.deepEqual(parseLocalRepairBatchResponse('他停了一下。', 1), ['他停了一下。']);
  assert.deepEqual(parseLocalRepairBatchResponse('他停了一下。', 2), ['', '']);
});

test('lists the P2 residual codes left after a passing repair', () => {
  assert.deepEqual(
    residualP2Codes([
      { code: 'literary-polish', severity: 'P2' },
      { code: 'repeated-opening', severity: 'P2' },
      { code: 'repeated-opening', severity: 'P2' },
      { code: 'literary-slop', severity: 'P1' },
    ]),
    ['literary-polish', 'repeated-opening']
  );
  assert.deepEqual(residualP2Codes(undefined), []);
});

// Plan 277（R-276-1）：真机批量回执经常不带 @@FIX 标记——这里兼容两种退化版式。
const NEWLINE = String.fromCharCode(10);

test('accepts a slot response written as header blocks instead of @@FIX markers', () => {
  assert.deepEqual(
    parseLocalRepairBatchResponse(
      '【第 1 处】' + NEWLINE + '甲句。' + NEWLINE + NEWLINE + '【第 2 处】' + NEWLINE + '乙句。',
      2
    ),
    ['甲句。', '乙句。']
  );
  assert.deepEqual(
    parseLocalRepairBatchResponse(
      '【第 2 处】' + NEWLINE + '乙句。' + NEWLINE + '【第 1 处】' + NEWLINE + '甲句。',
      2
    ),
    ['甲句。', '乙句。']
  );
});

test('accepts a numbered-list slot response', () => {
  assert.deepEqual(
    parseLocalRepairBatchResponse('1. 甲句。' + NEWLINE + '2. 乙句。', 2),
    ['甲句。', '乙句。']
  );
  // 只回了一处时，另一个槽位仍留空串交给单句补齐。
  assert.deepEqual(parseLocalRepairBatchResponse('1. 甲句。', 2), ['甲句。', '']);
});
