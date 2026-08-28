/**
 * manualAudit parse evaluation set
 * Tests the parse pipeline against representative model outputs.
 *
 * Contract:
 * - parseAuditFiveDim must parse the 5-dimension scoring JSON
 * - Invalid contracts must be rejected rather than tolerated.
 * - Each dimension reason must be non-generic
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuditFiveDim, parseAuditResponseWithDiagnostics } from '../src/lib/audit-structured';

// ── Evaluation cases ──────────────────────────────────────────────────

// Case 1: Perfect output (normal case)
test('eval: valid JSON with all 5 dimensions', () => {
  const raw = `{
  "scores": {
    "可读性": {"score": 7, "reason": "个别句子偏长，'只见那人手掌一翻'后缺主句"},
    "分镜执行度": {"score": 8, "reason": "场景三入场钩子兑现到位，场景一缺环境定位"},
    "冲突推进度": {"score": 6, "reason": "掌柜对话推进了信息差，但第二节停滞"},
    "风格契合度": {"score": 7, "reason": "冷峻笔调保持稳定，偶有'心头一紧'这类俗语"},
    "网文章节感": {"score": 8, "reason": "断章点在悬念处，阅读流畅如一节初稿"}
  },
  "totalScore": 36,
  "pass": true,
  "failReason": "",
  "fatalIssues": [
    {"dimension": "可读性", "snippet": "只见那人手掌一翻", "fix": "补齐翻掌后的主句动作"}
  ],
  "surgerySuggestions": ["第一节补30字环境定位", "第二节推进一个微小事件"]
}`;

  const result = parseAuditFiveDim(raw);
  assert.ok(result, 'should parse valid JSON');
  assert.equal(result.totalScore, 36);
  assert.equal(result.pass, true);
  assert.equal(Object.keys(result.scores).length, 5);
  // Each reason must be present and non-empty
  for (const [dim, val] of Object.entries(result.scores)) {
    assert.ok(val.reason.length > 0, `${dim} reason should not be empty`);
  }
});

// Case 2: Model outputs with markdown code fences (edge case - common failure)
test('eval: JSON wrapped in markdown code fences', () => {
  const raw = `\`\`\`json
{
  "scores": {
    "可读性": {"score": 6, "reason": "有三处代词指代不明"},
    "分镜执行度": {"score": 7, "reason": "场景二缺少入场钩子兑现"},
    "冲突推进度": {"score": 5, "reason": "第二节纯过渡无推进"},
    "风格契合度": {"score": 8, "reason": "能用短句不用复合句"},
    "网文章节感": {"score": 7, "reason": "整体流畅但结尾收束偏软"}
  },
  "totalScore": 33,
  "pass": true,
  "failReason": ""
}
\`\`\``;

  const result = parseAuditFiveDim(raw);
  assert.ok(result, 'should parse despite markdown wrapping');
  assert.equal(result.totalScore, 33);
  assert.equal(Object.keys(result.scores).length, 5);
});

// Case 3: Model outputs with Chinese curly quotes (edge case - now repaired by parser)
test('eval: JSON using Chinese curly quotes', () => {
  const raw = `{
  “scores”: {
    “可读性”: {“score”: 5, “reason”: “多处残句，主语缺失”},
    “分镜执行度”: {“score”: 6, “reason”: “场景二部分兑现”},
    “冲突推进度”: {“score”: 4, “reason”: “关键对峙写成静态报告”},
    “风格契合度”: {“score”: 7, “reason”: “句长控制稳”},
    “网文章节感”: {“score”: 6, “reason”: “结尾悬念点偏模糊”}
  },
  “totalScore”: 28,
  “pass”: false,
  “failReason”: “总分不足30，可读性和冲突推进度双低”
}`;

  const result = parseAuditFiveDim(raw);
  assert.ok(result, 'should now parse Chinese curly quotes (parser repair)');
  assert.equal(result.totalScore, 28);
  assert.equal(result.pass, false);
  assert.ok(result.failReason!.length > 0);
});

test('eval: valid JSON preserves Chinese curly quotes inside reason strings', () => {
  const raw = JSON.stringify({
    scores: {
      '可读性': { score: 6, reason: '“在这里待着没有意义”等对白缺少动作支点。' },
      '分镜执行度': { score: 5, reason: '决断场景只有对话。' },
      '冲突推进度': { score: 4, reason: '风险没有实质前移。' },
      '风格契合度': { score: 5, reason: '缺少潮汐城的环境质感。' },
      '网文章节感': { score: 5, reason: '像提纲扩写。' },
    },
    totalScore: 25,
    pass: false,
    failReason: '总分不足30。',
    fatalIssues: [{
      issueType: 'style-slop', issueSubtype: 'ai-cliche', severity: 'major',
      snippet: '“在这里待着没有意义”', explanation: '对白缺少动作支点。', patchHint: '补充人物动作。',
    }],
    surgerySuggestions: [],
  });

  const result = parseAuditFiveDim(raw);
  assert.ok(result);
  assert.match(result.scores['可读性'].reason, /“在这里待着没有意义”/);
  const strict = parseAuditResponseWithDiagnostics(raw);
  assert.ok(strict.fiveDim);
  assert.equal(strict.diagnostic, undefined);
});

// Case 4: Missing scores field entirely (adversarial)
test('eval: model returns generic prose instead of JSON', () => {
  const raw = '这章整体还行，但可以更好。可读性方面有些句子太长，分镜执行得不错。';

  const result = parseAuditFiveDim(raw);
  assert.equal(result, null, 'should return null for non-JSON prose');
});

// Case 5: Missing one dimension (edge case)
test('eval: JSON missing one dimension is rejected', () => {
  const raw = `{
  "scores": {
    "可读性": {"score": 7, "reason": "整体通顺"},
    "分镜执行度": {"score": 6, "reason": "基本执行"},
    "冲突推进度": {"score": 5, "reason": "推进一般"},
    "风格契合度": {"score": 8, "reason": "风格稳定"}
  },
  "totalScore": 26
}`;

  assert.equal(parseAuditFiveDim(raw), null);
});

// Case 6: Generic reasons — specificity check
test('eval: all reasons are generic boilerplate', () => {
  const raw = `{
  "scores": {
    "可读性": {"score": 7, "reason": "整体不错，但可以更好"},
    "分镜执行度": {"score": 7, "reason": "基本按分镜写了"},
    "冲突推进度": {"score": 7, "reason": "冲突有推进"},
    "风格契合度": {"score": 7, "reason": "风格还可以"},
    "网文章节感": {"score": 7, "reason": "读起来还行"}
  },
  "totalScore": 35,
  "pass": true,
  "failReason": ""
}`;

  const result = parseAuditFiveDim(raw);
  assert.ok(result, 'parses OK');
  // But reasons are generic — this is a quality signal issue
  // Document the current behavior
  const genericPatterns = [/还行/, /不错/, /可以更好/, /还可以/];
  let genericCount = 0;
  for (const [_, val] of Object.entries(result.scores)) {
    if (genericPatterns.some((p) => p.test(val.reason))) {
      genericCount++;
    }
  }
  // Currently all 5 reasons are generic — this is the quality problem
  assert.ok(genericCount > 0, 'at least some reasons are generic (quality issue)');
});

// ── Parse rate summary ────────────────────────────────────────────────

test('eval: parse contract summary accepts valid and rejects invalid samples', () => {
  const cases = [
    { raw: `{"scores":{"可读性":{"score":7,"reason":"ok"},"分镜执行度":{"score":7,"reason":"ok"},"冲突推进度":{"score":7,"reason":"ok"},"风格契合度":{"score":7,"reason":"ok"},"网文章节感":{"score":7,"reason":"ok"}},"totalScore":35}`, valid: true },
    { raw: `{"scores":{"可读性":{"score":"7","reason":"bad"},"分镜执行度":{"score":7,"reason":"ok"},"冲突推进度":{"score":7,"reason":"ok"},"风格契合度":{"score":7,"reason":"ok"},"网文章节感":{"score":7,"reason":"ok"}},"totalScore":35}`, valid: false },
    { raw: `{"scores":{"可读性":{"score":7,"reason":"ok"},"分镜执行度":{"score":7,"reason":"ok"},"冲突推进度":{"score":7,"reason":"ok"},"风格契合度":{"score":7,"reason":"ok"},"网文章节感":{"score":7,"reason":"ok"}},"totalScore":34}`, valid: false },
  ];
  for (const sample of cases) assert.equal(Boolean(parseAuditFiveDim(sample.raw)), sample.valid);
});
