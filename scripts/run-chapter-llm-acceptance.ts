import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConfig, type AppConfig } from '../server/lib/config';
import { generateText, type GenerateTextOptions } from '../server/lib/server-llm';
import {
  AUDIT_OUTPUT_CONTRACT,
  auditCoversResidueSnippets,
  buildAuditResidueContract,
  renderPromptTemplate,
} from '../server/helpers/prompt-helpers';
import {
  convertFiveDimToStructured,
  parseAuditFiveDim,
  parseAuditResponseWithDiagnostics,
  parseBalancedJsonObject,
  parseStructuredAuditResponse,
  type StructuredAudit,
} from '../shared/lib/audit-structured';
import { validateDraftQuality } from '../shared/lib/draft-quality';
import { resolvePromptAssetForSurface } from '../shared/lib/prompt-runtime';
import { buildRewritePrompt } from '../shared/lib/rewrite-prompt';
import { selectRewriteTargetsForPatch } from '../src/lib/chapter-polish';
import { classifyProviderSmokeError } from './provider-quality-smoke';

export type EvaluationStatus = 'LIVE' | 'FALLBACK' | 'SKIP';
export type EvaluationPhase = 'audit' | 'rewrite' | 're-audit' | 'audit-retry' | 're-audit-retry';

const STRICT_AUDIT_RETRY_INSTRUCTION = `

### 严格结构化重试
上一次审稿响应未通过 JSON/合同校验。请重新生成完整审稿结果：只输出一个可解析的 JSON 对象，不要 markdown、解释文字或思考标签；必须完整包含 scores、totalScore、pass、failReason、fatalIssues、surgerySuggestions，且每条 fatalIssues 必须包含完整六字段和原文 snippet。`;

export function shouldRetryAuditResponse(
  mode: 'deterministic' | 'live-only',
  phase: EvaluationPhase,
  hasContent: boolean,
  contractViolation: string | null | undefined,
): boolean {
  return mode === 'live-only'
    && hasContent
    && (phase === 'audit' || phase === 're-audit')
    && Boolean(contractViolation);
}

export interface ChapterFixture {
  id: string;
  file: string;
  label: string;
  expectedP0P1Codes: string[];
  inputHasExpectedDefect: boolean;
  allowRewrite: boolean;
  requiresChange: boolean;
  minimumAppliedPatches: number;
}

interface ContractCase {
  id: string;
  text: string;
  expectedCodes: string[];
  expectedOk: boolean;
}

export interface EvaluationFixture {
  version: number;
  chapters: ChapterFixture[];
  contractCases: ContractCase[];
}

export interface ContractCaseResult {
  id: string;
  expectedCodes: string[];
  actualCodes: string[];
  expectedOk: boolean;
  actualOk: boolean;
}

export interface EvaluationCallRecord {
  status: EvaluationStatus;
  phase: EvaluationPhase;
  sample: string;
  errorCode: string | null;
  durationMs: number;
  qualityFindings: string[];
  inputHasExpectedDefect: boolean;
  defectDetected: boolean;
  rewriteChangedText: boolean;
  rewriteIntroducedP0P1: boolean;
  parseMode?: 'five-dim' | 'structured' | 'inferred' | 'unparseable';
  contractViolation?: string | null;
  rawOutputChars?: number;
  rawIssueCount?: number | null;
  normalizedIssueCount?: number;
  responseShape?: 'json-object' | 'json-array' | 'markdown' | 'plain-text' | 'empty';
  hasAuditKeys?: boolean;
  /** Sanitized issue categories only; never include provider snippets. */
  issueTypes?: string[];
  issueSubtypes?: string[];
  diagnosticCode?: string;
  diagnosticSummary?: string;
}

export interface EvaluationSampleResult {
  id: string;
  file: string;
  label: string;
  status: EvaluationStatus;
  errorCode: string | null;
  durationMs: number;
  qualityFindings: string[];
  expectedP0Codes: string[];
  inputHasExpectedDefect: boolean;
  defectDetected: boolean;
  candidateProduced: boolean;
  rewriteChangedText: boolean;
  rewriteIntroducedP0P1: boolean;
  unauthorizedRewrite: boolean;
  appliedCount: number;
  accepted: boolean;
}

export interface MetricRate {
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface EvaluationMetrics {
  p0EscapeRate: MetricRate;
  p1MissRate: MetricRate;
  polishAcceptanceRate: MetricRate;
  harmfulRewriteRate: MetricRate;
}

interface EvaluationReport {
  schemaVersion: 1;
  generatedAt: string;
  mode: 'deterministic' | 'live-only';
  overallStatus: EvaluationStatus;
  modelConfigured: boolean;
  samples: EvaluationSampleResult[];
  calls: EvaluationCallRecord[];
  contractCases: ContractCaseResult[];
  metrics: EvaluationMetrics;
}

interface CallOutcome {
  content: string | null;
  record: EvaluationCallRecord;
}

export type EvaluationGenerateText = (
  config: AppConfig,
  options: GenerateTextOptions,
) => Promise<string>;

export interface ProviderEvaluationOptions {
  generateText?: EvaluationGenerateText;
}

interface AuditParseResult {
  structured: StructuredAudit;
  parseMode: 'five-dim' | 'structured' | 'inferred' | 'unparseable';
  contractViolation: string | null;
  rawOutputChars: number;
  rawIssueCount: number | null;
  normalizedIssueCount: number;
  responseShape: EvaluationCallRecord['responseShape'];
  hasAuditKeys: boolean;
  diagnosticCode?: string;
  diagnosticSummary?: string;
}

function isAuditPhase(phase: EvaluationPhase): boolean {
  return phase === 'audit' || phase === 're-audit' || phase === 'audit-retry' || phase === 're-audit-retry';
}

const FIXTURES_DIR = path.join(process.cwd(), 'tests/fixtures');
const FIXTURE_PATH = path.join(FIXTURES_DIR, 'chapter-quality-evaluation.json');
const JSON_REPORT_PATH = path.join(FIXTURES_DIR, 'chapter-llm-acceptance-report.json');
const MARKDOWN_REPORT_PATH = path.join(FIXTURES_DIR, 'chapter-llm-acceptance-report.md');

const P1_CODES = new Set(['duplicate-paragraph', 'symbol-noise', 'template-residue']);

const HEAVY_SLOP_REWRITES: Record<string, string> = {
  '在这个充满不确定性的清晨，林羽不得不深吸一口气。': '林羽推开厚重的松木门，冷风裹着青石板上的水汽扑在脸上。他站定，攥紧汗湿的衣角。',
  '他深吸一口气，心中暗涌翻腾，目光中闪过一丝挣扎。': '林羽垂下眼睑，任由冰凉的雨丝沾湿睫毛，指节在门框上压出一道白痕。',
  '因为原因在于他不得不说，这意味着他将失去一切。': '这一步走错，他便再也拿不回父亲留下的那间旧厂。',
};

const ACTION_WEAK_REWRITES: Record<string, string> = {
  '作品：潮汐城。\n\n“你真的要去吗？”李凡问。\n\n“去。”王强说。\n\n“为什么？”李凡问。': '李凡把刚倒满的酒碗推到桌角。“你真的要去吗？”\n\n王强盯着渗进木缝的酒液，拇指抵住腰刀护环。“去。”\n\n“为什么？”李凡按住桌面。',
  '“你真的要去吗？”李凡问。\n\n“去。”王强说。\n\n“为什么？”李凡问。': '李凡把刚倒满的酒碗推到桌角。“你真的要去吗？”\n\n王强盯着渗进木缝的酒液，拇指抵住腰刀护环。“去。”\n\n“为什么？”李凡按住桌面。',
  '“可是外面很危险，你一个人应付不过来。”李凡劝阻。\n\n“我知道，但我不在乎。”王强表明了决心。\n\n“既然你这么说，那随你吧。”李凡叹了口气。': '“可是外面很危险。”李凡压低声音，“你一个人应付不过来。”\n\n王强把褪色的斗篷拉上肩头：“我知道。”\n\n李凡看着他扣紧腰刀，伸出去的手又收了回来。',
};

function metricRate(numerator: number, denominator: number): MetricRate {
  return { value: denominator === 0 ? null : numerator / denominator, numerator, denominator };
}

function hardFindingCodes(text: string): string[] {
  return validateDraftQuality(text).findings
    .filter((finding) => finding.severity === 'P0' || finding.severity === 'P1')
    .map((finding) => finding.code);
}

function recordAuditIssueCategories(record: EvaluationCallRecord, structured: StructuredAudit): void {
  record.issueTypes = [...new Set(structured.fatalIssues.map((issue) => issue.issueType))].sort();
  record.issueSubtypes = [...new Set(structured.fatalIssues.map((issue) => issue.issueSubtype))].sort();
}

export function calculateEvaluationMetrics(
  samples: EvaluationSampleResult[],
  contractCases: ContractCaseResult[],
): EvaluationMetrics {
  const p0Candidates = samples.filter((sample) => sample.candidateProduced && sample.expectedP0Codes.length > 0);
  const p0Escapes = p0Candidates.filter((sample) => (
    sample.expectedP0Codes.some((code) => sample.qualityFindings.includes(code))
  )).length;

  const expectedP1Codes = contractCases.flatMap((item) => item.expectedCodes
    .filter((code) => P1_CODES.has(code))
    .map((code) => ({ item, code })));
  const missedP1Codes = expectedP1Codes.filter(({ item, code }) => !item.actualCodes.includes(code)).length;

  const candidates = samples.filter((sample) => sample.candidateProduced);
  const accepted = candidates.filter((sample) => sample.accepted);
  const harmful = accepted.filter((sample) => sample.rewriteIntroducedP0P1 || sample.unauthorizedRewrite);

  return {
    p0EscapeRate: metricRate(p0Escapes, p0Candidates.length),
    p1MissRate: metricRate(missedP1Codes, expectedP1Codes.length),
    polishAcceptanceRate: metricRate(accepted.length, candidates.length),
    harmfulRewriteRate: metricRate(harmful.length, accepted.length),
  };
}

export function loadEvaluationFixture(): EvaluationFixture {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as EvaluationFixture;
}

export function evaluateContractCases(fixture: EvaluationFixture): ContractCaseResult[] {
  return fixture.contractCases.map((item) => {
    const quality = validateDraftQuality(item.text);
    return {
      id: item.id,
      expectedCodes: item.expectedCodes,
      actualCodes: quality.findings.map((finding) => finding.code),
      expectedOk: item.expectedOk,
      actualOk: quality.ok,
    };
  });
}

function fallbackAudit(sampleId: string): StructuredAudit {
  if (sampleId === 'slop-heavy') {
    return {
      score: 35,
      fatalIssues: [
        {
          issueType: 'style-slop', issueSubtype: 'ai-cliche', severity: 'major',
          snippet: '在这个充满不确定性的清晨，林羽不得不深吸一口气。',
          explanation: '开篇使用机械套话。', patchHint: '用具体动作和环境阻力替换。',
        },
        {
          issueType: 'style-slop', issueSubtype: 'tell-dont-show', severity: 'major',
          snippet: '他深吸一口气，心中暗涌翻腾，目光中闪过一丝挣扎。',
          explanation: '情绪直接说明，缺少可观察动作。', patchHint: '改为人物动作与触觉。',
        },
        {
          issueType: 'style-slop', issueSubtype: 'exposition-dump', severity: 'major',
          snippet: '因为原因在于他不得不说，这意味着他将失去一切。',
          explanation: '因果表达冗余。', patchHint: '写清具体损失。',
        },
      ],
      sceneChecks: [],
      surgerySuggestions: ['只修正定位到的三个句段。'],
    };
  }
  if (sampleId === 'action-weak') {
    return {
      score: 60,
      fatalIssues: [
        {
          issueType: 'action-chain', issueSubtype: 'weak-action-chain', severity: 'major',
          snippet: '作品：潮汐城。\n\n“你真的要去吗？”李凡问。\n\n“去。”王强说。\n\n“为什么？”李凡问。',
          explanation: '对白缺少动作支点。', patchHint: '加入与冲突相关的动作。',
        },
        {
          issueType: 'action-chain', issueSubtype: 'dialogue-without-beat', severity: 'major',
          snippet: '“可是外面很危险，你一个人应付不过来。”李凡劝阻。\n\n“我知道，但我不在乎。”王强表明了决心。\n\n“既然你这么说，那随你吧。”李凡叹了口气。',
          explanation: '对话标签替代了人物反应。', patchHint: '用动作完成退场。',
        },
      ],
      sceneChecks: [],
      surgerySuggestions: ['补充对话动作链。'],
    };
  }
  return { score: 90, fatalIssues: [], sceneChecks: [], surgerySuggestions: [] };
}

function fallbackRewrite(sampleId: string, snippet: string, targetText: string): string {
  if (sampleId === 'slop-heavy') return HEAVY_SLOP_REWRITES[snippet] || HEAVY_SLOP_REWRITES[targetText] || targetText;
  if (sampleId === 'action-weak') return ACTION_WEAK_REWRITES[snippet] || ACTION_WEAK_REWRITES[targetText] || targetText;
  return targetText;
}

function inspectRawIssueContract(content: string): { present: boolean; rawIssueCount: number | null; violation: string | null } {
  const payload = parseBalancedJsonObject(content);
  if (!payload) return { present: false, rawIssueCount: null, violation: null };
  const rawIssues = payload.fatalIssues;
  if (rawIssues === undefined) return { present: false, rawIssueCount: null, violation: null };
  if (!Array.isArray(rawIssues)) return { present: true, rawIssueCount: null, violation: 'malformed_fatal_issues' };
  return { present: true, rawIssueCount: rawIssues.length, violation: null };
}

function inspectResponseShape(content: string): { shape: NonNullable<EvaluationCallRecord['responseShape']>; hasAuditKeys: boolean } {
  const trimmed = content.trim();
  if (!trimmed) return { shape: 'empty', hasAuditKeys: false };
  const hasAuditKeys = /(?:scores|totalScore|fatalIssues|surgerySuggestions|score|issues|critique)/i.test(trimmed);
  if (trimmed.startsWith('{')) return { shape: 'json-object', hasAuditKeys };
  if (trimmed.startsWith('[')) return { shape: 'json-array', hasAuditKeys };
  if (/^#{1,6}\s|```|^\*\*?/m.test(trimmed)) return { shape: 'markdown', hasAuditKeys };
  return { shape: 'plain-text', hasAuditKeys };
}

function parseAudit(content: string): AuditParseResult {
  const rawContract = inspectRawIssueContract(content);
  const responseShape = inspectResponseShape(content);
  const strictResponse = parseAuditResponseWithDiagnostics(content);
  const allowTolerantContractView = responseShape.shape === 'json-object' && (
    strictResponse.diagnostic?.code === 'missing_fatal_issues'
    || strictResponse.diagnostic?.code === 'filtered_fatal_issue'
    // Preserve the legacy low-score empty-issues diagnostic, but never
    // accept a strict invalid_json response that supplied issue entries.
    || (strictResponse.diagnostic?.code === 'invalid_json'
      && (rawContract.rawIssueCount === 0 || Boolean(parseAuditFiveDim(content))))
  );
  const fiveDim = strictResponse.fiveDim
    || (allowTolerantContractView
      ? parseAuditFiveDim(content) : null);
  if (fiveDim) {
    const structured = convertFiveDimToStructured(fiveDim);
    const hardFail = fiveDim.totalScore < 30
      || Object.values(fiveDim.scores).some((entry) => entry.score < 4)
      || fiveDim.pass === false;
    const contractViolation = rawContract.violation
      || (!rawContract.present && hardFail ? 'missing_fatal_issues' : null)
      || (rawContract.rawIssueCount === 0 && hardFail ? 'missing_fatal_issues' : null)
      || (rawContract.rawIssueCount !== null && rawContract.rawIssueCount > 0 && structured.fatalIssues.length === 0 ? 'malformed_fatal_issue' : null)
      || (fiveDim.pass && hardFail ? 'pass_score_mismatch' : null);
    const finalContractViolation = contractViolation
      || (strictResponse.diagnostic?.code === 'invalid_json' ? 'invalid_json' : null);
    return {
      structured,
      parseMode: 'five-dim',
      contractViolation: finalContractViolation,
      rawOutputChars: content.length,
      rawIssueCount: rawContract.rawIssueCount,
      normalizedIssueCount: structured.fatalIssues.length,
      responseShape: responseShape.shape,
      hasAuditKeys: responseShape.hasAuditKeys,
      diagnosticCode: strictResponse.diagnostic?.code,
      diagnosticSummary: strictResponse.diagnostic?.summary,
    };
  }
  const structured = strictResponse.structured
    || (allowTolerantContractView
      ? parseStructuredAuditResponse(content) : null);
  if (structured) {
    const hardFail = structured.score < 60;
    const contractViolation = rawContract.violation
      || (!rawContract.present && hardFail ? 'missing_fatal_issues' : null)
      || (rawContract.rawIssueCount === 0 && hardFail ? 'missing_fatal_issues' : null)
      || (rawContract.rawIssueCount !== null && rawContract.rawIssueCount > 0 && structured.fatalIssues.length === 0 ? 'malformed_fatal_issue' : null);
    const finalContractViolation = contractViolation
      || (strictResponse.diagnostic?.code === 'invalid_json' ? 'invalid_json' : null);
    return {
      structured,
      parseMode: 'structured',
      contractViolation: finalContractViolation,
      rawOutputChars: content.length,
      rawIssueCount: rawContract.rawIssueCount,
      normalizedIssueCount: structured.fatalIssues.length,
      responseShape: responseShape.shape,
      hasAuditKeys: responseShape.hasAuditKeys,
      diagnosticCode: strictResponse.diagnostic?.code,
      diagnosticSummary: strictResponse.diagnostic?.summary,
    };
  }
  const diagnostic = parseAuditResponseWithDiagnostics(content).diagnostic;
  const inferred = {
    score: 0,
    fatalIssues: [],
    sceneChecks: [],
    surgerySuggestions: [],
  };
  return {
    structured: inferred,
    parseMode: 'unparseable',
    contractViolation: diagnostic?.legacyCode || 'audit_response_unparseable',
    rawOutputChars: content.length,
    rawIssueCount: null,
    normalizedIssueCount: inferred.fatalIssues.length,
    responseShape: responseShape.shape,
    hasAuditKeys: responseShape.hasAuditKeys,
    diagnosticCode: diagnostic?.code,
    diagnosticSummary: diagnostic?.summary,
  };
}

export function parseAuditForEvaluation(content: string, inputHasExpectedDefect = true): AuditParseResult {
  void inputHasExpectedDefect;
  return parseAudit(content);
}

async function executeCall(input: {
  mode: 'deterministic' | 'live-only';
  config: AppConfig;
  sample: ChapterFixture;
  phase: EvaluationPhase;
  prompt: string;
  fallback: () => string;
  generateText: EvaluationGenerateText;
}): Promise<CallOutcome> {
  const startedAt = Date.now();
  const baseRecord: Omit<EvaluationCallRecord, 'status' | 'durationMs' | 'errorCode'> = {
    phase: input.phase,
    sample: input.sample.id,
    qualityFindings: [],
    inputHasExpectedDefect: input.sample.inputHasExpectedDefect,
    defectDetected: false,
    rewriteChangedText: false,
    rewriteIntroducedP0P1: false,
  };

  if (input.mode === 'deterministic') {
    return {
      content: input.fallback(),
      record: { ...baseRecord, status: 'FALLBACK', errorCode: null, durationMs: Date.now() - startedAt },
    };
  }

  try {
    const content = await input.generateText(input.config, {
      prompt: isAuditPhase(input.phase)
        ? input.prompt + AUDIT_OUTPUT_CONTRACT
        : input.prompt,
      timeoutMs: 90_000,
      maxAttempts: isAuditPhase(input.phase) ? 1 : 2,
      disableThinking: true,
      ...(isAuditPhase(input.phase)
        ? { outputMode: 'audit-json' as const, responseMimeType: 'application/json' }
        : {}),
    });
    if (!content.trim()) throw new Error('empty response');
    return {
      content,
      record: { ...baseRecord, status: 'LIVE', errorCode: null, durationMs: Date.now() - startedAt },
    };
  } catch (error) {
    return {
      content: null,
      record: {
        ...baseRecord,
        status: 'LIVE',
        errorCode: classifyProviderSmokeError(error),
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

function replaceTarget(
  content: string,
  target: string,
  replacement: string,
  authorization?: { expectedStart: number },
): { content: string; changed: boolean; unauthorized: boolean } {
  const expectedStart = authorization?.expectedStart;
  const expectedMatches = expectedStart !== undefined
    && content.slice(expectedStart, expectedStart + target.length) === target;
  const index = expectedMatches ? expectedStart : content.indexOf(target);
  if (index < 0 || replacement === target) return { content, changed: false, unauthorized: false };
  return {
    content: `${content.slice(0, index)}${replacement}${content.slice(index + target.length)}`,
    changed: true,
    unauthorized: Boolean(authorization && !expectedMatches),
  };
}

export async function evaluateChapter(
  fixture: ChapterFixture,
  mode: 'deterministic' | 'live-only',
  config: AppConfig,
  options: ProviderEvaluationOptions = {},
): Promise<{ sample: EvaluationSampleResult; calls: EvaluationCallRecord[] }> {
  const generate = options.generateText || generateText;
  const startedAt = Date.now();
  const calls: EvaluationCallRecord[] = [];
  const originalContent = fs.readFileSync(path.join(FIXTURES_DIR, fixture.file), 'utf8').trim();
  const originalQuality = validateDraftQuality(originalContent);
  const expectedP0Codes = originalQuality.findings
    .filter((finding) => finding.severity === 'P0' && fixture.expectedP0P1Codes.includes(finding.code))
    .map((finding) => finding.code);
  const promptAsset = resolvePromptAssetForSurface({
    surface: 'chapter-polish',
    promptTemplates: config.promptTemplates,
    preferredTemplateKey: 'manualAudit',
  });
  const auditPrompt = renderPromptTemplate(promptAsset.template, {
    contextStr: '整体大纲与背景：长篇小说。',
    skillsInfo: '',
    sceneBeats: '本节分镜要求：角色面对重要决断。',
    draftContent: originalContent,
  });
  const auditPromptWithResidueContract = auditPrompt + buildAuditResidueContract(originalContent);
  let auditOutcome = await executeCall({
    mode,
    config,
    sample: fixture,
    phase: 'audit',
    prompt: auditPromptWithResidueContract,
    fallback: () => JSON.stringify(fallbackAudit(fixture.id)),
    generateText: generate,
  });
  calls.push(auditOutcome.record);

  if (!auditOutcome.content) {
    return {
      calls,
      sample: {
        id: fixture.id, file: fixture.file, label: fixture.label, status: mode === 'live-only' ? 'LIVE' : 'FALLBACK',
        errorCode: auditOutcome.record.errorCode, durationMs: Date.now() - startedAt,
        qualityFindings: originalQuality.findings.map((finding) => finding.code), expectedP0Codes,
        inputHasExpectedDefect: fixture.inputHasExpectedDefect, defectDetected: false, candidateProduced: false,
        rewriteChangedText: false, rewriteIntroducedP0P1: false, unauthorizedRewrite: false,
        appliedCount: 0, accepted: false,
      },
    };
  }

  const parsedAudit = parseAudit(auditOutcome.content);
  let structured = parsedAudit.structured;
  auditOutcome.record.parseMode = parsedAudit.parseMode;
  auditOutcome.record.contractViolation = parsedAudit.contractViolation;
  auditOutcome.record.rawOutputChars = parsedAudit.rawOutputChars;
  auditOutcome.record.rawIssueCount = parsedAudit.rawIssueCount;
  auditOutcome.record.normalizedIssueCount = parsedAudit.normalizedIssueCount;
  auditOutcome.record.responseShape = parsedAudit.responseShape;
  auditOutcome.record.hasAuditKeys = parsedAudit.hasAuditKeys;
  recordAuditIssueCategories(auditOutcome.record, structured);
  auditOutcome.record.diagnosticCode = parsedAudit.diagnosticCode;
  auditOutcome.record.diagnosticSummary = parsedAudit.diagnosticSummary;
  const residueCovered = auditCoversResidueSnippets(originalContent, structured.fatalIssues);
  let contractViolation = parsedAudit.contractViolation || (residueCovered ? null : 'missing_fatal_issues');
  if (!residueCovered && !auditOutcome.record.diagnosticCode) {
    auditOutcome.record.diagnosticCode = 'missing_fatal_issues';
    auditOutcome.record.diagnosticSummary = '正文残留未被 fatalIssues 覆盖';
  }
  if (shouldRetryAuditResponse(mode, 'audit', Boolean(auditOutcome.content), contractViolation)) {
    const retryOutcome = await executeCall({
      mode,
      config,
      sample: fixture,
      phase: 'audit-retry',
      prompt: `${auditPromptWithResidueContract}${STRICT_AUDIT_RETRY_INSTRUCTION}`,
      fallback: () => JSON.stringify(fallbackAudit(fixture.id)),
      generateText: generate,
    });
    calls.push(retryOutcome.record);
    if (retryOutcome.content) {
      const retryParsedAudit = parseAudit(retryOutcome.content);
      const retryStructured = retryParsedAudit.structured;
      retryOutcome.record.parseMode = retryParsedAudit.parseMode;
      retryOutcome.record.contractViolation = retryParsedAudit.contractViolation;
      retryOutcome.record.rawOutputChars = retryParsedAudit.rawOutputChars;
      retryOutcome.record.rawIssueCount = retryParsedAudit.rawIssueCount;
      retryOutcome.record.normalizedIssueCount = retryParsedAudit.normalizedIssueCount;
      retryOutcome.record.responseShape = retryParsedAudit.responseShape;
      retryOutcome.record.hasAuditKeys = retryParsedAudit.hasAuditKeys;
      recordAuditIssueCategories(retryOutcome.record, retryStructured);
      retryOutcome.record.diagnosticCode = retryParsedAudit.diagnosticCode;
      retryOutcome.record.diagnosticSummary = retryParsedAudit.diagnosticSummary;
      const retryResidueCovered = auditCoversResidueSnippets(originalContent, retryStructured.fatalIssues);
      const retryContractViolation = retryParsedAudit.contractViolation
        || (retryResidueCovered ? null : 'missing_fatal_issues');
      if (!retryResidueCovered && !retryOutcome.record.diagnosticCode) {
        retryOutcome.record.diagnosticCode = 'missing_fatal_issues';
        retryOutcome.record.diagnosticSummary = '正文残留未被 fatalIssues 覆盖';
      }
      retryOutcome.record.contractViolation = retryContractViolation;
      auditOutcome = retryOutcome;
      structured = retryStructured;
      contractViolation = retryContractViolation;
    } else {
      auditOutcome = retryOutcome;
      contractViolation = retryOutcome.record.errorCode || contractViolation;
    }
  }
  const defectDetected = !contractViolation && structured.fatalIssues.length > 0;
  auditOutcome.record.defectDetected = defectDetected;
  auditOutcome.record.contractViolation = contractViolation;
  let firstError: string | null = contractViolation;
  let repairedContent = originalContent;
  let appliedCount = 0;
  let unauthorizedRewrite = false;
  const appliedPatches: Array<{ start: number; delta: number }> = [];

  if (fixture.allowRewrite && !(mode === 'live-only' && contractViolation)) {
    const targets = selectRewriteTargetsForPatch(
      originalContent,
      structured.fatalIssues.map((issue) => issue.snippet),
      3,
    );
    for (const target of targets) {
      const rewritePrompt = buildRewritePrompt({
        text: target.window.targetText,
        mode: 'surgical-patch',
        beforeContext: target.window.beforeContext,
        afterContext: target.window.afterContext,
        auditIssue: target.snippet,
        contextStr: '长篇中文小说，只改定位片段。',
      });
      const outcome = await executeCall({
        mode,
        config,
        sample: fixture,
        phase: 'rewrite',
        prompt: rewritePrompt,
        fallback: () => fallbackRewrite(fixture.id, target.snippet, target.window.targetText),
        generateText: generate,
      });
      if (!outcome.content) {
        firstError ||= outcome.record.errorCode;
        calls.push(outcome.record);
        continue;
      }
      const replacement = outcome.content.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
      const replacementQuality = validateDraftQuality(replacement);
      const replacementHardCodes = replacementQuality.findings
        .filter((finding) => finding.severity === 'P0' || finding.severity === 'P1')
        .map((finding) => finding.code);
      const priorDelta = appliedPatches
        .filter((patch) => patch.start < target.window.start)
        .reduce((total, patch) => total + patch.delta, 0);
      const replaced = replaceTarget(repairedContent, target.window.targetText, replacement, {
        expectedStart: target.window.start + priorDelta,
      });
      outcome.record.qualityFindings = replacementQuality.findings.map((finding) => finding.code);
      outcome.record.rewriteChangedText = replaced.changed;
      outcome.record.rewriteIntroducedP0P1 = replacementHardCodes.length > 0;
      calls.push(outcome.record);
      repairedContent = replaced.content;
      unauthorizedRewrite ||= replaced.unauthorized;
      if (replaced.changed) {
        appliedCount += 1;
        appliedPatches.push({
          start: target.window.start,
          delta: replacement.length - target.window.targetText.length,
        });
      }
    }
  }

  const candidateProduced = appliedCount > 0;
  let reAuditHasIssues = false;
  if (candidateProduced) {
    const reAuditPrompt = renderPromptTemplate(promptAsset.template, {
      contextStr: '整体大纲与背景：长篇小说。',
      skillsInfo: '',
      sceneBeats: '复核精修后的章节，只返回审稿结构，不要重写正文。只报告仍存在且能被正文原文证实的问题；已修复的句子不要重复，也不要把主观偏好扩写成新的硬伤。',
      draftContent: repairedContent,
    });
    const reAuditPromptWithResidueContract = reAuditPrompt + buildAuditResidueContract(repairedContent);
    let reAuditOutcome = await executeCall({
      mode,
      config,
      sample: fixture,
      phase: 're-audit',
      prompt: reAuditPromptWithResidueContract,
      fallback: () => JSON.stringify({ score: 90, fatalIssues: [], sceneChecks: [], surgerySuggestions: [] }),
      generateText: generate,
    });
    calls.push(reAuditOutcome.record);
    if (reAuditOutcome.content) {
      const parsedReAudit = parseAudit(reAuditOutcome.content);
      let reAudit = parsedReAudit.structured;
      reAuditOutcome.record.parseMode = parsedReAudit.parseMode;
      reAuditOutcome.record.contractViolation = parsedReAudit.contractViolation;
      reAuditOutcome.record.rawOutputChars = parsedReAudit.rawOutputChars;
      reAuditOutcome.record.rawIssueCount = parsedReAudit.rawIssueCount;
      reAuditOutcome.record.normalizedIssueCount = parsedReAudit.normalizedIssueCount;
      reAuditOutcome.record.responseShape = parsedReAudit.responseShape;
      reAuditOutcome.record.hasAuditKeys = parsedReAudit.hasAuditKeys;
      recordAuditIssueCategories(reAuditOutcome.record, reAudit);
      reAuditOutcome.record.diagnosticCode = parsedReAudit.diagnosticCode;
      reAuditOutcome.record.diagnosticSummary = parsedReAudit.diagnosticSummary;
      const reAuditResidueCovered = auditCoversResidueSnippets(repairedContent, reAudit.fatalIssues);
      let reAuditContractViolation = parsedReAudit.contractViolation || (reAuditResidueCovered ? null : 'missing_fatal_issues');
      if (!reAuditResidueCovered && !reAuditOutcome.record.diagnosticCode) {
        reAuditOutcome.record.diagnosticCode = 'missing_fatal_issues';
        reAuditOutcome.record.diagnosticSummary = '正文残留未被 fatalIssues 覆盖';
      }
      if (shouldRetryAuditResponse(mode, 're-audit', Boolean(reAuditOutcome.content), reAuditContractViolation)) {
        const retryOutcome = await executeCall({
          mode,
          config,
          sample: fixture,
          phase: 're-audit-retry',
          prompt: `${reAuditPromptWithResidueContract}${STRICT_AUDIT_RETRY_INSTRUCTION}`,
          fallback: () => JSON.stringify({ score: 90, fatalIssues: [], sceneChecks: [], surgerySuggestions: [] }),
          generateText: generate,
        });
        calls.push(retryOutcome.record);
        if (retryOutcome.content) {
          const retryParsedReAudit = parseAudit(retryOutcome.content);
          const retryReAudit = retryParsedReAudit.structured;
          retryOutcome.record.parseMode = retryParsedReAudit.parseMode;
          retryOutcome.record.contractViolation = retryParsedReAudit.contractViolation;
          retryOutcome.record.rawOutputChars = retryParsedReAudit.rawOutputChars;
          retryOutcome.record.rawIssueCount = retryParsedReAudit.rawIssueCount;
          retryOutcome.record.normalizedIssueCount = retryParsedReAudit.normalizedIssueCount;
          retryOutcome.record.responseShape = retryParsedReAudit.responseShape;
          retryOutcome.record.hasAuditKeys = retryParsedReAudit.hasAuditKeys;
          recordAuditIssueCategories(retryOutcome.record, retryReAudit);
          retryOutcome.record.diagnosticCode = retryParsedReAudit.diagnosticCode;
          retryOutcome.record.diagnosticSummary = retryParsedReAudit.diagnosticSummary;
          const retryReAuditResidueCovered = auditCoversResidueSnippets(repairedContent, retryReAudit.fatalIssues);
          const retryReAuditContractViolation = retryParsedReAudit.contractViolation
            || (retryReAuditResidueCovered ? null : 'missing_fatal_issues');
          if (!retryReAuditResidueCovered && !retryOutcome.record.diagnosticCode) {
            retryOutcome.record.diagnosticCode = 'missing_fatal_issues';
            retryOutcome.record.diagnosticSummary = '正文残留未被 fatalIssues 覆盖';
          }
          retryOutcome.record.contractViolation = retryReAuditContractViolation;
          reAuditOutcome = retryOutcome;
          reAudit = retryReAudit;
          reAuditContractViolation = retryReAuditContractViolation;
        } else {
          reAuditOutcome = retryOutcome;
          reAuditContractViolation = retryOutcome.record.errorCode || reAuditContractViolation;
        }
      }
      reAuditOutcome.record.contractViolation = reAuditContractViolation;
      reAuditHasIssues = !reAuditContractViolation && reAudit.fatalIssues.length > 0;
      reAuditOutcome.record.defectDetected = reAuditHasIssues;
      firstError ||= reAuditContractViolation;
    } else {
      firstError ||= reAuditOutcome.record.errorCode;
    }
  }
  const finalQuality = validateDraftQuality(repairedContent);
  const finalHardCodes = hardFindingCodes(repairedContent);
  const rewriteChangedText = repairedContent !== originalContent;
  const rewriteIntroducedP0P1 = finalHardCodes.some((code) => !hardFindingCodes(originalContent).includes(code));
  const expectationFailed = (fixture.requiresChange && appliedCount < fixture.minimumAppliedPatches)
    || (!fixture.allowRewrite && candidateProduced)
    || (fixture.inputHasExpectedDefect && !defectDetected)
    || (!fixture.inputHasExpectedDefect && defectDetected);
  const accepted = candidateProduced && finalQuality.ok && !rewriteIntroducedP0P1
    && !unauthorizedRewrite && !reAuditHasIssues && !expectationFailed && !firstError;
  const qualityMismatch = candidateProduced && !accepted;

  return {
    calls,
    sample: {
      id: fixture.id,
      file: fixture.file,
      label: fixture.label,
      status: mode === 'live-only' ? 'LIVE' : 'FALLBACK',
      errorCode: firstError || (expectationFailed || qualityMismatch ? 'quality_mismatch' : null),
      durationMs: Date.now() - startedAt,
      qualityFindings: finalQuality.findings.map((finding) => finding.code),
      expectedP0Codes,
      inputHasExpectedDefect: fixture.inputHasExpectedDefect,
      defectDetected,
      candidateProduced,
      rewriteChangedText,
      rewriteIntroducedP0P1,
      unauthorizedRewrite,
      appliedCount,
      accepted,
    },
  };
}

function skippedSample(fixture: ChapterFixture): EvaluationSampleResult {
  return {
    id: fixture.id, file: fixture.file, label: fixture.label, status: 'SKIP',
    errorCode: 'credentials_missing', durationMs: 0, qualityFindings: [], expectedP0Codes: [],
    inputHasExpectedDefect: fixture.inputHasExpectedDefect, defectDetected: false,
    candidateProduced: false, rewriteChangedText: false, rewriteIntroducedP0P1: false,
    unauthorizedRewrite: false, appliedCount: 0, accepted: false,
  };
}

function skippedCall(fixture: ChapterFixture): EvaluationCallRecord {
  return {
    status: 'SKIP', phase: 'audit', sample: fixture.id, errorCode: 'credentials_missing', durationMs: 0,
    qualityFindings: [], inputHasExpectedDefect: fixture.inputHasExpectedDefect,
    defectDetected: false, rewriteChangedText: false, rewriteIntroducedP0P1: false,
  };
}

function formatRate(rate: MetricRate): string {
  return rate.value === null ? `null (${rate.numerator}/${rate.denominator})` : `${(rate.value * 100).toFixed(1)}% (${rate.numerator}/${rate.denominator})`;
}

function writeReport(report: EvaluationReport): void {
  fs.writeFileSync(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  const sampleRows = report.samples.map((sample) => (
    `| ${sample.id} | ${sample.status} | ${sample.errorCode || '-'} | ${sample.qualityFindings.join(', ') || '-'} | ${sample.defectDetected ? 'yes' : 'no'} | ${sample.candidateProduced ? 'yes' : 'no'} | ${sample.accepted ? 'yes' : 'no'} |`
  )).join('\n');
  const callRows = report.calls.map((call) => {
    const diagnosticSummary = call.diagnosticSummary
      ? call.diagnosticSummary.slice(0, 120).replace(/\|/g, '\\|')
      : '-';
    const issueCategories = [...(call.issueTypes || []), ...(call.issueSubtypes || [])].join(', ') || '-';
    return `| ${call.sample} | ${call.phase} | ${call.status} | ${call.errorCode || '-'} | ${call.parseMode || '-'} | ${call.contractViolation || '-'} | ${call.diagnosticCode || '-'} | ${diagnosticSummary} | ${issueCategories} | ${call.responseShape || '-'} | ${call.hasAuditKeys ? 'yes' : 'no'} | ${call.normalizedIssueCount ?? '-'} | ${call.durationMs} |`;
  }).join('\n');
  const markdown = `# InkFlow Provider 文学质量评测报告

- 模式：\`${report.mode}\`
- 总体状态：\`${report.overallStatus}\`
- 模型配置：\`${report.modelConfigured ? 'configured' : 'missing'}\`
- 生成时间：\`${report.generatedAt}\`

## 样本

| 样本 | 状态 | 错误码 | 质量 finding codes | 检出缺陷 | 生成候选 | 可接受 |
|---|---|---|---|---|---|---|
${sampleRows}

## 指标

| 指标 | 结果 |
|---|---|
| P0 escape rate | ${formatRate(report.metrics.p0EscapeRate)} |
| P1 miss rate | ${formatRate(report.metrics.p1MissRate)} |
| polish acceptance rate | ${formatRate(report.metrics.polishAcceptanceRate)} |
| harmful rewrite rate | ${formatRate(report.metrics.harmfulRewriteRate)} |

分母为 0 时结果为 \`null\`，不将无样本伪装成 0% 或 100%。FALLBACK 仅验证本地合同，不代表真实 Provider 质量。

## 调用明细

| 样本 | 阶段 | 状态 | 错误码 | 解析模式 | 契约问题 | 诊断码 | 诊断摘要 | 问题类别 | 响应形状 | 含审稿键 | 规范化问题数 | 耗时 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${callRows || '| - | - | - | - | - | - | - | - | - | - | - | 0 | 0 |'}
`;
  fs.writeFileSync(MARKDOWN_REPORT_PATH, markdown);
}

export async function runChapterProviderEvaluation(
  mode: 'deterministic' | 'live-only',
  options: ProviderEvaluationOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const fixture = loadEvaluationFixture();
  const config = getConfig();
  const contractCases = evaluateContractCases(fixture);
  const contractFailed = contractCases.some((item) => (
    item.actualOk !== item.expectedOk || item.expectedCodes.some((code) => !item.actualCodes.includes(code))
  ));
  const samples: EvaluationSampleResult[] = [];
  const calls: EvaluationCallRecord[] = [];

  if (mode === 'live-only' && !config.apiKey) {
    for (const chapter of fixture.chapters) {
      samples.push(skippedSample(chapter));
      calls.push(skippedCall(chapter));
    }
    const report: EvaluationReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      mode,
      overallStatus: 'SKIP',
      modelConfigured: false,
      samples,
      calls,
      contractCases,
      metrics: calculateEvaluationMetrics(samples, contractCases),
    };
    writeReport(report);
    process.stdout.write('SKIP: provider credentials not configured\n');
    return { exitCode: 0, report };
  }

  for (const chapter of fixture.chapters) {
    const result = await evaluateChapter(chapter, mode, config, options);
    samples.push(result.sample);
    calls.push(...result.calls);
    process.stdout.write(`${chapter.id}: ${result.sample.status} ${result.sample.errorCode || 'ok'}\n`);
  }

  const overallStatus: EvaluationStatus = mode === 'live-only' ? 'LIVE' : 'FALLBACK';
  const report: EvaluationReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    overallStatus,
    modelConfigured: Boolean(config.apiKey && config.model),
    samples,
    calls,
    contractCases,
    metrics: calculateEvaluationMetrics(samples, contractCases),
  };
  writeReport(report);
  const failed = contractFailed || samples.some((sample) => sample.errorCode !== null);
  process.stdout.write(`REPORT: ${overallStatus}; metrics=${JSON.stringify(report.metrics)}\n`);
  return { exitCode: failed ? 1 : 0, report };
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isMain) {
  const mode = process.argv.includes('--live-only') ? 'live-only' : 'deterministic';
  runChapterProviderEvaluation(mode)
    .then(({ exitCode }) => { process.exitCode = exitCode; })
    .catch(() => {
      process.stderr.write('FAIL: provider evaluation (request_failed)\n');
      process.exitCode = 1;
    });
}
