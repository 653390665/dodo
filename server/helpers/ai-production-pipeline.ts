import { appendFileSync } from 'node:fs';
import { governedGenerateText as generateText } from './governed-llm';
import { getConfig, type AppConfig } from '../lib/config';
import { logger } from '../logger';
import { resolvePromptAssetForSurface } from '../../shared/lib/prompt-runtime';
import {
  AUDIT_OUTPUT_CONTRACT,
  AUDIT_RESPONSE_SCHEMA,
  getPromptTemplate,
  renderPromptTemplate,
  wrapUserInput,
} from './prompt-helpers';
import {
  convertFiveDimToStructured,
  parseAuditResponseWithDiagnostics,
} from '../../shared/lib/audit-structured';
import {
  buildFallbackDraft,
  buildFallbackSceneBeats,
  ensureMinimumDraftLength,
} from './fallback-draft';
import type { LearnedPreference } from '../../shared/lib/preference-flywheel';
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from '../../shared/config/souls';
import {
  resolveEffectiveMinDraftChars,
  validateCompleteChapterDraftQuality,
} from '../../shared/lib/draft-quality';
import {
  loadChapterContract,
  loadForeshadowingContext,
  loadOutlineUnit,
  loadWorldviewHints,
} from './knowledge-lineage-enrich.js';

/** Maximum retries when critic rejects the draft */
const MAX_RETRIES = 2;
/** Score threshold (0-100) below which the critic triggers a retry */
const SCORE_THRESHOLD = 80;
export const UNKNOWN_CRITIC_FEEDBACK = '审稿结果不可验证，未完成结构化审阅，请重试。';

const REQUIRED_CRITIC_EVIDENCE = [
  'scene_execution',
  'character_state',
  'hard_canon',
  'foreshadowing',
] as const;

/** 缺失的证据类别（unknown 归因日志只报类别名，不落 Provider 原文）。 */
function missingCriticEvidence(
  audit: ReturnType<typeof convertFiveDimToStructured>
): string[] {
  return REQUIRED_CRITIC_EVIDENCE.filter(
    (category) => !audit.evidence?.some((item) => item.category === category)
  );
}

function hasCompleteCriticEvidence(audit: ReturnType<typeof convertFiveDimToStructured>): boolean {
  return missingCriticEvidence(audit).length === 0;
}

export function classifyCriticFeedback(
  feedback: string,
  available = true
): { status: 'pass' | 'fail' | 'unknown'; score?: number } {
  if (!available || typeof feedback !== 'string') return { status: 'unknown' };
  const parsed = parseAuditResponseWithDiagnostics(feedback);
  if (parsed.diagnostic) return { status: 'unknown' };

  if (parsed.fiveDim) {
    const score = Math.round((parsed.fiveDim.totalScore / 50) * 100);
    const structured = convertFiveDimToStructured(parsed.fiveDim);
    if (parsed.fiveDim.pass && score >= SCORE_THRESHOLD && !hasCompleteCriticEvidence(structured)) {
      logger.warn('Critic audit unknown: incomplete evidence (five-dim)', {
        path: 'five-dim',
        score,
        missingEvidence: missingCriticEvidence(structured),
      });
      return { status: 'unknown' };
    }
    return { status: parsed.fiveDim.pass && score >= SCORE_THRESHOLD ? 'pass' : 'fail', score };
  }

  if (
    !parsed.structured ||
    !Number.isFinite(parsed.structured.score) ||
    parsed.structured.score < 0 ||
    parsed.structured.score > 100
  ) {
    logger.warn('Critic audit unknown: unusable structured score', {
      path: 'structured',
      hasStructured: Boolean(parsed.structured),
    });
    return { status: 'unknown' };
  }
  const score = Math.round(parsed.structured.score);
  const hasCriticalIssue = parsed.structured.fatalIssues.some(
    (issue) => issue.severity === 'critical'
  );
  if (
    score >= SCORE_THRESHOLD &&
    !hasCriticalIssue &&
    !hasCompleteCriticEvidence(parsed.structured)
  ) {
    logger.warn('Critic audit unknown: incomplete evidence (structured)', {
      path: 'structured',
      score,
      missingEvidence: missingCriticEvidence(parsed.structured),
    });
    return { status: 'unknown' };
  }
  return { status: score >= SCORE_THRESHOLD && !hasCriticalIssue ? 'pass' : 'fail', score };
}

/**
 * Plan 261 修复③：把 critic 的结构化审计 JSON 蒸馏成 writer 能执行的纯文本重写指令。
 * 原始 JSON 直接回注时，flash 模型会复述审计里的结构化引用（场景标题、字段名、箭头），
 * 产出"元数据汤"而非正文（run 6b941a03 实测：attempt2/3 可读性 1-2 分）。
 * 解析失败时原样返回（可能本来就是纯文本/unknown 文案）。
 */
export function buildCriticRetryFeedback(rawFeedback: string): string {
  const parsed = parseAuditResponseWithDiagnostics(rawFeedback);
  if (parsed.diagnostic || (!parsed.fiveDim && !parsed.structured)) return rawFeedback;

  const lines: string[] = [
    '【重写指令】上一稿未通过审稿。请重写整章为一遍干净的叙事正文：禁止输出大纲、场景标题、人物表、字段名、箭头（→）、省略号连写或任何结构化内容；禁止复述本段审计意见；保持人物与剧情连续，把每个场景写成可读的故事。',
  ];
  if (parsed.fiveDim) {
    lines.push(`上一稿总分：${parsed.fiveDim.totalScore}/50。`);
    for (const [dim, item] of Object.entries(parsed.fiveDim.scores)) {
      if (item?.reason) lines.push(`- ${dim}（${item.score}/10）：${item.reason}`);
    }
    if (parsed.fiveDim.failReason) lines.push(`- 未过审原因：${parsed.fiveDim.failReason}`);
  } else if (parsed.structured) {
    lines.push(`上一稿总分：${parsed.structured.score}/100。`);
    for (const issue of parsed.structured.fatalIssues.slice(0, 6)) {
      const where = issue.snippet ? `原文「${issue.snippet.slice(0, 60)}」` : '';
      lines.push(`- [${issue.severity}] ${where}${issue.explanation}；修法：${issue.patchHint}`);
    }
  }
  const suggestions = parsed.fiveDim?.surgerySuggestions ?? [];
  for (const suggestion of suggestions.slice(0, 4)) {
    if (typeof suggestion === 'string' && suggestion.trim()) lines.push(`- 修改建议：${suggestion}`);
  }
  return lines.join('\n');
}

export interface PipelineProgress {
  onPhase?: (phase: 'planner' | 'writer' | 'critic' | 'retry') => void;
  onWriterToken?: (chunk: string) => void;
  onWriterDone?: () => void;
  onCriticDone?: (
    feedback: string,
    isValid: boolean,
    meta?: { status: 'pass' | 'fail' | 'unknown'; score?: number }
  ) => void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  sceneBeats: string;
  draft: string;
  audit: string;
  score?: number;
  auditStatus: 'pass' | 'fail' | 'unknown';
  /** Provider provenance. A deterministic fallback can never be a normal model apply. */
  source: 'model' | 'fallback';
  /** Whether the planner produced real beats or the deterministic template. */
  beatsSource: 'model' | 'fallback';
  attempts: number;
}

/**
 * Every writer attempt (and the deterministic fallback) failed the quality
 * gate. Carries the best model draft so the caller can still hand it to the
 * user as a clearly-labelled, override-gated preview instead of discarding
 * minutes of paid generation.
 */
export class DraftQualityRejectionError extends Error {
  readonly draft: string;
  readonly violations: string[];
  readonly mechanicalScore?: number;
  readonly beatsSource: 'model' | 'fallback';

  constructor(
    draft: string,
    violations: string[],
    mechanicalScore?: number,
    beatsSource: 'model' | 'fallback' = 'fallback'
  ) {
    super(`DRAFT_QUALITY_REJECTED:${violations.join('；')}`);
    this.name = 'DraftQualityRejectionError';
    this.draft = draft;
    this.violations = violations;
    this.mechanicalScore = mechanicalScore;
    this.beatsSource = beatsSource;
  }
}

// Stronger writer models (e.g. reasoning-heavy pro tiers) may need longer
// windows; tune via INKFLOW_WRITER_TIMEOUT_MS without a code change.
const WRITER_LLM_OPTIONS = {
  timeoutMs:
    Number(process.env.INKFLOW_WRITER_TIMEOUT_MS) > 0
      ? Number(process.env.INKFLOW_WRITER_TIMEOUT_MS)
      : 180_000,
  maxAttempts: 2,
  maxTokens: 8_192,
} as const;

// Per-scene budget for split-scene generation (scheme C): one scene is a few
// hundred characters, so a fraction of the whole-chapter budget suffices and
// slow upstreams can finish within the per-call window.
// Plan 260 后续：场景预算从 2400 提至 4096——11 张技法卡注入后单场景 prompt
// 变长，模型需要更多输出 token 才能完成场景叙事而不截断。
// Plan 261 修复⑰：单章目标 4000-6000 字——场景预算收敛到 1536
//（token 化比例随文本波动，实测 1536 tokens ≈ 2200-3400 字场景硬上限），
// 配合篇幅指令把整章压回目标区间并压缩输出成本（输出 token 是单章成本
// 的大头，4-8 元/百万）。
const WRITER_SCENE_MAX_TOKENS = 1536;
/** Minimum scene blocks for split generation; below this, single-shot the chapter. */
const MIN_SCENES_FOR_SPLIT = 2;

// Plan 261：输出纪律同时压两类已确诊失败——(1) 分镜元数据被复述进正文；
// (2) 单发全章时模型写完一遍不收笔，重开第二/第三版本（run 91f03710 实测
// "三个版本的追逐场景"，critic 直接给出 54 分）。
// Plan 261 修复⑪：硬设定红线——角色的认知状态/能力边界是既定事实
//（run R fatalIssue#2：设定"觉醒但未自知"却被写成主动观察），违反即废稿级。
const WRITER_OUTPUT_DISCIPLINE =
  '\n\n【输出纪律】只写一遍叙事正文，写完本章结尾立即停笔。禁止重写、续写或输出同一情节的多个版本。' +
  '正文中禁止出现设定说明、世界规则、角色介绍、场景标题、分镜指令或任何非故事内容的文字。' +
  '上下文中的背景信息仅供你理解世界，不要在正文中复述或解释。' +
  '【硬设定红线】上下文中的角色当前状态与世界规则是既定事实，正文不得与之冲突：' +
  '角色的认知状态（如"未自知""不知情"）、能力边界、已知与未知信息不可颠倒；' +
  '角色触碰设定边界的反应必须写成不自知、不可控、事后困惑，禁止让角色主动运用其尚未自觉的能力。' +
  '【篇幅控制】整章正文控制在约4000-6000字（含标点）：每个场景约800-1200字，' +
  '写完该场景立即转入下一场景，禁止在单个场景内超篇幅展开；宁短勿水，删掉不推动剧情的描写。';

/**
 * Plan 261 修复⑱：篇幅合同注入 planner——场景数 × 每场景字数 = 成稿长度。
 * 模板默认“3-5 个场景”会让 flash 顶格输出 5 场，叠加不守字数指令的 writer
 * 就是 1.4-1.9 万字失控稿（run R/AB 实测）。场景数收到 4 个，与 writer 端
 * 1,536 token 场景硬上限、4000-6000 字篇幅指令共同构成三级字数控制。
 */
const PLANNER_LENGTH_CONTRACT =
  '\n\n【篇幅合同】本章成稿目标 4000-6000 字。请设计 4 个场景分镜（不要输出 5 个），' +
  '每个场景承载约 1200 字正文；场景数量直接决定成稿长度，宁精勿多，合并可合并的场景。';

/**
 * Plan 261 修复⑳：从分镜的出场人物行提取本章卡司——知识图谱按卡司选择性
 * 调用（88 角色全量灌入每次调用会稀释注意力）。提取失败返回 undefined，
 * 回退全量图谱。
 */
function extractBeatCast(beats: string): string[] | undefined {
  const names: string[] = [];
  for (const m of String(beats || '').matchAll(/\*\*出场人物\*\*[：:](.+)/g)) {
    for (const name of m[1].split(/[、,，/]/)) {
      const cleaned = name.trim().replace(/（[^）]*）/g, '').trim();
      if (cleaned && cleaned.length <= 12 && !/^(?:无|待定)/.test(cleaned)) names.push(cleaned);
    }
  }
  return names.length > 0 ? [...new Set(names)] : undefined;
}

/**
 * Plan 261 修复④：planner 输出归一化。flash 会把 planner prompt 的格式模板
 * 原样回声——场景头带占位符「场景 N」、字段带「（≤20字）」字数约束
 * （run 5b206afb / run N 实测）。占位符让 splitSceneBeats 无法识别场景块，
 * 字数约束则会被保底草稿当提示句吸收。这里剥掉约束、按出现顺序重编号。
 */
/**
 * Plan 261 修复④：planner 输出归一化。flash 会把 planner prompt 的格式模板
 * 原样回声——场景头带占位符「场景 N」、字段带「（≤20字）」字数约束
 * （run 5b206afb / run N 实测）。占位符让 splitSceneBeats 无法识别场景块，
 * 字数约束则会被保底草稿当提示句吸收。这里剥掉约束、按出现顺序重编号。
 *
 * Plan 261 修复⑮（⑨ 的修正）：策划表格只发生在「最后一个场景块之后」——
 * 改为切掉最后一个场景块之后的尾部，而不是按行级标题开关过滤。⑨ 的行级
 * 过滤在 planner 场景头格式变化时（中文数字/粗体/无标题行）会把整个分镜
 * 剥成空串，writer 拿空分镜裸写（run W：model beats len=0，三 attempt 全崩）。
 * 空分镜比脏分镜更具破坏性：无法识别场景块时原文保留，绝不返回空。
 */
export function normalizePlannerBeats(beats: string): string {
  const stripped = String(beats || '')
    .replace(/（(?:≤|不超过\s*)[0-9]+\s*字）/g, '')
    .replace(/\((?:≤|不超过\s*)[0-9]+\s*字\)/g, '');

  // 找出所有场景块的起止（与 splitSceneBeats 同一判定）。
  const SCENE_HEADING = /^#{0,3}\s*\**\s*场景\s*(?:\d+|[NＮn]+)/;
  const lines = stripped.split('\n');
  const sceneStarts: number[] = [];
  lines.forEach((line, index) => {
    if (SCENE_HEADING.test(line.trim())) sceneStarts.push(index);
  });

  let kept = stripped;
  if (sceneStarts.length >= 1) {
    // 保留第一个场景块到末个场景块正文结束，只剥离末场景之后的「策划尾巴」
    //（节奏核验/伏笔清单/钩子选择表——以非场景小标题开头）。
    // 修正（2026-09-23 链路取证）：原实现切到「末个场景标题」为止，
    // 会把末场景正文一并丢弃（单场景输出甚至只剩一行标题）——writer 因此拿不到
    // 末场分镜，extractBeatCast 也漏掉只在末场出场的人物，图谱过滤随之失效。
    const lastStart = sceneStarts[sceneStarts.length - 1];
    let tailStart = lines.length;
    for (let index = lastStart + 1; index < lines.length; index += 1) {
      const trimmed = lines[index].trim();
      if (/^#{1,6}\s+\S/.test(trimmed) && !SCENE_HEADING.test(trimmed)) {
        tailStart = index;
        break;
      }
    }
    kept = lines.slice(sceneStarts[0], tailStart).join('\n').trimEnd();
  }

  let sceneNo = 0;
  return kept.replace(
    /(^|\n)(#{0,3}\s*\**\s*)场景\s*(?:[NＮn]+|[0-9]+)(\s*[：:，,])/g,
    (_match, newline: string, prefix: string, sep: string) => {
      sceneNo += 1;
      return `${newline}${prefix}场景 ${sceneNo}${sep}`;
    }
  );
}

/**
 * Split structured scene beats into per-scene blocks. Planner output uses
 * "## 场景 N" / "### 场景 N" headings (H2 observed from model planners,
 * H3 from buildFallbackSceneBeats); both must split or the writer silently
 * falls back to single-shot whole-chapter generation (Plan 261: that path is
 * where multi-take and metadata-echo degradation concentrate).
 * Returns an empty array when there are fewer than two scenes; callers then
 * keep the single-shot whole-chapter path.
 */
export function splitSceneBeats(beats: string): string[] {
  const blocks = String(beats || '')
    .split(/(?=^#{0,3}\s*\**\s*场景\s*\d+)/m)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && /^#{0,3}\s*\**\s*场景\s*\d+/.test(block));
  return blocks.length >= MIN_SCENES_FOR_SPLIT ? blocks : [];
}

/**
 * Scheme C+A: the writing stage may use a stronger model than the global one.
 * Precedence: INKFLOW_WRITER_MODEL env > config.writerModel > config.model.
 */
function resolveWriterConfig(base: AppConfig): AppConfig {
  const writerModel = process.env.INKFLOW_WRITER_MODEL?.trim() || base.writerModel?.trim() || '';
  return writerModel && writerModel !== base.model ? { ...base, model: writerModel } : base;
}

const CRITIC_LLM_OPTIONS = {
  // 2026-09-24：与 writer 对称，支持 INKFLOW_CRITIC_TIMEOUT_MS 覆盖。
  // 起因：走 CLIProxyAPI 的 Claude 在富上下文下 critique 需 35s+，被硬编码 35s
  // 掐断成 500 → auditStatus=unknown，这不是模型质量结论而是超时口径问题。
  timeoutMs:
    Number(process.env.INKFLOW_CRITIC_TIMEOUT_MS) > 0
      ? Number(process.env.INKFLOW_CRITIC_TIMEOUT_MS)
      : 35_000,
  maxAttempts: 2,
  // Structured audit JSON (scores, fatalIssues, surgerySuggestions) needs
  // headroom; reasoning-heavy models also burn tokens on chain-of-thought, so
  // a tight budget truncates the JSON mid-field (diagnosed 'truncated').
  // Plan 261：五维+证据契约在富上下文下 4000 tokens 会截断（run 5b206afb 两次
  // unknown），提到 6000 保证 JSON 完整闭合。
  maxTokens: 6000,
  disableThinking: true,
} as const;

// Plan 266 修复⑤：审稿重试必须升级参数。真机（gemini-3.8-flash-high 经 CLIProxyAPI）
// 在同一 run 里把 critic 打成两次 unknown：一次客户端 35s 超时（network/phase=request），
// 一次五维 JSON 未闭合（诊断 truncated，maxTokens 6000 仍不够）。原样重发只会复现同样的失败。
const CRITIC_RETRY_TOKEN_BOOST = 4000;
const CRITIC_MAX_TIMEOUT_MS = 120_000;
const CRITIC_RETRIABLE_CODES = new Set(['network', 'timeout', 'service_unavailable', 'rate_limit']);

/** 截断重试的压缩指令：契约字段一个都不能少，只压篇幅。 */
const CRITIC_RETRY_COMPACT_SUFFIX = [
  '',
  '### 重试输出要求（上一轮 JSON 超长/未闭合）',
  '在不省略任何契约字段的前提下压缩篇幅：五个维度的 reason 每条不超过 40 字；fatalIssues 最多 3 条，explanation 与 patchHint 各不超过 60 字；surgerySuggestions 最多 3 条、每条不超过 40 字；evidence 每个类别只保留 1 条，quote 不超过 60 字，explanation 与 suggestedFix 各不超过 40 字。',
].join('\n');

/** 证据补齐重试的指令：真机（run 334e123b）模型两次给出五维高分 PASS 却省略 evidence 数组，
 * classifyCriticFeedback 依约判 unknown（证据契约见 tests/critic-status-contract.test.ts）。
 * 放宽契约等于允许模型免证据盖章，因此这里只补要求、不降标准。 */
const CRITIC_RETRY_EVIDENCE_SUFFIX = [
  '',
  '### 重试输出要求（上一轮缺少 evidence 语义证据）',
  '本轮必须补齐 evidence 数组，并确保以下四个类别各至少一条：scene_execution、character_state、hard_canon、foreshadowing。',
  '每条 evidence 必须带 category、severity、quote（正文原文片段）、explanation、suggestedFix 五个字段；不得用空数组、null 或省略字段替代。',
  '五维 scores、totalScore、pass、failReason、fatalIssues、surgerySuggestions 仍须完整；在补齐证据的前提下尽量精简篇幅。',
].join('\n');

function isRetriableCriticError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CRITIC_RETRIABLE_CODES.has(code)) return true;
  if ((err as { retriable?: unknown } | null)?.retriable === true) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /timed out|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR_SOCKET|other side closed/i.test(message);
}

function criticErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error('Production pipeline aborted');
  error.name = 'AbortError';
  throw error;
}

const WRITER_RETRY_STYLE_RULE =
  '重写要求：段首句式必须多样化，禁止连续段落以相同词语或相同结构开头；避免套话与保底句式，用具体动作和细节推进情节。';

// Both the model draft and the deterministic fallback were unusable. Seed the
// next writer attempt with the violations instead of killing the whole run.
function buildWriterRetryFeedback(violations: string[]): string {
  const detail = violations.length ? `具体问题：${violations.join('；')}。` : '';
  return `【上一稿未通过质量门禁，请重写整章】${detail}${WRITER_RETRY_STYLE_RULE}`;
}

function truncateFeedback(message: string): string[] {
  return [message.slice(0, 200)];
}

// Plan 266 修复②：判定一次正文门失败是否只由局部软命中引起——这类失败应当带
// 定向反馈重写整章，而不是立刻丢弃整章换确定性保底稿（保底稿无法承载正文）。
function isRetriableWriterSoftFailure(quality: {
  findings?: Array<{ code?: string; severity?: string }>;
  mechanicalReview?: { status?: string };
}): boolean {
  if (quality.mechanicalReview?.status !== 'pass') return false;
  const findings = quality.findings || [];
  if (!findings.some((finding) => finding.code === 'literary-slop')) return false;
  return findings.every(
    (finding) => finding.severity === 'P2' || finding.code === 'literary-slop'
  );
}

function buildLiteraryRetryFeedback(quality: {
  violations?: string[];
  findings?: Array<{ evidence?: Array<string | { snippet?: string }> }>;
}): string {
  const snippets: string[] = [];
  for (const finding of quality.findings || []) {
    for (const entry of finding.evidence || []) {
      const snippet = typeof entry === 'string' ? entry : entry.snippet;
      if (snippet) snippets.push(snippet);
      if (snippets.length >= 6) break;
    }
    if (snippets.length >= 6) break;
  }
  const detail = snippets.length
    ? `需要改写的具体语句：${snippets.join(' / ')}。`
    : '';
  const problems = quality.violations?.length
    ? `具体问题：${quality.violations.join('；')}。`
    : '';
  return `【上一稿未通过正文质量门禁，请重写整章】${problems}${detail}${WRITER_RETRY_STYLE_RULE}`;
}

function buildValidatedFallbackDraft(
  sceneBeats: string,
  contextStr: string,
  minChars?: number
): string {
  const fallbackDraft = buildFallbackDraft(sceneBeats, contextStr, minChars);
  const quality = validateCompleteChapterDraftQuality(fallbackDraft, undefined, { minChars });
  if (!quality.ok) {
    throw new Error(`DRAFT_QUALITY_GATE_FAILED:${quality.violations.join('；')}`);
  }
  return fallbackDraft;
}

/**
 * Run Planner → Writer → Critic pipeline.
 * Planner generates scene beats from user intent.
 * Writer generates draft from beats + context.
 * Critic scores the draft; if below SCORE_THRESHOLD, loops back to Writer (max MAX_RETRIES).
 * If Planner or Writer fails, falls back to deterministic helpers.
 */
export async function runProductionPipeline(params: {
  novelId: string;
  chapterOrder?: number;
  userIntent: string;
  contextStr: string;
  stageContexts?: { planner: string; writer: string; critic: string };
  stagePrompts: { planner: string; writer: string; critic: string };
  learnedPreferences?: LearnedPreference[];
  progress?: PipelineProgress;
}): Promise<PipelineResult> {
  const {
    novelId,
    chapterOrder,
    userIntent,
    contextStr,
    stageContexts,
    stagePrompts,
    learnedPreferences = [],
    progress = {},
  } = params;
  const minDraftChars = resolveEffectiveMinDraftChars(userIntent);
  // Plan 261 Phase2：细纲权威合同 + 伏笔台账——planner 照合同展开分镜，
  // critic 拿红线/伏笔做核对清单（素材路由：细纲=任务书+核查清单）。
  const chapterContract = chapterOrder ? loadChapterContract(novelId, chapterOrder) : null;
  if (chapterContract) {
    logger.info('[pipeline] chapter contract loaded', { novelId, chapterNo: chapterContract.chapterNo });
  }

  // Plan 261 Phase4：已入库伏笔台账 → 生成期上下文（本章应埋 / 本章应回收 / 前文未回收）。
  // 这是 foreshadowings 表在生成链路上的唯一读点：此前它只被写入，planner/writer/critic
  // 各自重解析资料包，跨章伏笔状态从未参与生成。
  const foreshadowingContext = chapterOrder
    ? loadForeshadowingContext(novelId, chapterOrder)
    : null;
  const foreshadowingSuffix = foreshadowingContext?.promptBlock
    ? '\n\n' + foreshadowingContext.promptBlock
    : '';
  const foreshadowingChecklistSuffix = foreshadowingContext?.checklistBlock
    ? '\n\n' + foreshadowingContext.checklistBlock
    : '';

  // Build learned preference context
  const learnedContext =
    learnedPreferences.length > 0
      ? '\n\n【学习到的偏好 — 基于你之前的修改习惯】\n' +
        learnedPreferences
          .map((lp) => `- ${lp.pattern}（可信度：${Math.round(lp.confidence * 100)}%）`)
          .join('\n')
      : '';

  const augmentedContexts = {
    // Learned writing preferences belong to Writer/Critic. Planner should
    // receive only story facts and the current intent, otherwise style noise
    // can displace the chapter-level planning constraints.
    planner: stageContexts?.planner ?? contextStr,
    writer: (stageContexts?.writer ?? contextStr) + learnedContext,
    critic: (stageContexts?.critic ?? contextStr) + learnedContext,
  };

  // ================================================================
  // Phase 1: Planner — generate scene beats from user intent
  // ================================================================
  progress.onPhase?.('planner');

  const plannerAsset = resolvePromptAssetForSurface({
    surface: 'workspace-beats',
    promptTemplates: getConfig().promptTemplates,
    preferredTemplateKey: 'editorAgent',
  });

  let plannerPrompt = renderPromptTemplate(plannerAsset.template, {
    PLANNER_SOUL,
    contextStr: augmentedContexts.planner,
    skillsInfo: stagePrompts.planner,
    userIntent: wrapUserInput(userIntent),
  }) + PLANNER_LENGTH_CONTRACT + (chapterContract ? '\n\n' + chapterContract.contractText : '') + foreshadowingSuffix;
  const outlineUnit = chapterOrder ? loadOutlineUnit(novelId, chapterOrder) : null;
  if (outlineUnit) {
    plannerPrompt += '\n\n【大纲定位】本章位于 ' + outlineUnit.unitLine + '。本章及相邻章节的大纲要点：\n' + outlineUnit.unitSummary;
  }

  let sceneBeats: string;
  let beatsSource: PipelineResult['beatsSource'];
  try {
    sceneBeats = await generateText(
      getConfig(),
      {
        prompt: plannerPrompt,
        // Plan 261：8s 对 flash+富上下文（技法卡/资料包注入后）几乎必超时，
        // 超时即静默降级到无故事细节的模板分镜，writer 随之产出多版本拼接稿。
        // 规划是全章骨架，预算对齐 writer 量级并允许一次重试。
        timeoutMs: 45_000,
        maxAttempts: 2,
        // Planner beats are structure, not prose: pin thinking off and give the
        // budget headroom so reasoning-heavy models don't burn it on
        // chain-of-thought and truncate the scene breakdown.
        maxTokens: 2400,
        disableThinking: true,
        signal: progress.signal,
        novelId,
      },
      {
        operation: 'production-pipeline-planner',
        novelId,
        timeoutMs: 45_000,
        concurrency: 2,
        signal: progress.signal,
      }
    );
    beatsSource = 'model';
    sceneBeats = normalizePlannerBeats(sceneBeats);
  } catch (err) {
    throwIfAborted(progress.signal);
    logger.warn('Planner fell back to deterministic beats', err);
    sceneBeats = buildFallbackSceneBeats(userIntent);
    beatsSource = 'fallback';
  }

  const beatCastFilter = extractBeatCast(sceneBeats);
  // Plan 261 Phase4：伏笔台账的关联角色并入图谱过滤面——让"应该回收的伏笔"牵出的角色
  // 即使没被本章分镜点名，也能带出关系边与实体上下文。只在本就有分镜点名实体时扩展，
  // 保持 buildCharacterRelationshipContext 的"空 filter = 全量图谱"语义不被破坏。
  const foreshadowingCast = foreshadowingContext?.relatedCharacterNames ?? [];
  const contextEntityFilter =
    beatCastFilter && beatCastFilter.length > 0
      ? [...new Set([...beatCastFilter, ...foreshadowingCast.slice(0, 8)])]
      : beatCastFilter;
  const worldviewHints = loadWorldviewHints(novelId, beatCastFilter || []);
  const worldviewHintsSuffix = worldviewHints.hintsBlock
    ? '\n\n' + worldviewHints.hintsBlock
    : '';
  // ================================================================
  // Phase 2–3: Writer → Critic loop
  // ================================================================
  const writerSkillsInfo = stagePrompts.writer;
  const criticSkillsInfo = stagePrompts.critic;
  let currentDraft = '';
  let criticFeedback = '';
  // Plan 261 修复③：writer 重试实际消费的反馈——critic JSON 蒸馏后的纯文本指令。
  let writerRetryFeedback = '';
  let auditScore = 0;
  let auditStatus: PipelineResult['auditStatus'] = 'unknown';
  let draftSource: PipelineResult['source'] = 'model';
  let criticAvailable: boolean;
  let attempts = 0;
  let lastModelDraft = '';
  let lastViolations: string[] = [];
  let lastMechanicalScore: number | undefined;
  // Plan 261 修复⑥：全 attempts 未过线时营救得分最高的模型稿——重试轮常退化，
  // 最后一稿往往是最差的；交付 60+ 的最优 attempt（review_required 交人审），
  // 远好于掉进保底模板稿（实测只有 12 分）。
  let bestAttemptDraft = '';
  let bestAttemptAudit = '';
  let bestAttemptScore = 0;
  // Plan 266 修复④：审稿 unknown 会触发整章重写；若重写轮被 provider 抖动打回确定性
  // 保底稿，先前「已过本地质量门」的模型稿会凭空消失（复测 run 8aaa7c29：4534 字
  // 过门稿 → 交付 4068 字模板稿）。这里把最后一份过门模型稿留作营救候选。
  let gateSalvageDraft = '';
  let gateSalvageAudit = '';
  let gateSalvageAuditStatus: PipelineResult['auditStatus'] = 'unknown';
  let gateSalvageScore = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    attempts = attempt + 1;
    criticAvailable = false;
    progress.onPhase?.('writer');

    // --- Writer ---
    // Plan 261 修复⑳：flash 管线走精简模板（8 条核心规则，细纲为主）——
    // 全量 20 条规则模板是为编辑器/pro 场景设计的，指令过载会稀释服从率。
    const writerAsset = { template: getPromptTemplate('orchestrateWriterSlim') };

    const writerPrompt = renderPromptTemplate(writerAsset.template, {
      WRITER_SOUL,
      contextStr: augmentedContexts.writer,
      skillsInfo: writerSkillsInfo,
      sceneBeats,
      criticFeedback: criticFeedback
        ? writerRetryFeedback || criticFeedback
        : '初稿阶段，请全力输出。',
    }) + worldviewHintsSuffix + foreshadowingSuffix + WRITER_OUTPUT_DISCIPLINE;

    draftSource = 'model';
    try {
      // 诊断工具（env 门控）：采集实际发出的 writer prompt 与每次调用的收发
      // 元数据（prompt 长度 / 响应长度 / 耗时），用于离线复现实验与容量取证。
      const debugWriterPromptEnabled = process.env.DEBUG_WRITER_PROMPT === '1';
      const debugWriterLogFile = `/tmp/writer-prompts-${process.env.DEBUG_WRITER_PROMPT_TAG || 'default'}.jsonl`;
      const debugLogWriter = (payload: Record<string, unknown>) => {
        if (!debugWriterPromptEnabled) return;
        try {
          appendFileSync(debugWriterLogFile, JSON.stringify({ t: Date.now(), attempt, ...payload }) + '\n');
        } catch { /* 诊断采集失败不影响主流程 */ }
      };
      debugLogWriter({ kind: 'whole-chapter-prompt', promptLen: writerPrompt.length, prompt: writerPrompt });
      let streamedWriterText = '';
      const writerConfig = resolveWriterConfig(getConfig());
      const sceneSections = splitSceneBeats(sceneBeats);

      if (sceneSections.length >= MIN_SCENES_FOR_SPLIT) {
        // Scheme C — split-scene generation: one model call per scene block,
        // each seeded with the tail of the previous scene for continuity.
        // A slow upstream only needs to finish a few hundred characters per
        // call instead of a whole 4000-char chapter in one window.
        const parts: string[] = [];
        let previousTail = '';
        let rejectedScenes = 0;
        for (let i = 0; i < sceneSections.length; i++) {
          throwIfAborted(progress.signal);
          const isFinalScene = i === sceneSections.length - 1;
          const sectionPrompt = renderPromptTemplate(writerAsset.template, {
            WRITER_SOUL,
            contextStr:
              augmentedContexts.writer +
              (previousTail
                ? `\n【上一场景结尾——保持人物、时间与节奏的衔接，不要复述】\n${previousTail}`
                : ''),
            skillsInfo: writerSkillsInfo,
            sceneBeats:
              sceneSections[i] +
              (isFinalScene
                ? '\n\n（本章最终场景：按分镜收束本章悬念，给出章节结尾。）'
                : '\n\n（写完本场景即停，不要越到下一场景。）'),
            criticFeedback: criticFeedback
              ? writerRetryFeedback || criticFeedback
              : i === 0
                ? '初稿阶段，请全力输出。'
                : '继续本章的下一场景，保持人物与节奏连贯。',
          }) + worldviewHintsSuffix + foreshadowingSuffix + WRITER_OUTPUT_DISCIPLINE;
          const callT0 = Date.now();
          let sceneTruncated = false;
          try {
            const sectionText = await generateText(
              writerConfig,
              {
                prompt: sectionPrompt,
                ...WRITER_LLM_OPTIONS,
                // Plan 261 修复⑱配套：模型会顶满 token 预算写作（实测 1536
                // tokens ≈ 2200 字/场景），非末场景收紧到 2/3（≈1400 字），
                // 4 场景整章落在 ~6000 字目标区间；末场景保完整预算收好结尾。
                maxTokens: isFinalScene
                  ? WRITER_SCENE_MAX_TOKENS
                  : Math.round(WRITER_SCENE_MAX_TOKENS * 0.67),
                // Reasoning chains would eat the per-scene token budget and leave
                // the prose truncated empty (finish_reason=length).
                disableThinking: true,
                signal: progress.signal,
                onToken: (token) => {
                  streamedWriterText += token;
                },
                onComplete: (info) => {
                  sceneTruncated = Boolean(info?.truncated);
                },
                contextEntityFilter,
                novelId,
              },
              {
                operation: 'production-pipeline-writer',
                novelId,
                timeoutMs: WRITER_LLM_OPTIONS.timeoutMs,
                concurrency: 2,
                signal: progress.signal,
              }
            );
            let trimmed = String(sectionText).trim();
            // Plan 261 修复⑲：截断续写——场景被 token 上限拦腰切断会在正文里
            // 留下物理伤口（run AH：「特事」「空气里有股」「关东煮的」三处断句、
            // 场景 4 缺失）。检测 finish_reason=length 后补一次续写调用，从中断
            // 处无缝写完本场景；续写预算为场景上限的一半。
            if (sceneTruncated && trimmed && !progress.signal?.aborted) {
              logger.warn(
                `[pipeline] scene ${i + 1}/${sceneSections.length} hit token cap; continuing`,
              );
              const continuation = await generateText(
                writerConfig,
                {
                  prompt:
                    sectionPrompt +
                    `\n\n【你已写出的部分（在末尾被截断）】\n…${trimmed.slice(-400)}\n\n从中断处无缝续写，写完本场景剩余内容并按退场钩子收束。禁止重复已写内容，禁止重新开场。`,
                  maxTokens: Math.round(WRITER_SCENE_MAX_TOKENS * 0.5),
                  disableThinking: true,
                  signal: progress.signal,
                  contextEntityFilter,
                  novelId,
                },
                {
                  operation: 'production-pipeline-writer-continue',
                  novelId,
                  timeoutMs: WRITER_LLM_OPTIONS.timeoutMs,
                  concurrency: 2,
                  signal: progress.signal,
                }
              );
              const continuationText = String(continuation).trim();
              debugLogWriter({
                kind: 'scene-continuation',
                scene: i + 1,
                respChars: continuationText.length,
              });
              if (continuationText) {
                trimmed = `${trimmed}\n${continuationText}`.replace(/(.{2})\n{2,}(?=\S)/, '$1\n');
              }
            }
            debugLogWriter({
              kind: 'scene-call',
              scene: i + 1,
              total: sceneSections.length,
              promptLen: sectionPrompt.length,
              respChars: trimmed.length,
              streamedTokens: streamedWriterText.length,
              ms: Date.now() - callT0,
              ...(process.env.DEBUG_WRITER_TEXT === '1'
                ? { prompt: sectionPrompt, resp: trimmed }
                : {}),
            });
            if (trimmed) {
              parts.push(trimmed);
              previousTail = trimmed.slice(-600);
            }
          } catch (sceneErr) {
            debugLogWriter({
              kind: 'scene-call-error',
              scene: i + 1,
              total: sceneSections.length,
              promptLen: sectionPrompt.length,
              streamedTokens: streamedWriterText.length,
              ms: Date.now() - callT0,
              error: sceneErr instanceof Error ? sceneErr.message.slice(0, 120) : String(sceneErr).slice(0, 120),
            });
            // Split-mode scene guard is a filter, not a hard gate: a single
            // cliche hit in one scene must not kill the whole chapter. Skip
            // the rejected scene, note it for the critic, and let the
            // complete-chapter delivery gate make the final call.
            if (progress.signal?.aborted) throw sceneErr;
            const isQualityRejection =
              sceneErr instanceof Error && sceneErr.message.includes('质量校验');
            if (!isQualityRejection) throw sceneErr;
            rejectedScenes += 1;
            logger.warn(
              `[pipeline] scene ${i + 1}/${sceneSections.length} rejected by output guard; skipping`,
              sceneErr instanceof Error ? sceneErr.message : sceneErr
            );
            previousTail = '';
          }
        }
        if (parts.length === 0) throw new Error('empty_response');
        currentDraft = parts.join('\n\n');
        if (rejectedScenes > 0) {
          criticFeedback = `${criticFeedback ? criticFeedback + '\n' : ''}【生成器提示】${rejectedScenes} 个场景因套话守卫被跳过，请检查成稿的场景覆盖与连贯性。`;
        }
      } else {
        currentDraft = await generateText(
          writerConfig,
          {
            prompt: writerPrompt,
            ...WRITER_LLM_OPTIONS,
            // Pin thinking off for the whole-chapter path too: reasoning-heavy
            // models can burn the token budget on chain-of-thought and return a
            // truncated/empty draft (length_exhausted) instead of prose.
            disableThinking: true,
            signal: progress.signal,
            onToken: (token) => {
              streamedWriterText += token;
            },
            contextEntityFilter,
            novelId,
          },
          {
            operation: 'production-pipeline-writer',
            novelId,
            timeoutMs: WRITER_LLM_OPTIONS.timeoutMs,
            concurrency: 2,
            signal: progress.signal,
          }
        );
      }
      // Plan 261 修复⑭：模型空稿/超短稿（<200 有效字符）是模型侧间歇性空响应
      //（run T 实测 0 token），此前被 ensureMinimumDraftLength 用模板段落+分镜
      // 提示句填充成数千字"元数据汤"，critic 全程在审计填充稿——真模型稿从未
      // 被重试（run S/T/U 三连崩坏的真因）。空稿不再填充：直接重试模型；
      // 重试耗尽才走保底降级。
      const modelDraftCompactChars = String(currentDraft).replace(/\s/g, '').length;
      if (modelDraftCompactChars < 200) {
        logger.warn('[pipeline] writer returned an empty/tiny draft; retrying model', {
          novelId,
          modelDraftCompactChars,
        });
        if (attempt < MAX_RETRIES) {
          criticFeedback = '【生成器提示】上一轮模型未返回正文（空响应）。请直接输出完整的叙事正文，不要输出任何说明。';
          writerRetryFeedback = criticFeedback;
          progress.onPhase?.('retry');
          continue;
        }
        throw new Error('empty_model_draft');
      }
      currentDraft = ensureMinimumDraftLength(
        currentDraft,
        sceneBeats,
        augmentedContexts.writer,
        minDraftChars
      );
      if (process.env.DEBUG_GATE_IN === '1') {
        console.error(
          '[DEBUG-gatein] len=' +
            String(currentDraft).length +
            ' head=' +
            JSON.stringify(String(currentDraft).slice(0, 150))
        );
        try {
          appendFileSync(
            `/tmp/gate-in-${process.env.DEBUG_GATE_IN_TAG || 'default'}.txt`,
            `\n\n===== attempt ${attempt} len=${String(currentDraft).length} =====\n${String(currentDraft)}\n`
          );
        } catch {
          /* 诊断采集失败不影响主流程 */
        }
      }
      const draftQuality = validateCompleteChapterDraftQuality(currentDraft, undefined, {
        minChars: minDraftChars,
      });
      if (!draftQuality.ok) {
        logger.warn('Writer output failed the prose quality gate; using fallback draft', {
          novelId,
          violations: draftQuality.violations,
          evidence: (draftQuality.findings || []).slice(0, 8).map((finding) => ({
            code: finding.code,
            snippets: (finding.evidence || []).slice(0, 3).map((entry) => entry.snippet),
          })),
        });
        if (process.env.DEBUG_GATE_IN === '1') {
          try {
            appendFileSync(
              `/tmp/gate-fail-${process.env.DEBUG_GATE_IN_TAG || 'default'}.jsonl`,
              JSON.stringify({
                t: Date.now(),
                attempt,
                minDraftChars,
                len: String(currentDraft).length,
                violations: draftQuality.violations,
                findings: (draftQuality.findings || []).map((finding) => ({
                  code: finding.code,
                  message: finding.message,
                  severity: finding.severity,
                  category: finding.category,
                  evidence: (finding.evidence || []).map((entry) => entry.snippet),
                })),
                hits: (draftQuality.mechanicalReview?.hits || []).map((hit) => ({
                  raw: JSON.stringify(hit),
                })),
                mechanicalScore: draftQuality.mechanicalReview?.score,
              }) + '\n'
            );
          } catch {
            /* 诊断采集失败不影响主流程 */
          }
        }
        if (currentDraft.trim()) {
          lastModelDraft = currentDraft;
          lastViolations = draftQuality.violations;
          lastMechanicalScore = draftQuality.mechanicalReview?.score;
        }
        // Plan 266 修复②：只由局部软命中引起的门失败，先带定向反馈重写整章；
        // 只有重试耗尽或结构/元数据/长度/机械分等硬缺陷才退回确定性保底稿。
        if (isRetriableWriterSoftFailure(draftQuality) && attempt < MAX_RETRIES) {
          criticFeedback = buildLiteraryRetryFeedback(draftQuality);
          progress.onPhase?.('retry');
          continue;
        }
        let fallbackDraft: string;
        try {
          fallbackDraft = buildValidatedFallbackDraft(
            sceneBeats,
            augmentedContexts.writer,
            minDraftChars
          );
        } catch (fallbackErr) {
          if (attempt < MAX_RETRIES) {
            criticFeedback = buildWriterRetryFeedback(draftQuality.violations);
            progress.onPhase?.('retry');
            continue;
          }
          if (lastModelDraft.trim()) {
            throw new DraftQualityRejectionError(
              lastModelDraft,
              lastViolations.length ? lastViolations : draftQuality.violations,
              lastMechanicalScore,
              beatsSource
            );
          }
          throw fallbackErr;
        }
        currentDraft = fallbackDraft;
        draftSource = 'fallback';
      } else {
        const chunks = (streamedWriterText || currentDraft).match(/.{1,24}/gs) || [];
        for (const chunk of chunks) {
          throwIfAborted(progress.signal);
          progress.onWriterToken?.(chunk);
        }
      }
    } catch (err) {
      throwIfAborted(progress.signal);
      if (err instanceof Error && err.message.startsWith('DRAFT_QUALITY_GATE_FAILED:')) {
        throw err;
      }
      logger.warn('Writer fell back to deterministic draft', err);
      // Keep the last usable model draft for the rejection handoff below.
      if (currentDraft.trim() && draftSource === 'model') {
        lastModelDraft = currentDraft;
      }
      let fallbackDraft: string;
      try {
        fallbackDraft = buildValidatedFallbackDraft(sceneBeats, augmentedContexts.writer);
      } catch (fallbackErr) {
        if (attempt < MAX_RETRIES) {
          criticFeedback = buildWriterRetryFeedback(
            err instanceof Error ? truncateFeedback(err.message) : []
          );
          progress.onPhase?.('retry');
          continue;
        }
        if (lastModelDraft.trim()) {
          throw new DraftQualityRejectionError(
            lastModelDraft,
            lastViolations.length
              ? lastViolations
              : truncateFeedback(err instanceof Error ? err.message : String(err)),
            lastMechanicalScore,
            beatsSource
          );
        }
        throw fallbackErr;
      }
      currentDraft = fallbackDraft;
      draftSource = 'fallback';
      // Emit tokens for fallback draft
      const chunks = currentDraft.match(/.{1,24}/gs) || [];
      for (const chunk of chunks) {
        throwIfAborted(progress.signal);
        progress.onWriterToken?.(chunk);
      }
    }

    progress.onWriterDone?.();

    // --- Critic ---
    progress.onPhase?.('critic');

    const criticAsset = resolvePromptAssetForSurface({
      surface: 'chapter-review',
      promptTemplates: getConfig().promptTemplates,
      preferredTemplateKey: 'orchestrateCritic',
    });

    const criticPrompt =
      renderPromptTemplate(criticAsset.template, {
        CRITIC_SOUL,
        contextStr: augmentedContexts.critic,
        skillsInfo: criticSkillsInfo,
        sceneBeats,
        currentDraft,
      }) +
      (chapterContract ? '\n\n' + chapterContract.checklistText : '') +
      foreshadowingChecklistSuffix;

    // A provider can answer 200 yet return an unparseable audit payload
    // (truncated / invalid_json — the five-dim contract did not pass), or the
    // request can fail on a transient network/timeout error. Both are transient:
    // retry the critic once with escalated params before honestly reporting the
    // audit as unknown. Plan 266 修复⑤：原样重发只会复现同样的失败。
    const CRITIC_PARSE_RETRIES = 1;
    let criticMaxTokens = CRITIC_LLM_OPTIONS.maxTokens;
    let criticTimeoutMs = CRITIC_LLM_OPTIONS.timeoutMs;
    let criticRetrySuffix = '';
    let criticClassification: ReturnType<typeof classifyCriticFeedback> | null = null;
    for (let criticAttempt = 0; ; criticAttempt += 1) {
      try {
        criticFeedback = await generateText(
          getConfig(),
          {
            prompt:
              criticPrompt +
              AUDIT_OUTPUT_CONTRACT +
              criticRetrySuffix,
            ...CRITIC_LLM_OPTIONS,
            maxTokens: criticMaxTokens,
            signal: progress.signal,
            novelId,
            outputMode: 'audit-json',
            responseMimeType: 'application/json',
            responseSchema: AUDIT_RESPONSE_SCHEMA,
          },
          {
            operation: 'production-pipeline-critic',
            novelId,
            timeoutMs: criticTimeoutMs,
            concurrency: 2,
            signal: progress.signal,
          }
        );
        criticAvailable = true;
      } catch (err) {
        throwIfAborted(progress.signal);
        if (isRetriableCriticError(err) && criticAttempt < CRITIC_PARSE_RETRIES) {
          criticTimeoutMs = Math.min(criticTimeoutMs * 2, CRITIC_MAX_TIMEOUT_MS);
          logger.warn(
            `Critic request failed (${criticErrorCode(err)}) — retrying once with ${criticTimeoutMs}ms timeout`
          );
          continue;
        }
        logger.warn('Critic fell back — accepting draft', err);
        criticFeedback = '审计不可用：模型审计请求失败，保留草稿预览。';
        auditStatus = 'unknown';
        auditScore = 0;
        break;
      }
      const parseDiagnostic = parseAuditResponseWithDiagnostics(criticFeedback).diagnostic;
      if (parseDiagnostic && criticAttempt < CRITIC_PARSE_RETRIES) {
        throwIfAborted(progress.signal);
        criticAvailable = false;
        if (parseDiagnostic.code === 'truncated') {
          criticRetrySuffix = CRITIC_RETRY_COMPACT_SUFFIX;
          criticMaxTokens = CRITIC_LLM_OPTIONS.maxTokens + CRITIC_RETRY_TOKEN_BOOST;
        }
        logger.warn(
          `Critic audit failed the structured contract (${parseDiagnostic.code}) — retrying once with ${criticMaxTokens} tokens`
        );
        continue;
      }
      // Plan 266 修复⑤（证据契约）：分数可解析但 evidence 四类不全时 classifyCriticFeedback 会判
      // unknown —— 此时重试必须补要求（不得放宽契约），否则 run 必然停在「审计不可用」。
      criticClassification = classifyCriticFeedback(criticFeedback);
      if (criticClassification.status === 'unknown' && criticAttempt < CRITIC_PARSE_RETRIES) {
        throwIfAborted(progress.signal);
        criticRetrySuffix = CRITIC_RETRY_EVIDENCE_SUFFIX;
        criticMaxTokens = CRITIC_LLM_OPTIONS.maxTokens + CRITIC_RETRY_TOKEN_BOOST;
        logger.warn(
          'Critic audit unknown (evidence contract unmet) — retrying once with reinforced evidence requirements'
        );
        continue;
      }
      break;
    }

    // Only structured audits are trusted; unavailable or unparseable audits stay UNKNOWN.
    if (criticAvailable) {
      const classification = criticClassification ?? classifyCriticFeedback(criticFeedback);
      auditScore = classification.score ?? 0;
      auditStatus = classification.status;
      if (auditStatus === 'unknown') criticFeedback = UNKNOWN_CRITIC_FEEDBACK;
    }
    // Plan 261 修复③：重写轮只消费蒸馏后的指令，原始 JSON 审计仅用于展示/落库。
    writerRetryFeedback = auditStatus === 'pass' ? '' : buildCriticRetryFeedback(criticFeedback);

    if (draftSource === 'model' && currentDraft && auditStatus === 'fail' && auditScore > bestAttemptScore) {
      bestAttemptScore = auditScore;
      bestAttemptDraft = currentDraft;
      bestAttemptAudit = criticFeedback;
    }

    // Plan 266 修复④：draftSource === 'model' 等价于「本轮模型稿过了本地质量门」
    // （门失败会把 draftSource 置为 'fallback'）；连同其审稿状态一起留作营救候选。
    if (draftSource === 'model' && currentDraft.trim()) {
      gateSalvageDraft = currentDraft;
      gateSalvageAudit = criticFeedback;
      gateSalvageAuditStatus = auditStatus;
      gateSalvageScore = auditScore;
    }

    const isValid = auditStatus === 'pass';
    progress.onCriticDone?.(criticFeedback, isValid, {
      status: auditStatus,
      score: auditStatus === 'unknown' ? undefined : auditScore,
    });

    // Plan 261 修复⑩：attempt1 达高分区（≥70）即收稿——重试轮实测常深度退化
    //（run R：74→8→38），且 70-79 的稿由最优稿营救/review_required 人工收尾
    // 兜底，继续重试是负资产（多花两轮 LLM 调用换更差的稿）。
    if (auditStatus === 'fail' && auditScore >= 70) break;

    // Plan 247：unknown（审稿不可验证）不再直接 break——追加一次 critic 复核
    // （让 Writer 重写后 Critic 重新审稿），复核仍 unknown 则在下方诚实降级。
    if (isValid) break;
    if (auditStatus === 'unknown' && attempt >= 1) break;

    // Retry: feed critic feedback to next Writer iteration
    if (attempt < MAX_RETRIES) {
      progress.onPhase?.('retry');
    }
  }

  // Plan 261 修复⑥：最优 attempt 营救——门槛（80）未过但最优稿 ≥60 时，
  // 用它替代最后一稿交付（auditStatus 保持 fail，分数如实展示，由人决定取舍）。
  if (
    draftSource === 'model' &&
    auditStatus === 'fail' &&
    bestAttemptDraft &&
    bestAttemptScore >= 60 &&
    currentDraft !== bestAttemptDraft
  ) {
    currentDraft = bestAttemptDraft;
    criticFeedback = bestAttemptAudit;
    auditScore = bestAttemptScore;
  }

  // Plan 266 修复④：任一轮退化到确定性保底稿时，用先前已过本地质量门的模型稿交付
  // （审稿状态如实保持 unknown / fail，终态仍是 review_required 交人审），
  // 避免「好稿只留在内存里、落库和下发的是模板散文」。
  if (draftSource === 'fallback' && gateSalvageDraft && gateSalvageDraft !== currentDraft) {
    currentDraft = gateSalvageDraft;
    criticFeedback =
      gateSalvageAuditStatus === 'unknown' ? UNKNOWN_CRITIC_FEEDBACK : gateSalvageAudit;
    auditStatus = gateSalvageAuditStatus;
    auditScore = gateSalvageScore;
    draftSource = 'model';
  }

  return {
    sceneBeats,
    draft: currentDraft,
    audit: criticFeedback,
    score: auditStatus === 'unknown' ? undefined : auditScore,
    auditStatus,
    source: draftSource,
    beatsSource,
    attempts,
  };
}
