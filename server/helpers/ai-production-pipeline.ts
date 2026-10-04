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
} from './fallback-draft';
import type { LearnedPreference } from '../../shared/lib/preference-flywheel';
import { PLANNER_SOUL, WRITER_SOUL, CRITIC_SOUL } from '../../shared/config/souls';

import {
  extractSettingCardSources,
  resolveEffectiveMinDraftChars,
  stripPromptInstructionResidue,
  stripSettingCardLeaks,
  validateCompleteChapterDraftQuality,
} from '../../shared/lib/draft-quality';
import {
  loadChapterContract,
  loadForeshadowingContext,
  loadOutlineUnit,
  loadWorldviewHints,
} from './knowledge-lineage-enrich.js';
import { STREAM_HOLDBACK_CHARS, scaleTimeoutForReasoningEffort } from '../lib/server-llm';
import {
  LOCAL_REPAIR_BATCH_MARKER,
  MAX_LOCAL_REPAIR_BATCH_TARGETS,
  MAX_LOCAL_REPAIR_ROUNDS,
  applyLocalRepairs,
  compactTextLength,
  parseLocalRepairBatchResponse,
  residualP2Codes,
  selectLocalRepairTargets,
  type LocalRepairHitLike,
  type LocalRepairTarget,
} from '../../shared/lib/local-repair';
import { buildRewritePrompt } from '../../shared/lib/rewrite-prompt';

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
  /** Plan 272: beats are pushed as soon as the planner returns. */
  onBeats?: (beats: string) => void;
  onWriterToken?: (chunk: string) => void;
  /** Plan 272: the caller must drop the provisional streamed draft before a replay. */
  onWriterReset?: () => void;
  onWriterDone?: () => void;
  /**
   * Plan 275（R-273-2）：critic 阶段实时进度。此前作者只能看到一条静态
   * 「AI critic 进行中...」，而这一阶段从 6 s（low 档）到 200 s+（high 档或解析重试）
   * 都可能，作者无从判断是在推进还是已经卡住。
   */
  onCriticProgress?: (update: {
    attempt: number;
    stage: 'start' | 'retry' | 'parsed' | 'unknown';
    reason?: string;
    score?: number;
  }) => void;
  /**
   * Plan 277（R-276-3）：定点修复此前只写服务器日志——作者侧看不到「刚在补哪几句、
   * 补完是过了门、还剩 P2 残留，还是彻底没修成」。每轮修完发一次。
   */
  onWriterRepair?: (update: {
    round: number;
    targets: number;
    applied: number;
    batchCalls: number;
    singleCalls: number;
    status: 'passed' | 'residual' | 'failed';
    residualCodes?: string[];
  }) => void;
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
  /** Plan 269：门禁命中的段落级定点修复读数（未触发时缺省）。 */
  localRepair?: LocalRepairSummary;
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
export function resolveWriterTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.INKFLOW_WRITER_TIMEOUT_MS);
  return override > 0 ? override : scaleTimeoutForReasoningEffort(180_000, env);
}

const WRITER_LLM_OPTIONS = {
  timeoutMs: resolveWriterTimeoutMs(),
  maxAttempts: 2,
  maxTokens: 8_192,
  // Plan 273：strict 守门下也边写边透传（末尾窗口留到过门后 flush），
  // 首章正文字符随生成递增，而不是等整个场景写完后一次性出现。
  streamHoldback: STREAM_HOLDBACK_CHARS,
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

export function resolveCriticTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.INKFLOW_CRITIC_TIMEOUT_MS);
  return override > 0 ? override : scaleTimeoutForReasoningEffort(35_000, env);
}

export function resolveCriticMaxTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return scaleTimeoutForReasoningEffort(120_000, env);
}

const CRITIC_LLM_OPTIONS = {
  // 2026-09-24：与 writer 对称，支持 INKFLOW_CRITIC_TIMEOUT_MS 覆盖。
  // 起因：走 CLIProxyAPI 的 Claude 在富上下文下 critique 需 35s+，被硬编码 35s
  // 掐断成 500 → auditStatus=unknown，这不是模型质量结论而是超时口径问题。
  // Plan 268：默认值随思考档位缩放（high 档 105s），显式 env 覆盖仍优先。
  timeoutMs: resolveCriticTimeoutMs(),
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
const CRITIC_MAX_TIMEOUT_MS = resolveCriticMaxTimeoutMs();
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
const WRITER_RETRIABLE_FINDING_CODES = ['literary-slop', 'setting-card-leak', 'prompt-residue-echo', 'chapter-below-contract'];

// Plan 279（R-278-2）：续写一轮常常补不到下限，允许再续一轮（每轮都从最新断点续并重新过门）。
const MAX_LENGTH_CONTINUATION_ROUNDS = 2;

function isRetriableWriterSoftFailure(quality: {
  findings?: Array<{ code?: string; severity?: string }>;
  mechanicalReview?: { status?: string };
}): boolean {
  if (quality.mechanicalReview?.status !== 'pass') return false;
  const findings = quality.findings || [];
  if (!findings.some((finding) => WRITER_RETRIABLE_FINDING_CODES.includes(finding.code || ''))) return false;
  return findings.every(
    (finding) => finding.severity === 'P2' || WRITER_RETRIABLE_FINDING_CODES.includes(finding.code || '')
  );
}

function buildLiteraryRetryFeedback(quality: {
  violations?: string[];
  findings?: Array<{ code?: string; evidence?: Array<string | { snippet?: string }> }>;
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

  const settingCardLeak = (quality.findings || []).some((finding) => finding.code === 'setting-card-leak');
  const promptResidue = (quality.findings || []).some((finding) => finding.code === 'prompt-residue-echo');
  const problems = quality.violations?.length
    ? `具体问题：${quality.violations.join('；')}。`
    : '';

  const leakFeedback = settingCardLeak
    ? '正文结尾复述了人物/道具设定卡原文：只写场景与动作，不要罗列设定、名单或背景说明。'
    : '';
  const residueFeedback = promptResidue
    ? '正文混入了写作提示词指令（如「档案纪律」「必须遵守」等说明句）：只写小说正文，不要抄写任何指令、格式说明或字段名。'
    : '';
  return `【上一稿未通过正文质量门禁，请重写整章】${problems}${detail}${leakFeedback}${residueFeedback}${WRITER_RETRY_STYLE_RULE}`;
}

/**
 * Plan 269：门禁命中 → 段落级定点修复的读数（进 PipelineResult，供落库与测试对照）。
 */
export interface LocalRepairSummary {
  /** false = 本稿不满足定点修复前提（硬缺陷/未达篇幅/定位不到），已交回整章重写。 */
  attempted: boolean;
  targets: number;
  applied: number;
  skipped: number;
  passed: boolean;
  reason?: string;
  /** Plan 276：实际跑了几轮定点修复（上限 MAX_LOCAL_REPAIR_ROUNDS；第二轮只针对第一轮的残留命中）。 */
  rounds?: number;
  /** Plan 276：修复通过门禁后仍留在稿里的 P2 软残留 code（P2 不阻断交付，但不再静默）。 */
  residualCodes?: string[];
  /** Plan 277（R-276-1）：本轮实际发了几次批量调用与几次单句补齐调用（0 缺席 = 未走该路径）。 */
  batchCalls?: number;
  singleCalls?: number;
}

/** 只改被点名的一段：删套话与副词弱化，不新增信息、不扩写、篇幅相当。 */
const LOCAL_REPAIR_INSTRUCTION =
  '只修复被点名的这一小段：删掉 AI 套话与副词弱化（tell-dont-show），改成具体动作、感官细节或停顿；不要扩写剧情、不要新增人物或信息；保持与前后的衔接，篇幅与原文相当。';

/** 定点修复单句用短预算与小重试：它不该重新生成一章，也不该烧掉整章重试额度。 */
const LOCAL_REPAIR_LLM_OPTIONS = {
  maxTokens: 2048,
  maxAttempts: 1,
  timeoutMs: WRITER_LLM_OPTIONS.timeoutMs,
  // Plan 277（R-276-1）：补丁回执不是正文，必须原样返回（见 server/lib/server-llm.ts 的 patch 分支）。
  outputMode: 'patch' as const,
} as const;

/** Plan 276：批量调用要一次产出全部替换句，token 预算比单句路高。 */
const LOCAL_REPAIR_BATCH_LLM_OPTIONS = {
  ...LOCAL_REPAIR_LLM_OPTIONS,
  maxTokens: Math.max(LOCAL_REPAIR_LLM_OPTIONS.maxTokens, 3_072),
} as const;

/** 定点修复调用共享的上下文（批量与单句补齐路径共用）。 */
type LocalRepairCallContext = {
  novelId: string;
  writerConfig: ReturnType<typeof resolveWriterConfig>;
  contextStr: string;
  signal?: AbortSignal;
};

function localRepairIssue(target: LocalRepairTarget): string {
  return target.suggestion
    ? `正文质量门命中（${target.category}）：${target.suggestion}`
    : `正文质量门命中类别：${target.category}`;
}

/** Plan 276（R-269-1）：把 N 处目标合成一次请求，输出按 @@FIX n@@ 标记解析。 */
function buildLocalRepairBatchPrompt(
  targets: readonly LocalRepairTarget[],
  contextStr: string
): string {
  const blocks = targets.map((target, index) =>
    [
      `【第 ${index + 1} 处】`,
      `原句：${target.snippet}`,
      `前文衔接：${target.before}`,
      `后文衔接：${target.after}`,
      `本处问题：${localRepairIssue(target)}`,
    ].join('\n')
  );
  const slots = targets
    .map(
      (_target, index) =>
        `${LOCAL_REPAIR_BATCH_MARKER} ${index + 1}${LOCAL_REPAIR_BATCH_MARKER}
<第 ${index + 1} 处修好后的整句>`
    )
    .join('\n');
  return [
    `你是一个顶级的网文主编及文学润色大师。下面一章正文里有 ${targets.length} 处需要分别定点修好。`,
    '',
    '【整体世界观与上下文背景】',
    contextStr,
    '',
    '【修补原则——必须严格遵守】',
    `1. ${LOCAL_REPAIR_INSTRUCTION}`,
    '2. 每一处只重写被点名的那一句整句，结合前文/后文衔接，绝对不要重复它们的内容。',
    '3. 不要解释、不要前言后语、不要 markdown 代码块；除标记行外只输出修好后的句子。',
    '',
    `【输出格式（共 ${targets.length} 段，顺序与下面给出的编号一致）】`,
    slots,
    '',
    '【需要定点修复的段落】',
    blocks.join('\n\n'),
    '',
    `请直接按上述格式输出 ${targets.length} 段修复后的句子。`,
  ].join('\n');
}

/** Plan 277（R-276-1）：批量修复的实测读数（发了几次、抢回几槽）。 */
interface BatchRepairStats {
  calls: number;
  filled: number;
}

/**
 * 批量定点修复：按 MAX_LOCAL_REPAIR_BATCH_TARGETS 分块请求。调用失败或解析不到目标时
 * 对应槽位留空串，由调用方按索引对缺口单独补一次调用（保留 Plan 269 的单句路径作为退化）。
 *
 * Plan 277（R-276-1）：真机实测「一次 3 处」时批量回执可用 0 槽——修过的句子仍带软命中，
 * 整批被散文守卫判负（守卫容忍 violations ≤ 2）。切成每批 2 处让容错额度覆盖整批，
 * 每块独立解析、独立降级，缺口交单句补齐。
 */
async function requestBatchLocalRepairs(
  params: LocalRepairCallContext,
  targets: readonly LocalRepairTarget[],
  stats: BatchRepairStats
): Promise<string[]> {
  if (!targets.length) return [];
  const results = new Array<string>(targets.length).fill('');
  for (let offset = 0; offset < targets.length; offset += MAX_LOCAL_REPAIR_BATCH_TARGETS) {
    const chunk = targets.slice(offset, offset + MAX_LOCAL_REPAIR_BATCH_TARGETS);
    let parsed: string[] = [];
    try {
      const prompt = buildLocalRepairBatchPrompt(chunk, params.contextStr);
      stats.calls += 1;
      const batched = await generateText(
        params.writerConfig,
        {
          prompt,
          ...LOCAL_REPAIR_BATCH_LLM_OPTIONS,
          disableThinking: true,
          signal: params.signal,
        },
        {
          operation: 'production-pipeline-local-repair-batch',
          novelId: params.novelId,
          timeoutMs: WRITER_LLM_OPTIONS.timeoutMs,
          signal: params.signal,
        }
      );
      parsed = parseLocalRepairBatchResponse(String(batched || ''), chunk.length);
    } catch (error) {
      logger.warn('Local gate repair batch call failed; falling back to per-sentence calls', error);
    }
    const filled = parsed.filter(Boolean).length;
    stats.filled += filled;
    parsed.forEach((value, index) => {
      results[offset + index] = value || '';
    });
    // Plan 277（R-276-3）：把每块的真实产出写进日志，真机上不再靠呼叫计数反推。
    logger.info('[pipeline] local gate repair batch chunk', {
      novelId: params.novelId,
      offset,
      size: chunk.length,
      filled,
    });
  }
  return results;
}

/** 单句定点修复：批量的补齐路径，也是 Plan 269 的原路径。 */
async function requestSingleLocalRepair(
  params: LocalRepairCallContext,
  target: LocalRepairTarget
): Promise<string> {
  const prompt = buildRewritePrompt({
    text: target.snippet,
    instruction: LOCAL_REPAIR_INSTRUCTION,
    contextStr: params.contextStr,
    auditIssue: localRepairIssue(target),
    beforeContext: target.before,
    afterContext: target.after,
    mode: 'surgical-patch',
  });
  try {
    const repaired = await generateText(
      params.writerConfig,
      {
        prompt,
        ...LOCAL_REPAIR_LLM_OPTIONS,
        disableThinking: true,
        signal: params.signal,
      },
      {
        operation: 'production-pipeline-local-repair',
        novelId: params.novelId,
        timeoutMs: WRITER_LLM_OPTIONS.timeoutMs,
        concurrency: 2,
        signal: params.signal,
      }
    );
    return String(repaired || '').trim();
  } catch (error) {
    logger.warn('Local gate repair call failed', error);
    return '';
  }
}

/**
 * 门禁命中 → 段落级定点修复：只重写被点名的句子，修完用同一套质量门复检。
 * 修过的稿仍不过门时返回 null（交回整章重写/保底稿），但读数会如实带上原因。
 */
async function repairGateHitsLocally(params: {
  novelId: string;
  writerConfig: ReturnType<typeof resolveWriterConfig>;
  text: string;
  findings: readonly { code?: string; severity?: string }[];
  hits: readonly LocalRepairHitLike[];
  contextStr: string;
  minDraftChars?: number;
  signal?: AbortSignal;
}): Promise<{
  text: string | null;
  report: ReturnType<typeof validateCompleteChapterDraftQuality> | null;
  summary: LocalRepairSummary;
}> {
  const selection = selectLocalRepairTargets({
    text: params.text,
    findings: params.findings,
    hits: params.hits,
    minChars: params.minDraftChars,
  });
  if (!selection.repair) {
    return {
      text: null,
      report: null,
      summary: {
        attempted: false,
        targets: 0,
        applied: 0,
        skipped: selection.skipped,
        passed: false,
        reason: selection.reason,
      },
    };
  }
  // Plan 276（R-269-1）：先合成一次批量调用。原来的「一句一次」会把同一段上下文、前后衔接
  // 重复发送 N 次（实测 3 处软命中 = 3 次往返）；批量的响应按 @@FIX n@@ 解析，
  // 缺哪一处再对那一处单独补一次调用（批量的退化路径，保留 Plan 269 的原行为）。
  const callContext: LocalRepairCallContext = {
    novelId: params.novelId,
    writerConfig: params.writerConfig,
    contextStr: params.contextStr,
    signal: params.signal,
  };
  const batchStats: BatchRepairStats = { calls: 0, filled: 0 };
  const batchReplacements = await requestBatchLocalRepairs(
    callContext,
    selection.targets,
    batchStats
  );
  const repairs: Array<{ start: number; end: number; text: string }> = [];
  let singleCalls = 0;
  for (let index = 0; index < selection.targets.length; index += 1) {
    throwIfAborted(params.signal);
    const target = selection.targets[index];
    let replacement = batchReplacements[index];
    if (!replacement) {
      singleCalls += 1;
      replacement = await requestSingleLocalRepair(callContext, target);
    }
    if (replacement) {
      repairs.push({ start: target.start, end: target.end, text: replacement });
    }
  }
  if (!repairs.length) {
    return {
      text: null,
      report: null,
      summary: {
        attempted: true,
        targets: selection.targets.length,
        applied: 0,
        skipped: selection.skipped,
        passed: false,
        reason: 'no-repair-returned',
        batchCalls: batchStats.calls,
        singleCalls,
      },
    };
  }
  const application = applyLocalRepairs(params.text, repairs);

  const report = validateCompleteChapterDraftQuality(application.text, undefined, {
    minChars: params.minDraftChars,
    context: params.contextStr,
  });
  const failedCodes = (report.findings || []).map((finding) => finding.code).filter(Boolean);
  return {
    text: application.text,
    report,
    summary: {
      attempted: true,
      targets: selection.targets.length,
      applied: application.applied,
      skipped: selection.skipped + application.skipped,
      passed: report.ok,
      reason: report.ok
        ? undefined
        : `still-failing:${failedCodes.length ? failedCodes.join(',') : 'unknown'}`,
      batchCalls: batchStats.calls,
      singleCalls,
    },
  };
}

/**
 * Plan 277（R-276-2）：过门之后还剩多少个「下一轮真能修」的软命中。
 * 直接复用挑目标的同一套门槛（硬缺陷 / 未达篇幅 / 无可定位命中都不算残留），
 * 避免用「原始命中数」误开一轮注定被拒的修复。
 */
function countLocalizableResidue(
  text: string,
  report: ReturnType<typeof validateCompleteChapterDraftQuality>,
  minDraftChars?: number
): number {
  const selection = selectLocalRepairTargets({
    text,
    findings: report.findings || [],
    hits: report.mechanicalReview?.hits || [],
    minChars: minDraftChars,
  });
  return selection.repair ? selection.targets.length : 0;
}

/**
 * Plan 276（R-269-3）：定点修复的完整生命周期——一轮修不全就用「修过但仍有残留」的正文
 * 与它自己的复检报告重新挑目标再修一轮（上限 MAX_LOCAL_REPAIR_ROUNDS），
 * 只有全部轮次都不行才把结果与原因交回整章重写/保底稿。
 */
async function attemptLocalRepairs(params: {
  novelId: string;
  writerConfig: ReturnType<typeof resolveWriterConfig>;
  text: string;
  findings: readonly { code?: string; severity?: string }[];
  hits: readonly LocalRepairHitLike[];
  contextStr: string;
  minDraftChars?: number;
  signal?: AbortSignal;
}): Promise<{
  text: string | null;
  report: ReturnType<typeof validateCompleteChapterDraftQuality> | null;
  summary: LocalRepairSummary;
}> {
  let text = params.text;
  let findings = params.findings;
  let hits = params.hits;
  let lastText: string | null = null;
  let lastReport: ReturnType<typeof validateCompleteChapterDraftQuality> | null = null;
  let targets = 0;
  let applied = 0;
  let skipped = 0;
  let attempted = false;
  let reason: string | undefined;
  let rounds = 0;
  let batchCalls = 0;
  let singleCalls = 0;
  // Plan 277（R-276-2）：过门的那一轮留底——后续轮次若反而不过门，回收它交付。
  let bestPassingText: string | null = null;
  let bestPassingReport: ReturnType<typeof validateCompleteChapterDraftQuality> | null = null;
  let bestResidualCodes: string[] | undefined;
  for (let round = 0; round < MAX_LOCAL_REPAIR_ROUNDS; round += 1) {
    const outcome = await repairGateHitsLocally({
      novelId: params.novelId,
      writerConfig: params.writerConfig,
      text,
      findings,
      hits,
      contextStr: params.contextStr,
      minDraftChars: params.minDraftChars,
      signal: params.signal,
    });
    rounds += 1;
    targets += outcome.summary.targets;
    applied += outcome.summary.applied;
    skipped += outcome.summary.skipped;
    attempted = attempted || outcome.summary.attempted;
    if (outcome.summary.reason) reason = outcome.summary.reason;
    batchCalls += outcome.summary.batchCalls ?? 0;
    singleCalls += outcome.summary.singleCalls ?? 0;
    if (!outcome.text || !outcome.report) {
      // 这一轮没有可用的修复结果：没有新文本可供重新定位，不再挑下一轮。
      // Plan 277（R-276-2）：若之前已有过门的正文，回收它——后续轮次失败不该丢已过门的稿。
      if (bestPassingText && bestPassingReport) {
        return {
          text: bestPassingText,
          report: bestPassingReport,
          summary: {
            attempted,
            targets,
            applied,
            skipped,
            passed: true,
            rounds,
            batchCalls,
            singleCalls,
            ...(bestResidualCodes ? { residualCodes: bestResidualCodes } : {}),
          },
        };
      }
      return {
        text: lastText,
        report: lastReport,
        summary: {
          attempted,
          targets,
          applied,
          skipped,
          passed: false,
          rounds,
          reason,
          batchCalls,
          singleCalls,
        },
      };
    }
    lastText = outcome.text;
    lastReport = outcome.report;
    if (outcome.report.ok) {
      const residualCodes = residualP2Codes(outcome.report.findings);
      // Plan 277（R-276-2）：过门 ≠ 没残留。复检里若还有下一轮真能修的软命中，
      // 就再用一轮把它们清掉（P2 只是「不阻断交付」，不是「不该修」）；
      // 第二轮若反而不过门，上面的兜底会把这一轮已过门的正文回收交付。
      const residue = countLocalizableResidue(outcome.text, outcome.report, params.minDraftChars);
      bestPassingText = outcome.text;
      bestPassingReport = outcome.report;
      bestResidualCodes = residualCodes.length ? residualCodes : undefined;
      if (round + 1 < MAX_LOCAL_REPAIR_ROUNDS && residue > 0) {
        text = outcome.text;
        findings = outcome.report.findings || [];
        hits = outcome.report.mechanicalReview?.hits || [];
        continue;
      }
      return {
        text: outcome.text,
        report: outcome.report,
        summary: {
          attempted,
          targets,
          applied,
          skipped,
          passed: true,
          rounds,
          batchCalls,
          singleCalls,
          ...(residualCodes.length ? { residualCodes } : {}),
        },
      };
    }
    // 硬缺陷/未达篇幅/没有可定位命中：再挑也是同一批拒绝原因，不再烧第二轮调用。
    if (!outcome.summary.attempted) break;
    // 第二轮改用修过但仍有残留的正文与它的复检命重，而不是原稿重复同一批句子。
    text = outcome.text;
    findings = outcome.report.findings || [];
    hits = outcome.report.mechanicalReview?.hits || [];
  }
  // Plan 277（R-276-2）：轮次用完或后半程不过门时，有过门的正文就交付它（残留照实登记）。
  if (bestPassingText && bestPassingReport) {
    return {
      text: bestPassingText,
      report: bestPassingReport,
      summary: {
        attempted,
        targets,
        applied,
        skipped,
        passed: true,
        rounds,
        batchCalls,
        singleCalls,
        ...(bestResidualCodes ? { residualCodes: bestResidualCodes } : {}),
      },
    };
  }
  return {
    text: lastText,
    report: lastReport,
    summary: {
      attempted,
      targets,
      applied,
      skipped,
      passed: false,
      rounds,
      reason,
      batchCalls,
      singleCalls,
    },
  };
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

  // Plan 272: push the beats as soon as the planner returns, instead of waiting
  // for writer/critic to settle (old behaviour: ~49 s to first prose, ~55 s to beats).
  progress.onBeats?.(sceneBeats);

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
  let localRepair: LocalRepairSummary | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Plan 278(5)：修复/续写标志必须逐 attempt 重置——critic 低分会回路重写，
    // 陈旧标志会把新产生的短稿当成「已修好」直接交付（真机 pro-low8 rep3 复现：交付 2846 字未达 4000 合同）。
    let localRepairAttempted = false;
    let localRepairPassed = false;
    let lengthContinuationAttempted = false;
    let lengthContinuationRounds = 0;
    let lengthContinuationPassed = false;
    // Plan 279 R-278-3 second half: a deterministic strip that is adopted is already a
    // passing draft, so it must authorize delivery exactly like local repair or length
    // continuation; otherwise it falls through to the fallback branch, which pastes the
    // archive sentences from the context back into the prose.
    let stripAdopted = false;
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
    // Plan 272: writer tokens are forwarded live; the final draft is only replayed
    // when it differs from what was already streamed (gate replacement, deterministic
    // fallback, minimum-length padding). Declared outside the try/catch so the
    // fallback path inside catch can replay through the same helper.
    let streamedWriterText = '';
    let liveStreamed = false;
    const compactForCompare = (value: string): string => String(value).replace(/\s+/g, '');
    // Plan 273：已送出的正文按「去空白后」映射回原文下标，用于只补发后缀。
    const compactIndexAfterPrefix = (text: string, compactPrefixLen: number): number => {
      let seen = 0;
      let index = 0;
      while (index < text.length && seen < compactPrefixLen) {
        if (!/\s/.test(text[index])) seen += 1;
        index += 1;
      }
      return index;
    };
    const emitChunks = (text: string): void => {
      const chunks = text.match(/.{1,24}/gs) || [];
      for (const chunk of chunks) {
        throwIfAborted(progress.signal);
        progress.onWriterToken?.(chunk);
      }
    };
    const emitFinalDraft = (finalText: string): void => {
      if (liveStreamed) {
        const compactFinal = compactForCompare(finalText);
        const compactStreamed = compactForCompare(streamedWriterText);
        if (compactFinal === compactStreamed) return;
        // 收口清洗/holdback 尾部常常只让最终稿多出一个后缀：只补发差异部分，
        // 避免整段 reset + 回放造成的正文闪烁与重复渲染。
        if (compactStreamed && compactFinal.startsWith(compactStreamed)) {
          emitChunks(finalText.slice(compactIndexAfterPrefix(finalText, compactStreamed.length)));
          streamedWriterText = finalText;
          return;
        }
      }
      progress.onWriterReset?.();
      emitChunks(finalText);
      streamedWriterText = finalText;
    };
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
                  liveStreamed = true;
                  progress.onWriterToken?.(token);
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
                  streamHoldback: STREAM_HOLDBACK_CHARS,
                  signal: progress.signal,
                  // Plan 272: stream the continuation too, so a token-capped scene
                  // does not leave a hole in the provisional prose.
                  onToken: (token) => {
                    streamedWriterText += token;
                    liveStreamed = true;
                    progress.onWriterToken?.(token);
                  },
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
              liveStreamed = true;
              progress.onWriterToken?.(token);
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
      // Plan 278(3)：不再用 ensureMinimumDraftLength 给模型稿填充模板句。
      // 填充池是通用「年代戏」句式（马厩/银票/更漏/算命摊…），与本文风无关，
      // 会在稿尾制造莫名其妙的段落（真机 gemini-3.1-pro-low 三连低分的稿尾崩坏，
      // 即 R-267-1 的真因）；短稿改由门禁的 chapter-below-contract 触发定向重写。
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

      const gateContext = augmentedContexts.writer;
      let draftQuality = validateCompleteChapterDraftQuality(currentDraft, undefined, {
        minChars: minDraftChars,
        context: gateContext,
      });
      // Plan 278①：设定卡泄漏几乎只出现在结尾；先做确定性剥离，剥掉后整章达标就直接采用。
      const gateSettingCards = extractSettingCardSources(gateContext);
      const strippedCards = gateSettingCards.length
        ? stripSettingCardLeaks(currentDraft, gateSettingCards)
        : null;
      const strippedEcho = stripPromptInstructionResidue(strippedCards ? strippedCards.text : currentDraft);
      const removedCount = (strippedCards?.removed.length || 0) + strippedEcho.removed.length;
      if (removedCount) {
        const strippedQuality = validateCompleteChapterDraftQuality(strippedEcho.text, undefined, {
          minChars: minDraftChars,
          context: gateContext,
        });
        // Plan 279（R-278-3）：剥离后只剩「篇幅不足」这类可续写缺陷也要采用——旧逻辑要求整章达标，
        // 结果脱敏后的短稿被丢掉、泄漏正文照旧送审（真机 pro 档位实测：strip 命中但 0 次采用）。
        // P2 只是提示级（与 validateCompleteChapterDraftQuality 的 ok 判定一致）：只有非 P2 缺陷才拦交付。
        const strippedBlockers = (strippedQuality.findings || []).filter(
          (finding) => finding.severity !== 'P2'
        );
        const stripClearsContentOnly =
          strippedBlockers.length > 0 &&
          strippedBlockers.every((finding) => finding.code === 'chapter-below-contract');
        if (strippedQuality.ok || stripClearsContentOnly) {
          currentDraft = strippedEcho.text;
          draftQuality = strippedQuality;
          stripAdopted = true;
          logger.info('[pipeline] stripped leaked archive/instruction text from the draft', {
            novelId,
            removed: removedCount,
            chars: strippedEcho.text.length,
            adoption: strippedQuality.ok ? 'gate-cleared' : 'length-continuation',
          });
        } else {
          logger.warn('[pipeline] archive/instruction residue detected; deterministic strip did not clear the gate', {
            novelId,
            removed: removedCount,
            remaining: strippedQuality.violations.slice(0, 4),
          });
        }
      }
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
        // Plan 269：先试一次段落级定点修复——只改被点名的句子，不重写整章、不放宽阈值。
        // 修完仍不过门就照旧走整章重写 / 保底稿；每次 run 最多一次，避免把改稿轮
        // 变成第二篇长文。定点修复成功即收稿，不再烧掉整章重写重试。
        // Plan 278(4)：模型稿篇幅不足（chapter-below-contract）时不再整章重写、更不用模板句凑数：
        // 用同一个 writer 提示词从断点续写补齐篇幅，再重新过门（真机 pro 档位实测单章 2.8-3.9K 字）。
        // Plan 279（R-278-2）：一轮续写未必补到下限，最多续 MAX_LENGTH_CONTINUATION_ROUNDS 轮；
        // 每轮都从最新断点续、重新过门，任一轮达标即停。
        for (
          let continuationRound = 1;
          continuationRound <= MAX_LENGTH_CONTINUATION_ROUNDS;
          continuationRound += 1
        ) {
          if (localRepairPassed || lengthContinuationPassed) break;
          if (
            !(draftQuality.findings || []).some(
              (finding) => finding.code === 'chapter-below-contract'
            ) ||
            currentDraft.trim().length < 800
          ) {
            break;
          }
          lengthContinuationAttempted = true;
          lengthContinuationRounds += 1;
          try {
            const draftChars = compactTextLength(currentDraft);
            const shortfall = Math.max(400, minDraftChars - draftChars);
            const continuationPrompt =
              renderPromptTemplate(writerAsset.template, {
                WRITER_SOUL,
                contextStr:
                  augmentedContexts.writer +
                  `\n【已写出的正文末尾——从这里无缝续写，禁止复述】\n${currentDraft.trim().slice(-1200)}`,
                skillsInfo: writerSkillsInfo,
                sceneBeats:
                  sceneSections.map((section) => section.trim()).join('\n\n') +
                  '\n\n（本章剩余场景：把尚未写完的场景全部写完，并收束本章悬念。）',
                criticFeedback: `全章目前约 ${draftChars} 字，还差约 ${shortfall} 字才到 ${minDraftChars} 字下限：请无缝续写补足篇幅，禁止重复已写内容，禁止重新开场。`,
              }) + worldviewHintsSuffix + foreshadowingSuffix + WRITER_OUTPUT_DISCIPLINE;
            const continuation = await generateText(
              writerConfig,
              {
                prompt: continuationPrompt,
                maxTokens: Math.min(4096, Math.max(2048, shortfall)),
                disableThinking: true,
                streamHoldback: STREAM_HOLDBACK_CHARS,
                signal: progress.signal,
                onToken: (token) => {
                  streamedWriterText += token;
                  liveStreamed = true;
                  progress.onWriterToken?.(token);
                },
                contextEntityFilter,
                novelId,
              },
              {
                operation: 'production-pipeline-writer-continue-length',
                novelId,
                timeoutMs: WRITER_LLM_OPTIONS.timeoutMs,
                signal: progress.signal,
              }
            );
            const appended = String(continuation || '').trim();
            if (appended) {
              const merged = `${currentDraft.trim()}\n\n${appended}`;
              const mergedQuality = validateCompleteChapterDraftQuality(merged, undefined, {
                minChars: minDraftChars,
                context: gateContext,
              });
              currentDraft = merged;
              draftQuality = mergedQuality;
              if (mergedQuality.ok) {
                lengthContinuationPassed = true;
                logger.info('[pipeline] length continuation passed the prose quality gate', {
                  novelId,
                  round: continuationRound,
                  chars: merged.length,
                });
              } else {
                logger.warn('[pipeline] length continuation did not clear the gate', {
                  novelId,
                  round: continuationRound,
                  chars: merged.length,
                  remaining: mergedQuality.violations.slice(0, 3),
                });
                if (
                  mergedQuality.mechanicalReview?.score !== undefined &&
                  (lastMechanicalScore === undefined ||
                    mergedQuality.mechanicalReview.score >= lastMechanicalScore)
                ) {
                  lastModelDraft = merged;
                  lastViolations = mergedQuality.violations;
                  lastMechanicalScore = mergedQuality.mechanicalReview?.score;
                }
              }
            }
          } catch (continuationErr) {
            logger.warn('[pipeline] length continuation failed', continuationErr);
          }
        }

        if (lengthContinuationAttempted) {
          logger.info('[pipeline] length continuation rounds finished', {
            novelId,
            rounds: lengthContinuationRounds,
            passed: lengthContinuationPassed,
            chars: currentDraft.length,
          });
        }

        // Plan 279（R-278-4）：这两个标志在每次 attempt 开始时重置（见 attempt 循环顶部），
        // 所以一个 run 的每轮重写都各自拥有一次定点修复名额，不会被上一轮用掉。
        if (!localRepairAttempted && !lengthContinuationPassed) {
          localRepairAttempted = true;
          const outcome = await attemptLocalRepairs({
            novelId,
            writerConfig: resolveWriterConfig(getConfig()),
            text: currentDraft,
            findings: draftQuality.findings || [],
            hits: draftQuality.mechanicalReview?.hits || [],
            contextStr: augmentedContexts.writer,
            minDraftChars,
            signal: progress.signal,
          });
          localRepair = outcome.summary;
          // Plan 277（R-276-3）：修复结果不再只写服务器日志——每轮修完向作者侧发一次进度。
          progress.onWriterRepair?.({
            round: outcome.summary.rounds ?? 0,
            targets: outcome.summary.targets,
            applied: outcome.summary.applied,
            batchCalls: outcome.summary.batchCalls ?? 0,
            singleCalls: outcome.summary.singleCalls ?? 0,
            status: outcome.summary.passed
              ? outcome.summary.residualCodes?.length
                ? 'residual'
                : 'passed'
              : 'failed',
            ...(outcome.summary.residualCodes?.length
              ? { residualCodes: outcome.summary.residualCodes }
              : {}),
          });
          if (outcome.text && outcome.report) {
            if (outcome.report.ok) {
              currentDraft = outcome.text;
              draftQuality = outcome.report;
              localRepairPassed = true;
              logger.info('[pipeline] local gate repair passed the prose quality gate', {
                novelId,
                rounds: outcome.summary.rounds,
                targets: outcome.summary.targets,
                applied: outcome.summary.applied,
                skipped: outcome.summary.skipped,
                batchCalls: outcome.summary.batchCalls ?? 0,
                singleCalls: outcome.summary.singleCalls ?? 0,
                ...(outcome.summary.residualCodes?.length
                  ? { residualCodes: outcome.summary.residualCodes }
                  : {}),
              });
            } else if (
              outcome.text.trim() &&
              (lastMechanicalScore === undefined ||
                (outcome.report.mechanicalReview?.score ?? 0) >= lastMechanicalScore)
            ) {
              // 修过但仍有残留命中：分数不降就留作营救候选（仍是模型稿，口径不变）。
              lastModelDraft = outcome.text;
              lastViolations = outcome.report.violations;
              lastMechanicalScore = outcome.report.mechanicalReview?.score;
            }
          }
        }
        if ((stripAdopted || localRepairPassed || lengthContinuationPassed) && draftQuality.ok) {
          // Plan 269: local repair passed the gate -> same delivery path as a clean
          // pass. Plan 272: the prose was replaced, so reset and replay the final draft.
          emitFinalDraft(currentDraft);
        } else {
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
        }
      } else {
        // Plan 272: clean pass - no duplicate replay when the delivered text equals
        // the streamed text; padding/rewrites are handled by emitFinalDraft.
        emitFinalDraft(currentDraft);
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
      // Plan 272: the fallback replaces the model prose -> reset then replay.
      emitFinalDraft(currentDraft);
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
    // Plan 275（R-273-2）：critic 轮次与最近一次重试原因，供实时进度上报。
    let criticRetryReason: string | undefined;
    let criticRound = 0;
    let criticClassification: ReturnType<typeof classifyCriticFeedback> | null = null;
    for (let criticAttempt = 0; ; criticAttempt += 1) {
      criticRound += 1;
      progress.onCriticProgress?.({
        attempt: criticRound,
        stage: criticAttempt === 0 ? 'start' : 'retry',
        reason: criticAttempt === 0 ? undefined : criticRetryReason,
      });
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
          criticRetryReason = `审计请求失败（${criticErrorCode(err)}），超时加倍重试`;
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
        criticRetryReason = `审计请求失败（${criticErrorCode(err)}），保留草稿预览`;
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
        criticRetryReason = `审计未按结构化契约返回（${parseDiagnostic.code}），收紧格式重试`;
        logger.warn(
          `Critic audit failed the structured contract (${parseDiagnostic.code}) — retrying once with ${criticMaxTokens} tokens`
        );
        continue;
      }
      // Plan 266 修复⑤（证据契约）：分数可解析但 evidence 四类不全时 classifyCriticFeedback 会判
      // unknown —— 此时重试必须补要求（不得放宽契约），否则 run 必然停在「审计不可用」。
      criticClassification = classifyCriticFeedback(criticFeedback);
      if (criticClassification.status === 'unknown') {
        criticRetryReason = '审计结论不可验证（证据四类不全），补强证据要求重试';
      }
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
    progress.onCriticProgress?.({
      attempt: criticRound,
      stage: auditStatus === 'unknown' ? 'unknown' : 'parsed',
      score: auditStatus === 'unknown' ? undefined : auditScore,
      reason:
        auditStatus === 'unknown' ? criticRetryReason ?? '审计结论不可验证' : undefined,
    });
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
    ...(localRepair ? { localRepair } : {}),
  };
}
