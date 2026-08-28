import test from 'node:test';
import assert from 'node:assert/strict';
import {
  embedStructuredAudit,
  evaluateAuditGate,
  extractStructuredAudit,
  parseStructuredAuditResponse,
  renderStructuredAuditMarkdown,
  renderFiveDimMarkdown,
  parseAuditFiveDim,
  stripEmbeddedStructuredAudit,
  convertFiveDimToStructured,
  diagnoseAuditContract,
  parseAuditResponseWithDiagnostics,
  AuditScores,
} from '../src/lib/audit-structured';
import { buildAuditWindow } from '../server/helpers/prompt-helpers';
import { extractPolishTargetsFromCritique, selectRewriteTargetsForPatch } from '../src/lib/chapter-polish';

test('structured audit roundtrip preserves exact issue metadata', () => {
  const raw = JSON.stringify({
    score: 82,
    fatalIssues: [
      {
        issueType: 'dialogue-logic',
        issueSubtype: 'dialogue-abrupt-info',
        severity: 'critical',
        snippet: '“三……三天。”',
        explanation: '半截信息突然冒出，读者接不住。',
        patchHint: '在前文补一个追问。',
      },
    ],
    sceneChecks: [
      { scene: '场景三：掌柜露破绽', status: 'weak', note: '关键信息落点偏突兀。' },
    ],
    surgerySuggestions: ['先补前因，再保留“三天”的迟疑感。'],
  });

  const structured = parseStructuredAuditResponse(raw);
  assert.ok(structured);
  const markdown = renderStructuredAuditMarkdown(structured!);
  const embedded = embedStructuredAudit(markdown, structured!);
  const extracted = extractStructuredAudit(embedded);

  assert.deepEqual(extracted, structured);
});

test('structured evidence supports all five frozen categories through parse and markdown roundtrip', () => {
  const categories = ['hard_canon', 'character_state', 'scene_execution', 'pacing', 'foreshadowing'] as const;
  const raw = JSON.stringify({
    score: 76,
    fatalIssues: [],
    sceneChecks: [],
    surgerySuggestions: [],
    evidence: categories.map((category, index) => ({
      category,
      severity: index % 2 === 0 ? 'high' : 'medium',
      quote: `证据原文 ${category}`,
      explanation: `解释 ${category}`,
      suggestedFix: `修复 ${category}`,
      location: `第${index + 1}段`,
    })),
  });

  const parsed = parseStructuredAuditResponse(raw);
  assert.ok(parsed);
  assert.deepEqual(parsed?.evidence?.map((item) => item.category), categories);

  const extracted = extractStructuredAudit(embedStructuredAudit(renderStructuredAuditMarkdown(parsed!), parsed!));
  assert.deepEqual(extracted?.evidence, parsed?.evidence);
});

test('structured evidence filters unknown categories, empty quotes, and missing required fields', () => {
  const parsed = parseStructuredAuditResponse(JSON.stringify({
    score: 60,
    fatalIssues: [],
    sceneChecks: [],
    surgerySuggestions: [],
    evidence: [
      { category: 'unknown', severity: 'high', quote: 'x', explanation: 'e', suggestedFix: 'f' },
      { category: 'pacing', severity: 'high', quote: '   ', explanation: 'e', suggestedFix: 'f' },
      { category: 'pacing', severity: 'high', quote: 'x', explanation: '', suggestedFix: 'f' },
      { category: 'pacing', severity: 'high', quote: 'x', explanation: 'e' },
      { category: 'pacing', severity: 'high', quote: '保留项', explanation: '解释', suggestedFix: '修复' },
    ],
  }));

  assert.deepEqual(parsed?.evidence, [{
    category: 'pacing', severity: 'high', quote: '保留项', explanation: '解释', suggestedFix: '修复',
  }]);
});

test('legacy structured audit payload remains compatible with empty evidence', () => {
  const parsed = parseStructuredAuditResponse(JSON.stringify({
    score: 71,
    fatalIssues: [],
    sceneChecks: [],
    surgerySuggestions: ['保留旧报告'],
  }));
  assert.ok(parsed);
  assert.deepEqual(parsed?.evidence, []);
});

test('chapter polish prefers structured audit snippets over markdown inference', () => {
  const raw = JSON.stringify({
    score: 82,
    fatalIssues: [
      {
        issueType: 'duplicate',
        issueSubtype: 'duplicate-rupture',
        severity: 'critical',
        snippet: '掌柜的脸色刷地白了一层。',
        explanation: '重复导致节奏断裂。',
        patchHint: '保留第一次，删除后续重复。',
      },
      {
        issueType: 'dialogue-logic',
        issueSubtype: 'dialogue-abrupt-info',
        severity: 'major',
        snippet: '“三……三天。”',
        explanation: '信息突兀。',
        patchHint: '补上前因追问。',
      },
    ],
    sceneChecks: [],
    surgerySuggestions: ['补前因。'],
  });

  const structured = parseStructuredAuditResponse(raw)!;
  const critique = embedStructuredAudit(renderStructuredAuditMarkdown(structured), structured);
  const targets = extractPolishTargetsFromCritique(critique);

  assert.deepEqual(targets.duplicateTargets, ['掌柜的脸色刷地白了一层。']);
  assert.deepEqual(targets.rewriteTargets, ['“三……三天。”']);

  const selected = selectRewriteTargetsForPatch(
    '掌柜的脸色刷地白了一层。\n\n“三……三天。”声音几乎是贴着桌面传过来的。',
    targets.rewriteTargets,
    3,
    critique,
  );
  assert.equal(selected[0]?.issueType, 'dialogue-logic');
  assert.equal(selected[0]?.issueSubtype, 'dialogue-abrupt-info');
});

test('structured audit parser repairs unescaped inner quotes in snippets', () => {
  const raw = `{
    "score": 2,
    "fatalIssues": [
      {
        "issueType": "duplicate",
        "issueSubtype": "duplicate-rupture",
        "severity": "critical",
        "snippet": "主角问"那您腰间那串钥匙，开的是什么？"掌柜回答"地窖、柴房、杂物间。"",
        "explanation": "问答链出现未转义引号，但整体仍应被服务端修复并解析。",
        "patchHint": "保留原意，后续统一转成可读报告。"
      }
    ],
    "sceneChecks": [],
    "surgerySuggestions": ["修复 JSON 字符串中的内层引号。"]
  }`;

  const structured = parseStructuredAuditResponse(raw);
  assert.ok(structured);
  assert.equal(structured?.fatalIssues[0]?.issueType, 'duplicate');
  assert.match(structured?.fatalIssues[0]?.snippet || '', /那您腰间那串钥匙/);
});

test('strict audit response diagnostics accept prefixes, fences and reasoning blocks', () => {
  const payload = JSON.stringify({
    scores: {
      '可读性': { score: 8, reason: '清楚' }, '分镜执行度': { score: 8, reason: '完整' },
      '冲突推进度': { score: 8, reason: '前移' }, '风格契合度': { score: 8, reason: '稳定' }, '网文章节感': { score: 8, reason: '有钩子' },
    },
    totalScore: 40, pass: true, fatalIssues: [], surgerySuggestions: [],
  });
  for (const raw of [`说明文字\n${payload}`, `说明\n\`\`\`json\n${payload}\n\`\`\``, `<think>内部分析</think>前置说明\n${payload}`]) {
    const parsed = parseAuditResponseWithDiagnostics(raw);
    assert.ok(parsed.fiveDim);
    assert.equal(parsed.diagnostic, undefined);
  }
});

test('strict audit response diagnostics classify truncation, plain text and filtered issues', () => {
  const base = {
    scores: {
      '可读性': { score: 2, reason: '残句' }, '分镜执行度': { score: 2, reason: '未执行' },
      '冲突推进度': { score: 2, reason: '无推进' }, '风格契合度': { score: 2, reason: '偏离' }, '网文章节感': { score: 2, reason: '失败' },
    },
    totalScore: 10, pass: false, fatalIssues: [], surgerySuggestions: [],
  };
  assert.equal(parseAuditResponseWithDiagnostics(JSON.stringify(base).slice(0, -2)).diagnostic?.code, 'truncated');
  assert.equal(parseAuditResponseWithDiagnostics('模型只返回了一段说明').diagnostic?.code, 'plain_text');
  assert.equal(parseAuditResponseWithDiagnostics(JSON.stringify({ ...base, fatalIssues: [{ snippet: 'x' }] })).diagnostic?.code, 'filtered_fatal_issue');
});

test('audit window keeps opening, middle and ending with source position labels', () => {
  const chapter = `${'开头线索。'.repeat(500)}${'中段冲突。'.repeat(500)}${'章末钩子与最后场景。'.repeat(500)}`;
  const window = buildAuditWindow(chapter, 3000);
  assert.ok(window.length > 0 && window.length < 3600);
  assert.match(window, /审稿窗口 opening chars=0-/);
  assert.match(window, /审稿窗口 middle chars=/);
  assert.match(window, /审稿窗口 ending chars=/);
  assert.match(window, /章末钩子与最后场景/);
});

// ── Audit Gate tests ────────────────────────────────────────────────

test('evaluateAuditGate passes clean audit', () => {
  const result = evaluateAuditGate(
    { '可读性': 8, '分镜执行度': 7, '冲突推进度': 7, '风格契合度': 6, '网文章节感': 7 },
    [],
  );
  assert.equal(result.pass, true);
  assert.equal(result.blockReason, null);
});

test('evaluateAuditGate fails on low dimension', () => {
  const result = evaluateAuditGate(
    { '可读性': 8, '分镜执行度': 3, '冲突推进度': 7, '风格契合度': 6, '网文章节感': 7 },
    [],
  );
  assert.equal(result.pass, false);
  assert.match(result.blockReason || '', /分镜执行度/);
});

test('evaluateAuditGate fails on low total', () => {
  const result = evaluateAuditGate(
    { '可读性': 4, '分镜执行度': 4, '冲突推进度': 4, '风格契合度': 4, '网文章节感': 4 },
    [],
  );
  assert.equal(result.pass, false);
  assert.match(result.blockReason || '', /总分/);
});

test('evaluateAuditGate fails on critical issues', () => {
  const result = evaluateAuditGate(
    { '可读性': 8, '分镜执行度': 7, '冲突推进度': 7, '风格契合度': 6, '网文章节感': 7 },
    [{ dimension: '可读性', severity: 'critical' }],
  );
  assert.equal(result.pass, false);
});

const validFiveDim = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  scores: {
    '可读性': { score: 8, reason: '句式清楚' },
    '分镜执行度': { score: 8, reason: '动作兑现' },
    '冲突推进度': { score: 8, reason: '风险前移' },
    '风格契合度': { score: 8, reason: '笔调稳定' },
    '网文章节感': { score: 8, reason: '收束有钩子' },
  },
  totalScore: 40,
  pass: true,
  ...overrides,
});

test('parseAuditFiveDim rejects malformed, missing, extra, and out-of-range scores', () => {
  assert.equal(parseAuditFiveDim(validFiveDim({ scores: 'bad' })), null);
  assert.equal(parseAuditFiveDim(validFiveDim({ scores: { '可读性': { score: 8, reason: 'ok' } } })), null);
  assert.equal(parseAuditFiveDim(validFiveDim({ scores: {
    '可读性': { score: 11, reason: 'bad' }, '分镜执行度': { score: 8, reason: 'ok' },
    '冲突推进度': { score: 8, reason: 'ok' }, '风格契合度': { score: 8, reason: 'ok' }, '网文章节感': { score: 8, reason: 'ok' },
  } })), null);
  assert.equal(parseAuditFiveDim(validFiveDim({ totalScore: 51 })), null);
  assert.equal(parseAuditFiveDim(validFiveDim({ totalScore: '40' })), null);
  assert.equal(parseAuditFiveDim(validFiveDim({ pass: 'true' })), null);
  assert.equal(parseAuditFiveDim(validFiveDim({ totalScore: 39 })), null);
});

test('evaluateAuditGate rejects any invalid fixed-dimension score shape', () => {
  const base = { '可读性': 8, '分镜执行度': 8, '冲突推进度': 8, '风格契合度': 8, '网文章节感': 8 };
  assert.equal(evaluateAuditGate({ ...base, '额外维度': 8 }, []).pass, false);
  assert.equal(evaluateAuditGate({ ...base, '网文章节感': Number.NaN }, []).pass, false);
  assert.equal(evaluateAuditGate({ ...base, '网文章节感': '8' as unknown as number }, []).pass, false);
  const { '网文章节感': _missing, ...missing } = base;
  assert.equal(evaluateAuditGate(missing, []).pass, false);
  assert.equal(evaluateAuditGate({ ...base, '网文章节感': 11 }, []).pass, false);
});

test('five-dimension conversion always scales 0-50 to 0-100', () => {
  const parsed = parseAuditFiveDim(validFiveDim({
    totalScore: 25,
    scores: {
      '可读性': { score: 5, reason: '句式清楚' }, '分镜执行度': { score: 5, reason: '动作兑现' },
      '冲突推进度': { score: 5, reason: '风险前移' }, '风格契合度': { score: 5, reason: '笔调稳定' },
      '网文章节感': { score: 5, reason: '收束有钩子' },
    },
  }));
  assert.ok(parsed);
  assert.equal(convertFiveDimToStructured(parsed!).score, 50);
});

test('five-dimension markdown uses evaluated gate and preserves fatal issue dimension', () => {
  const parsed = parseAuditFiveDim(validFiveDim({
    totalScore: 40,
    pass: true,
    fatalIssues: [{ dimension: '冲突推进度', issueType: 'general', issueSubtype: 'general', severity: 'critical', snippet: '原文', explanation: '问题', patchHint: '修复' }],
  }));
  assert.ok(parsed);
  assert.match(renderFiveDimMarkdown(parsed!), /^## FAIL/);
  assert.equal(convertFiveDimToStructured(parsed!).fatalIssues[0]?.dimension, '冲突推进度');
});

test('strict contract diagnostics reject filtered issues without changing tolerant parsing', () => {
  const raw = validFiveDim({
    totalScore: 25,
    pass: false,
    scores: {
      '可读性': { score: 5, reason: 'ok' }, '分镜执行度': { score: 5, reason: 'ok' },
      '冲突推进度': { score: 5, reason: 'ok' }, '风格契合度': { score: 5, reason: 'ok' }, '网文章节感': { score: 5, reason: 'ok' },
    },
    fatalIssues: [{ snippet: '缺少修补字段' }],
  });
  assert.equal(parseAuditFiveDim(raw)?.fatalIssues?.length, 1);
  const diagnostic = diagnoseAuditContract(raw, 'five-dim');
  assert.equal(diagnostic.valid, false);
  assert.equal(diagnostic.violation, 'fatal_issues_filtered');
  assert.equal(diagnostic.rawIssueCount, 1);
  assert.equal(diagnostic.normalizedIssueCount, 0);
});

test('strict contract diagnostics reject score/pass contradictions and low empty results', () => {
  const contradictory = validFiveDim({ pass: false, fatalIssues: [] });
  assert.equal(diagnoseAuditContract(contradictory, 'five-dim').violation, 'pass_gate_mismatch');
  const lowStructured = JSON.stringify({ score: 55, fatalIssues: [], sceneChecks: [], surgerySuggestions: [] });
  assert.equal(diagnoseAuditContract(lowStructured, 'structured').violation, 'low_structured_score_without_issues');
  const validEmpty = JSON.stringify({ score: 80, fatalIssues: [], sceneChecks: [], surgerySuggestions: [] });
  assert.equal(diagnoseAuditContract(validEmpty, 'structured').valid, true);
});

test('strict contract diagnostics require fatalIssues arrays even for high scores', () => {
  const structuredMissing = JSON.stringify({ score: 90, sceneChecks: [], surgerySuggestions: [] });
  assert.equal(diagnoseAuditContract(structuredMissing, 'structured').violation, 'fatal_issues_missing');
  const structuredInvalid = JSON.stringify({ score: 90, fatalIssues: null, sceneChecks: [], surgerySuggestions: [] });
  assert.equal(diagnoseAuditContract(structuredInvalid, 'structured').violation, 'fatal_issues_not_array');

  const fiveMissing = validFiveDim();
  const fivePayload = JSON.parse(fiveMissing) as Record<string, unknown>;
  delete fivePayload.fatalIssues;
  assert.equal(diagnoseAuditContract(JSON.stringify(fivePayload), 'five-dim').violation, 'fatal_issues_missing');
});

// ── V10: Structured Audit Parse Tolerance Tests ─────────────────────────

test('structured audit parser - handles dirty and missing array properties gracefully', () => {
  const raw = JSON.stringify({
    score: 85,
    fatalIssues: 'not-an-array', // invalid type
    sceneChecks: null,          // invalid type
    surgerySuggestions: 123     // invalid type
  });

  const parsed = parseStructuredAuditResponse(raw);
  assert.ok(parsed);
  assert.equal(parsed.score, 85);
  assert.deepEqual(parsed.fatalIssues, []);
  assert.deepEqual(parsed.sceneChecks, []);
  assert.deepEqual(parsed.surgerySuggestions, []);
});

test('structured audit parser - filters invalid items and maps planation to explanation', () => {
  const raw = JSON.stringify({
    score: 90,
    fatalIssues: [
      {
        issueType: 'dialogue-logic',
        issueSubtype: 'dialogue-abrupt-info',
        severity: 'critical',
        snippet: '“三……三天。”',
        planation: '使用了 planation 代替 explanation', // planation backup mapping
        patchHint: '在前文补一个追问。'
      },
      {
        issueType: 'syntax',
        issueSubtype: 'syntax-invalid-phrase',
        severity: 'invalid-severity', // should fallback to major
        snippet: '有些重复的话',
        explanation: '句子累赘',
        patchHint: '修改'
      },
      {
        snippet: '没有 explanation 和 patchHint 的垃圾数据' // should be filtered out
      }
    ],
    sceneChecks: [
      {
        scene: '场景一',
        status: 'invalid-status', // should fallback to weak
        note: '测试备注'
      },
      {
        note: '没有 scene 的无效项' // should be filtered out
      }
    ]
  });

  const parsed = parseStructuredAuditResponse(raw);
  assert.ok(parsed);
  assert.equal(parsed.fatalIssues.length, 2);

  // Verify planation mapping
  assert.equal(parsed.fatalIssues[0]?.explanation, '使用了 planation 代替 explanation');

  // Verify invalid severity fallback
  assert.equal(parsed.fatalIssues[1]?.severity, 'major');

  // Verify invalid status fallback
  assert.equal(parsed.sceneChecks.length, 1);
  assert.equal(parsed.sceneChecks[0]?.scene, '场景一');
  assert.equal(parsed.sceneChecks[0]?.status, 'weak');
});

test('structured audit parser - accepts explicit provider aliases and exposes parse diagnostics', () => {
  const raw = JSON.stringify({
    score: 38,
    fatalIssues: [{
      issueType: 'style-slop',
      severity: 'high',
      quote: '原文中的套话',
      reason: '这句使用了模板化情绪表达。',
      suggestedFix: '改成可观察的动作。',
    }],
    sceneChecks: [],
    surgerySuggestions: [],
  });

  const parsed = parseStructuredAuditResponse(raw);
  assert.ok(parsed);
  assert.equal(parsed.fatalIssues.length, 1);
  assert.equal(parsed.fatalIssues[0]?.snippet, '原文中的套话');
  assert.equal(parsed.fatalIssues[0]?.explanation, '这句使用了模板化情绪表达。');
  assert.equal(parsed.fatalIssues[0]?.patchHint, '改成可观察的动作。');
  assert.equal(parsed.fatalIssues[0]?.severity, 'critical');
});

test('stripEmbeddedStructuredAudit removes embedded audit comment and preserves raw markdown', () => {
  const markdown = '## Original Title\nThis is the critique content.';
  const audit = {
    score: 85,
    fatalIssues: [],
    sceneChecks: [],
    surgerySuggestions: []
  };
  const embedded = embedStructuredAudit(markdown, audit);

  // Verify comment exists
  assert.match(embedded, /<!--\s*audit-structured:[A-Za-z0-9+/=]+\s*-->/);

  // Strip comment
  const stripped = stripEmbeddedStructuredAudit(embedded);
  assert.equal(stripped, markdown);
});

test('convertFiveDimToStructured deep boundary conversion correctly scales score and preserves issues', () => {
  const fiveDim: AuditScores = {
    scores: {
      prose: { score: 8, reason: 'Good prose' },
      narrative: { score: 7, reason: 'Nice flow' },
      character: { score: 9, reason: 'Deep characters' },
      setting: { score: 6, reason: 'Basic setting' },
      pacing: { score: 5, reason: 'A bit slow' }
    },
    totalScore: 35, // 35 out of 50 possible points (5 dimensions * 10) -> should scale to 70 out of 100
    pass: true,
    fatalIssues: [
      {
        issueType: 'dialogue-logic',
        issueSubtype: 'dialogue-abrupt-info',
        severity: 'critical',
        snippet: '“三……三天。”',
        explanation: '突兀信息',
        patchHint: '前文补追问'
      }
    ],
    surgerySuggestions: ['让掌柜多一些小动作']
  };

  const converted = convertFiveDimToStructured(fiveDim);
  assert.ok(converted);
  assert.equal(converted.score, 70); // 35 / 50 * 100 = 70
  assert.equal(converted.fatalIssues.length, 1);
  assert.equal(converted.fatalIssues[0]?.issueType, 'dialogue-logic');
  assert.equal(converted.fatalIssues[0]?.snippet, '“三……三天。”');
  assert.deepEqual(converted.surgerySuggestions, ['让掌柜多一些小动作']);
  assert.deepEqual(converted.sceneChecks, []);
});

test('convertFiveDimToStructured maps legacy fatal issues to frozen evidence categories', () => {
  const issue = (issueType: string, issueSubtype: string, severity = 'major') => ({
    issueType, issueSubtype, severity, snippet: `${issueType} quote`, explanation: '原因', patchHint: '修复',
  });
  const converted = convertFiveDimToStructured({
    scores: { prose: { score: 8, reason: '' } },
    totalScore: 8,
    pass: true,
    fatalIssues: [
      issue('scene-execution', 'scene-layer-missing'),
      issue('action-chain', 'weak-action-chain'),
      issue('duplicate', 'duplicate-rupture'),
      issue('dialogue-logic', 'dialogue-general'),
      issue('general', 'general', 'critical'),
    ],
  });

  assert.deepEqual(converted.evidence?.map((item) => item.category), [
    'scene_execution', 'foreshadowing', 'pacing', 'character_state', 'hard_canon',
  ]);
  assert.deepEqual(converted.evidence?.map((item) => item.severity), ['medium', 'medium', 'medium', 'medium', 'high']);
});
