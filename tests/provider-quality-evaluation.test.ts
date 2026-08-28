import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_PROMPT_TEMPLATES } from '../shared/config/prompt-templates';
import type { AppConfig } from '../server/lib/config';
import type { GenerateTextOptions } from '../server/lib/server-llm';
import { ProviderError } from '../server/lib/server-llm';
import {
  calculateEvaluationMetrics,
  evaluateChapter,
  evaluateContractCases,
  loadEvaluationFixture,
  runChapterProviderEvaluation,
  parseAuditForEvaluation,
  shouldRetryAuditResponse,
  type ContractCaseResult,
  type EvaluationSampleResult,
} from '../scripts/run-chapter-llm-acceptance';
import { runProviderQualitySmoke } from '../scripts/provider-quality-smoke';
import {
  auditCoversResidueSnippets,
  buildAuditResidueContract,
  findAuditResidueSnippets,
} from '../server/helpers/prompt-helpers';

const configured: AppConfig = {
  apiKey: 'configured-test-key',
  baseUrl: 'https://provider.test/v1',
  model: 'test-model',
  promptTemplates: DEFAULT_PROMPT_TEMPLATES,
};

function structuredAudit(snippet?: string): string {
  return JSON.stringify({
    score: snippet ? 35 : 90,
    fatalIssues: snippet ? [{
      issueType: 'style-slop',
      issueSubtype: 'ai-cliche',
      severity: 'major',
      snippet,
      explanation: '需要改为可观察的具体动作。',
      patchHint: '用动作和环境反应替换抽象套话。',
    }] : [],
    sceneChecks: [],
    surgerySuggestions: [],
  });
}

const malformedAudit = '{"score": 20, "fatalIssues": [';

function createAuditSequenceGenerator(sequence: (options: GenerateTextOptions) => string) {
  const requests: GenerateTextOptions[] = [];
  const generate = async (_config: AppConfig, options: GenerateTextOptions): Promise<string> => {
    requests.push(options);
    return sequence(options);
  };
  return { generate, requests };
}

function sample(overrides: Partial<EvaluationSampleResult>): EvaluationSampleResult {
  return {
    id: 'sample',
    file: 'sample.txt',
    label: 'sample',
    status: 'FALLBACK',
    errorCode: null,
    durationMs: 0,
    qualityFindings: [],
    expectedP0Codes: [],
    inputHasExpectedDefect: false,
    defectDetected: false,
    candidateProduced: false,
    rewriteChangedText: false,
    rewriteIntroducedP0P1: false,
    unauthorizedRewrite: false,
    appliedCount: 0,
    accepted: false,
    ...overrides,
  };
}

test('fixed contract cases cover hard failures, P2 warnings and valid prose', () => {
  const fixture = loadEvaluationFixture();
  const results = evaluateContractCases(fixture);

  for (const result of results) {
    assert.equal(result.actualOk, result.expectedOk, result.id);
    for (const code of result.expectedCodes) {
      assert.ok(result.actualCodes.includes(code), `${result.id} must include ${code}`);
    }
  }

  const p2 = results.find((item) => item.id === 'p2-repeated-opening');
  assert.equal(p2?.actualOk, true);
  assert.ok(p2?.actualCodes.includes('repeated-opening'));
  assert.deepEqual(results.find((item) => item.id === 'clean-dialogue-cadence')?.actualCodes, []);
  assert.deepEqual(results.find((item) => item.id === 'clean-mature-prose')?.actualCodes, []);
});

test('evaluation metrics expose numerators, denominators and honest null rates', () => {
  const emptyMetrics = calculateEvaluationMetrics([], []);
  assert.deepEqual(emptyMetrics.p0EscapeRate, { value: null, numerator: 0, denominator: 0 });
  assert.deepEqual(emptyMetrics.p1MissRate, { value: null, numerator: 0, denominator: 0 });
  assert.deepEqual(emptyMetrics.polishAcceptanceRate, { value: null, numerator: 0, denominator: 0 });
  assert.deepEqual(emptyMetrics.harmfulRewriteRate, { value: null, numerator: 0, denominator: 0 });

  const contractCases: ContractCaseResult[] = [{
    id: 'p1', expectedCodes: ['duplicate-paragraph'], actualCodes: [], expectedOk: false, actualOk: true,
  }];
  const metrics = calculateEvaluationMetrics([
    sample({
      id: 'escaped-p0', candidateProduced: true, accepted: false,
      expectedP0Codes: ['metadata'], qualityFindings: ['metadata'],
    }),
    sample({
      id: 'harmful', candidateProduced: true, accepted: true,
      rewriteIntroducedP0P1: true,
    }),
  ], contractCases);
  assert.deepEqual(metrics.p0EscapeRate, { value: 1, numerator: 1, denominator: 1 });
  assert.deepEqual(metrics.p1MissRate, { value: 1, numerator: 1, denominator: 1 });
  assert.deepEqual(metrics.polishAcceptanceRate, { value: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(metrics.harmfulRewriteRate, { value: 1, numerator: 1, denominator: 1 });

  const incomplete = calculateEvaluationMetrics([
    sample({ candidateProduced: true, accepted: false, appliedCount: 1 }),
    sample({ candidateProduced: true, accepted: true, unauthorizedRewrite: true }),
  ], []);
  assert.deepEqual(incomplete.polishAcceptanceRate, { value: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(incomplete.harmfulRewriteRate, { value: 1, numerator: 1, denominator: 1 });
});

test('audit evaluation distinguishes contract violations from a clean no-issue response', () => {
  const missingIssues = parseAuditForEvaluation(JSON.stringify({
    scores: {
      '可读性': { score: 2, reason: '残句' },
      '分镜执行度': { score: 2, reason: '未兑现' },
      '冲突推进度': { score: 2, reason: '无推进' },
      '风格契合度': { score: 2, reason: '偏离' },
      '网文章节感': { score: 2, reason: '不像正文' },
    },
    totalScore: 10,
    pass: false,
    fatalIssues: [],
  }));
  assert.equal(missingIssues.parseMode, 'five-dim');
  assert.equal(missingIssues.contractViolation, 'missing_fatal_issues');
  assert.equal(missingIssues.normalizedIssueCount, 0);

  const aliasedIssue = parseAuditForEvaluation(JSON.stringify({
    score: 35,
    fatalIssues: [{ quote: '套话原文', reason: '模板化表达', suggestedFix: '改成具体动作', severity: 'high' }],
  }));
  assert.equal(aliasedIssue.parseMode, 'structured');
  assert.equal(aliasedIssue.contractViolation, null);
  assert.equal(aliasedIssue.normalizedIssueCount, 1);

  const contradictoryPass = parseAuditForEvaluation(JSON.stringify({
    scores: {
      '可读性': { score: 2, reason: '残句' },
      '分镜执行度': { score: 2, reason: '未兑现' },
      '冲突推进度': { score: 2, reason: '无推进' },
      '风格契合度': { score: 2, reason: '偏离' },
      '网文章节感': { score: 2, reason: '不像正文' },
    },
    totalScore: 10,
    pass: true,
    fatalIssues: [{ snippet: '原文', explanation: '问题', patchHint: '修复' }],
  }));
  assert.equal(contradictoryPass.contractViolation, 'pass_score_mismatch');
});

test('evaluation parser keeps strict JSON string content and contract diagnostics', () => {
  const issue = {
    issueType: 'dialogue-logic',
    issueSubtype: 'dialogue-general',
    severity: 'major',
    snippet: '“他说：\\"别回头\\"。”',
    explanation: '保留中文弯引号，不应被全局替换。',
    patchHint: '补充动作。',
  };
  const payload = {
    score: 35,
    fatalIssues: [issue],
    sceneChecks: [],
    surgerySuggestions: [],
  };
  for (const content of [
    JSON.stringify(payload),
    `前缀说明\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
    `<think>内部推理</think>前缀说明\n${JSON.stringify(payload)}`,
  ]) {
    const parsed = parseAuditForEvaluation(content);
    assert.equal(parsed.rawIssueCount, 1);
    assert.equal(parsed.normalizedIssueCount, 1);
    assert.equal(parsed.contractViolation, null);
    assert.match(parsed.structured.fatalIssues[0]?.snippet || '', /“他说：\\"别回头\\"。”/);
  }

  const truncated = parseAuditForEvaluation(JSON.stringify(payload).slice(0, -2));
  assert.equal(truncated.parseMode, 'unparseable');
  assert.equal(truncated.contractViolation, 'audit_response_unparseable');

  const wrongRoot = parseAuditForEvaluation(`[${JSON.stringify(payload)}]`);
  assert.equal(wrongRoot.parseMode, 'unparseable');

  const missingIssues = parseAuditForEvaluation(JSON.stringify({ ...payload, fatalIssues: undefined }));
  assert.equal(missingIssues.contractViolation, 'missing_fatal_issues');

  const illegalIssue = parseAuditForEvaluation(JSON.stringify({ ...payload, fatalIssues: [{ snippet: '缺字段' }] }));
  assert.equal(illegalIssue.rawIssueCount, 1);
  assert.equal(illegalIssue.normalizedIssueCount, 0);
  assert.equal(illegalIssue.contractViolation, 'malformed_fatal_issue');
});

test('evaluation parser does not turn strict invalid_json into a successful audit', () => {
  const issue = {
    issueType: 'style-slop',
    issueSubtype: 'ai-cliche',
    severity: 'major',
    snippet: '具体问题',
    explanation: '说明',
    patchHint: '修复',
  };
  const parsed = parseAuditForEvaluation(JSON.stringify({
    score: 90,
    scores: { unexpected: true },
    fatalIssues: [issue],
    sceneChecks: [],
    surgerySuggestions: [],
  }));
  assert.equal(parsed.parseMode, 'unparseable');
  assert.equal(parsed.contractViolation, 'audit_response_unparseable');
  assert.equal(parsed.rawIssueCount, null);
  assert.equal(parsed.normalizedIssueCount, 0);
});

test('evaluation parser reports a violation after five-dim tolerant fallback', () => {
  const parsed = parseAuditForEvaluation(JSON.stringify({
    scores: {
      '可读性': { score: 2, reason: '残句' },
      '分镜执行度': { score: 2, reason: '未执行' },
      '冲突推进度': { score: 2, reason: '无推进' },
      '风格契合度': { score: 2, reason: '偏离' },
      '网文章节感': { score: 2, reason: '失败' },
    },
    totalScore: 10,
    pass: true,
    fatalIssues: [{ snippet: '问题', explanation: '说明', patchHint: '修复' }],
  }));
  assert.equal(parsed.parseMode, 'five-dim');
  assert.equal(parsed.contractViolation, 'pass_score_mismatch');
});

test('audit evaluation preserves structured parser diagnostics for malformed provider output', () => {
  const plainText = parseAuditForEvaluation('这不是审稿 JSON，而是一段普通说明。');
  assert.equal(plainText.diagnosticCode, 'plain_text');
  assert.equal(plainText.diagnosticSummary, 'Provider 返回了纯文本而非审稿 JSON');

  const truncated = parseAuditForEvaluation('{"score": 20, "fatalIssues": [');
  assert.equal(truncated.diagnosticCode, 'truncated');
  assert.equal(truncated.diagnosticSummary, '审稿 JSON 未闭合，疑似达到输出长度上限');

  const missingFatalIssues = parseAuditForEvaluation(JSON.stringify({ score: 20 }));
  assert.equal(missingFatalIssues.diagnosticCode, 'missing_fatal_issues');
  assert.equal(missingFatalIssues.diagnosticSummary, '审稿 JSON 缺少合法 fatalIssues 数组');
});


test('provider evaluation appends the shared JSON contract without reasoning spillover', () => {
  const source = fs.readFileSync('scripts/run-chapter-llm-acceptance.ts', 'utf8');
  assert.match(source, /input\.prompt \+ AUDIT_OUTPUT_CONTRACT/);
  assert.match(source, /disableThinking: true/);
});

test('live-only retries one failed audit contract while deterministic never retries', () => {
  assert.equal(shouldRetryAuditResponse('live-only', 'audit', true, 'missing_fatal_issues'), true);
  assert.equal(shouldRetryAuditResponse('live-only', 're-audit', true, 'invalid_json'), true);
  assert.equal(shouldRetryAuditResponse('live-only', 'audit', false, 'invalid_json'), false);
  assert.equal(shouldRetryAuditResponse('live-only', 'rewrite', true, 'invalid_json'), false);
  assert.equal(shouldRetryAuditResponse('deterministic', 'audit', true, 'invalid_json'), false);

  const source = fs.readFileSync('scripts/run-chapter-llm-acceptance.ts', 'utf8');
  assert.match(source, /严格结构化重试/);
  assert.match(source, /shouldRetryAuditResponse\(mode, 'audit'/);
  assert.match(source, /shouldRetryAuditResponse\(mode, 're-audit'/);
  assert.match(source, /calls\.push\(retryOutcome\.record\)/);
});

test('live evaluation retries malformed initial audit once and continues with the valid result', async () => {
  const fixture = loadEvaluationFixture().chapters.find((chapter) => chapter.id === 'slop-heavy');
  assert.ok(fixture);
  const issueSnippet = '在这个充满不确定性的清晨，林羽不得不深吸一口气。';
  const { generate, requests } = createAuditSequenceGenerator((options) => {
    if (options.outputMode === 'audit-json') {
      if (options.prompt.includes('严格结构化重试')) return structuredAudit(issueSnippet);
      if (options.prompt.includes('复核精修后的章节')) return structuredAudit();
      return malformedAudit;
    }
    return '林羽按住门框，雨水沿着指节滴进袖口。';
  });

  const result = await evaluateChapter(fixture, 'live-only', configured, { generateText: generate });
  assert.deepEqual(result.calls.filter((call) => call.phase === 'audit' || call.phase === 'audit-retry')
    .map((call) => call.phase), ['audit', 'audit-retry']);
  assert.equal(result.sample.candidateProduced, true);
  assert.equal(result.sample.accepted, true);
  assert.equal(requests.filter((request) => request.outputMode === 'audit-json').length, 3);
  assert.ok(requests.filter((request) => request.outputMode === 'audit-json')
    .every((request) => request.responseMimeType === 'application/json'));
});

test('live evaluation stops after the initial audit retry still violates the contract', async () => {
  const fixture = loadEvaluationFixture().chapters.find((chapter) => chapter.id === 'slop-heavy');
  assert.ok(fixture);
  const { generate, requests } = createAuditSequenceGenerator((options) => {
    if (options.outputMode === 'audit-json') return malformedAudit;
    throw new Error('rewrite must not run after an unparseable audit');
  });

  const result = await evaluateChapter(fixture, 'live-only', configured, { generateText: generate });
  assert.deepEqual(result.calls.map((call) => call.phase), ['audit', 'audit-retry']);
  assert.equal(result.sample.candidateProduced, false);
  assert.equal(result.sample.accepted, false);
  assert.equal(requests.length, 2);
});

test('live evaluation surfaces a retry Provider error instead of the first parse error', async () => {
  const fixture = loadEvaluationFixture().chapters.find((chapter) => chapter.id === 'slop-heavy');
  assert.ok(fixture);
  let calls = 0;
  const result = await evaluateChapter(fixture, 'live-only', configured, {
    generateText: async (_config, options) => {
      calls += 1;
      if (calls === 1) return malformedAudit;
      assert.equal(options.prompt.includes('严格结构化重试'), true);
      throw new ProviderError({
        code: 'timeout',
        phase: 'request',
        attempt: 1,
        traceId: 'retry-timeout',
        message: 'provider timeout details',
      });
    },
  });
  assert.equal(result.sample.candidateProduced, false);
  assert.equal(result.sample.errorCode, 'timeout');
  assert.equal(result.calls.at(-1)?.errorCode, 'timeout');
});

test('live evaluation retries a failed re-audit and never accepts the candidate', async () => {
  const fixture = loadEvaluationFixture().chapters.find((chapter) => chapter.id === 'slop-heavy');
  assert.ok(fixture);
  const issueSnippet = '在这个充满不确定性的清晨，林羽不得不深吸一口气。';
  const { generate, requests } = createAuditSequenceGenerator((options) => {
    if (options.outputMode === 'audit-json') {
      if (options.prompt.includes('复核精修后的章节')) return malformedAudit;
      return structuredAudit(issueSnippet);
    }
    return '林羽按住门框，雨水沿着指节滴进袖口。';
  });

  const result = await evaluateChapter(fixture, 'live-only', configured, { generateText: generate });
  assert.deepEqual(result.calls.filter((call) => call.phase === 're-audit' || call.phase === 're-audit-retry')
    .map((call) => call.phase), ['re-audit', 're-audit-retry']);
  assert.equal(result.sample.candidateProduced, true);
  assert.equal(result.sample.accepted, false);
  assert.equal(result.sample.errorCode, 'audit_response_unparseable');
  assert.equal(requests.filter((request) => request.outputMode === 'audit-json').length, 3);
});

test('deterministic evaluation never invokes the injected Provider or retries', async () => {
  const fixture = loadEvaluationFixture().chapters.find((chapter) => chapter.id === 'slop-heavy');
  assert.ok(fixture);
  let invocations = 0;
  const result = await evaluateChapter(fixture, 'deterministic', configured, {
    generateText: async () => {
      invocations += 1;
      throw new Error('deterministic mode must use local fixtures');
    },
  });
  assert.equal(invocations, 0);
  assert.equal(result.calls.filter((call) => call.phase === 'audit-retry' || call.phase === 're-audit-retry').length, 0);
});

test('provider evaluation records re-audit diagnostics and renders sanitized report fields', () => {
  const source = fs.readFileSync('scripts/run-chapter-llm-acceptance.ts', 'utf8');
  assert.match(source, /reAuditOutcome\.record\.diagnosticCode = parsedReAudit\.diagnosticCode/);
  assert.match(source, /reAuditOutcome\.record\.diagnosticSummary = parsedReAudit\.diagnosticSummary/);
  assert.match(source, /诊断码/);
  assert.match(source, /诊断摘要/);
  assert.match(source, /diagnosticSummary\.slice\(0, 120\)/);
  assert.doesNotMatch(source, /call\.rawOutput/);
  assert.match(source, /正文残留未被 fatalIssues 覆盖/);
  assert.match(source, /!residueCovered && !auditOutcome\.record\.diagnosticCode/);
  assert.match(source, /!reAuditResidueCovered && !reAuditOutcome\.record\.diagnosticCode/);
});

test('provider evaluation records sanitized audit issue categories without source snippets', async () => {
  const fixture = loadEvaluationFixture().chapters.find((chapter) => chapter.id === 'slop-heavy');
  assert.ok(fixture);
  const issueSnippet = '在这个充满不确定性的清晨，林羽不得不深吸一口气。';
  const { generate } = createAuditSequenceGenerator((options) => {
    if (options.outputMode === 'audit-json') return structuredAudit(issueSnippet);
    return '林羽按住门框，雨水沿着指节滴进袖口。';
  });

  const result = await evaluateChapter(fixture, 'live-only', configured, { generateText: generate });
  const auditCall = result.calls.find((call) => call.phase === 'audit');
  assert.deepEqual(auditCall?.issueTypes, ['style-slop']);
  assert.deepEqual(auditCall?.issueSubtypes, ['ai-cliche']);
  assert.equal('issueSnippets' in (auditCall || {}), false);
});

test('live re-audit prompt limits findings to unresolved, source-backed issues', async () => {
  const fixture = loadEvaluationFixture().chapters.find((chapter) => chapter.id === 'slop-heavy');
  assert.ok(fixture);
  const prompts: string[] = [];
  const { generate } = createAuditSequenceGenerator((options) => {
    prompts.push(options.prompt);
    if (options.outputMode === 'audit-json') return structuredAudit('在这个充满不确定性的清晨，林羽不得不深吸一口气。');
    return '林羽按住门框，雨水沿着指节滴进袖口。';
  });

  await evaluateChapter(fixture, 'live-only', configured, { generateText: generate });
  const reAuditPrompt = prompts.find((prompt) => prompt.includes('复核精修后的章节'));
  assert.ok(reAuditPrompt);
  assert.match(reAuditPrompt, /只报告仍存在且能被正文原文证实的问题/);
  assert.match(reAuditPrompt, /已修复的句子不要重复/);
});

test('live rewrite calls use one bounded provider retry while audit retries stay explicit', async () => {
  const fixture = loadEvaluationFixture().chapters.find((chapter) => chapter.id === 'slop-heavy');
  assert.ok(fixture);
  const requests: GenerateTextOptions[] = [];
  const { generate } = createAuditSequenceGenerator((options) => {
    requests.push(options);
    if (options.outputMode === 'audit-json') return structuredAudit('在这个充满不确定性的清晨，林羽不得不深吸一口气。');
    return '林羽按住门框，雨水沿着指节滴进袖口。';
  });

  await evaluateChapter(fixture, 'live-only', configured, { generateText: generate });
  assert.ok(requests.some((request) => request.outputMode === 'audit-json' && request.maxAttempts === 1));
  assert.ok(requests.some((request) => request.outputMode !== 'audit-json' && request.maxAttempts === 2));
});

test('audit residue contract pins exact metadata evidence for live providers', () => {
  const source = '作品：潮汐城。\n\n“你真的要去吗？”李凡问。\n\n问题：主角为什么出发？';
  assert.deepEqual(findAuditResidueSnippets(source), ['作品：潮汐城。', '问题：主角为什么出发？']);
  const contract = buildAuditResidueContract(source);
  assert.match(contract, /强制残留拦截/);
  assert.match(contract, /作品：潮汐城/);
  assert.match(contract, /pass 仍必须为 false/);
  assert.equal(auditCoversResidueSnippets(source, []), false);
  assert.equal(auditCoversResidueSnippets(source, [{ snippet: '作品：潮汐城。' }, { snippet: '问题：主角为什么出发？' }]), true);
});

test('provider smoke reports stable sanitized outcomes without real network calls', async () => {
  const run = async (generate: () => Promise<string>) => {
    const lines: string[] = [];
    const exitCode = await runProviderQualitySmoke({
      getConfig: () => configured,
      generateText: generate as never,
      out: (line) => lines.push(line),
      now: (() => { let current = 10; return () => current += 5; })(),
    });
    return { exitCode, output: lines.join('\n') };
  };

  const missingLines: string[] = [];
  assert.equal(await runProviderQualitySmoke({
    getConfig: () => ({ ...configured, apiKey: '' }),
    out: (line) => missingLines.push(line),
  }), 0);
  assert.equal(missingLines.join('\n'), 'SKIP: provider credentials not configured');

  const success = await run(async () => '雨落在门槛外。林舟拾起铜钥匙，发现齿槽里还沾着新鲜的红泥。');
  assert.equal(success.exitCode, 0);
  assert.match(success.output, /^PASS: provider prose quality/);

  const rejected = await run(async () => '作品：测试\n问题：正文在哪里？');
  assert.equal(rejected.exitCode, 1);
  assert.match(rejected.output, /metadata/);
  assert.match(rejected.output, /instruction-residue/);
  assert.doesNotMatch(rejected.output, /作品|正文在哪里/);

  const empty = await run(async () => '   ');
  assert.deepEqual(empty, { exitCode: 1, output: 'FAIL: provider smoke (empty_response)' });

  const errors: Array<[ProviderError, string]> = [
    [new ProviderError({ code: 'timeout', phase: 'request', attempt: 1, traceId: 'trace-timeout', message: 'raw timeout details' }), 'timeout'],
    [new ProviderError({ code: 'rate_limit', phase: 'request', attempt: 1, traceId: 'trace-rate', message: 'raw 429 details' }), 'rate_limited'],
    [new ProviderError({ code: 'service_unavailable', phase: 'request', attempt: 1, traceId: 'trace-provider', message: 'raw provider details' }), 'provider_error'],
  ];
  for (const [error, code] of errors) {
    const result = await run(async () => { throw error; });
    assert.equal(result.exitCode, 1);
    assert.equal(result.output, `FAIL: provider smoke (${code})`);
    assert.doesNotMatch(result.output, /raw|configured-test-key|provider\.test|test-model/);
  }
});

test('live-only without credentials skips before processing samples', () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-provider-eval-'));
  try {
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/run-chapter-llm-acceptance.ts', '--live-only',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, INKFLOW_CONFIG_DIR: configDir, INKFLOW_SECURE_API_KEY: '', API_KEY: '' },
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'SKIP: provider credentials not configured');
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('deterministic evaluation completes all samples and writes honest reports', async () => {
  const result = await runChapterProviderEvaluation('deterministic');
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.samples.length, 3);
  assert.ok(result.report.samples.every((item) => item.status === 'FALLBACK'));
  assert.ok(result.report.calls.every((item) => item.status === 'FALLBACK'));
  assert.deepEqual(result.report.calls.filter((item) => item.phase === 're-audit').map((item) => item.sample), ['slop-heavy', 'action-weak']);
  assert.deepEqual(result.report.metrics.p0EscapeRate, { value: 0, numerator: 0, denominator: 1 });
  assert.deepEqual(result.report.metrics.p1MissRate, { value: 0, numerator: 0, denominator: 2 });
  assert.deepEqual(result.report.metrics.polishAcceptanceRate, { value: 1, numerator: 2, denominator: 2 });

  const markdown = fs.readFileSync('tests/fixtures/chapter-llm-acceptance-report.md', 'utf8');
  const json = fs.readFileSync('tests/fixtures/chapter-llm-acceptance-report.json', 'utf8');
  assert.doesNotMatch(markdown, /Pure Live|95\s*\/\s*100|98\s*\/\s*100|100% 远程|完美|超凡/);
  assert.doesNotMatch(`${markdown}\n${json}`, /configured-test-key|provider\.test|【当前任务】|完整正文/);
});
