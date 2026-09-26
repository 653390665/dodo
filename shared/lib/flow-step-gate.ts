/**
 * 步骤质量门判定与推进拦截（批次 B「质量门判定与推进拦截」，规格
 * docs/specs/capability-flow-graph-consolidation.md §5.2）。
 *
 * `SkillSeriesFlowStep.gate = { kind, threshold?, note? }` 是步骤质量的唯一门槛字段
 * （批次 C「双门合一」：旧 `qualityGate: string` 已删除，文案迁入 `gate.note`）。判定源
 * 全部复用既有事实源，不新造标准：
 * - `mechanical` → shared 整章交付门 `validateCompleteChapterDraftQuality`（阈值可作为最小有效字符数覆盖）；
 * - `critic`     → 服务端 `classifyCriticFeedback` 的分类结果（调用方注入 `{ status, score? }`）；
 * - `manual`     → 显式人工确认；
 * - `advisory`   → 仅渲染 `note` 文本，**不拦截推进**（迁移前的文本门行为）。
 *
 * 不变量：
 * - **未声明 gate 的步骤不产生拦截**（`status:'pass'` + `FLOW_STEP_GATE_UNDECLARED` 警告），旧链路行为不变；
 * - **不能确认就不放行**：审稿 `unknown`/未运行、标了阈值但分数缺失 → `blocked`，原因写明；
 * - 逃生门：`skipReason` 非空 → `status:'skipped'`，并以 `skipped-step:{flowId}:{stepId}:{原因}` 标签落库，
 *   由 `getNovelSkippedSteps` 读回（「记录跳过原因且可查询」）。
 *
 * 纯函数，无 IO；标签读写与应用都走 `buildFlowStepAdvanceTags` 单一出口。
 */
import {
  MIN_COMPLETE_CHAPTER_CHARS,
  MIN_COMPLETE_SCENE_CHARS,
  validateCompleteChapterDraftQuality,
} from './draft-quality.js';
import type { Novel, ChapterAuditStatus } from '../types.js';
import type { FlowStepGate, FlowStepGateKind } from '../types/prompt-assets-governed.js';

export type { FlowStepGate, FlowStepGateKind };

export const FLOW_STEP_GATE_KINDS = ['mechanical', 'critic', 'manual', 'advisory'] as const;

/** 各门类型的中文标签（UI 与回执同源）。 */
export const FLOW_STEP_GATE_KIND_LABELS: Record<FlowStepGateKind, string> = {
  mechanical: '机械门（草稿质量）',
  critic: '审稿门（critic 分数）',
  manual: '人工确认门',
  advisory: '文本验收（不拦截）',
};

export const FLOW_STEP_GATE_WARNINGS = [
  'FLOW_STEP_GATE_UNDECLARED',
  'FLOW_STEP_GATE_KIND_INVALID',
  'FLOW_STEP_GATE_THRESHOLD_INVALID',
  'FLOW_STEP_GATE_DRAFT_MISSING',
  'FLOW_STEP_GATE_CRITIC_MISSING',
  'FLOW_STEP_GATE_CRITIC_SCORE_MISSING',
  'FLOW_STEP_GATE_SKIP_RECORDED',
  'FLOW_STEP_GATE_SKIP_WITHOUT_BLOCK',
  /** `advisory` 门：只渲染文本、不拦截推进（迁移自旧 `qualityGate`）。 */
  'FLOW_STEP_GATE_ADVISORY',
  /** 声明了 `advisory` 门却带 threshold（阈值不参与判定，仅记录）。 */
  'FLOW_STEP_GATE_THRESHOLD_IGNORED',
] as const;
export type FlowStepGateWarning = (typeof FLOW_STEP_GATE_WARNINGS)[number];

/** critic 门输入：`classifyCriticFeedback` 的分类结果（分数可缺省）。 */
export interface FlowStepCriticSignal {
  readonly status: ChapterAuditStatus;
  readonly score?: number;
}

/**
 * 界面可提供的步骤产物证据（`PlanningTabProps['stepEvidence']` 的单一类型源）。
 * 前六项是 PRD Story 5 的产物计数；`draftText` / `critic` 供质量门判定使用。
 */
export interface FlowStepEvidenceCounts {
  ideaChars?: number;
  worldEntityCount?: number;
  outlineChars?: number;
  sceneBeatsChars?: number;
  draftChars?: number;
  /** 审稿是否通过（`polished-draft` 旧口径；新代码请改用 `critic`）。 */
  auditPassed?: boolean;
  /** mechanical 门输入：章节正文全文。 */
  draftText?: string;
  /** critic 门输入：最近一次结构化审稿分类（缺省 = 未运行）。 */
  critic?: FlowStepCriticSignal | null;
}

export interface FlowStepGateInput {
  readonly gate?: FlowStepGate | null;
  /** mechanical 门输入：待校验正文（章节草稿）。 */
  readonly draftText?: string;
  /** critic 门输入：最近一次结构化审稿的分类结果。 */
  readonly critic?: FlowStepCriticSignal | null;
  /** manual 门输入：人工确认。 */
  readonly confirmed?: boolean;
  /** 逃生门：非空即跳过（记录原因），不再拦截。 */
  readonly skipReason?: string;
}

export interface FlowStepGateEvidence {
  readonly draftChars?: number;
  /** 机械门评分（AI 腔/结构缺陷评分）。 */
  readonly mechanicalScore?: number;
  /** 机械门评分放行线（`mechanicalReview.threshold`，当前 85）。 */
  readonly mechanicalScoreThreshold?: number;
  /** 机械门实际生效的最小有效字符数（声明阈值按 [800, 4000] 夹取）。 */
  readonly mechanicalRequiredChars?: number;
  readonly violations?: string[];
  readonly criticStatus?: ChapterAuditStatus;
  readonly criticScore?: number;
}

export interface FlowStepGateEvaluation {
  readonly status: 'pass' | 'blocked' | 'skipped';
  /** null = 步骤未声明 gate（不判定）。 */
  readonly kind: FlowStepGateKind | null;
  /** 拦截原因（blocked 时非空；skipped 时保留「本会被拦的原因」便于审计）。 */
  readonly reasons: string[];
  readonly evidence: FlowStepGateEvidence;
  readonly skipReason?: string;
  readonly warnings: FlowStepGateWarning[];
}

export const FLOW_STEP_SKIP_TAG_PREFIX = 'skipped-step:';
/** 跳过原因写入标签前的长度上限（避免标签无限膨胀）。 */
export const FLOW_STEP_SKIP_REASON_MAX = 120;

const BLOCKED_REASON_LIMIT = 3;

function isKnownGateKind(kind: string): kind is FlowStepGateKind {
  return (FLOW_STEP_GATE_KINDS as readonly string[]).includes(kind);
}

function hasUsableThreshold(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * 提示词 `【质量门】` 行的唯一文案出口：优先 `gate.note`（旧 qualityGate 文案），
 * 缺省时回退到门类型标签 + 阈值。未声明 gate → 显式说明「不判定」。
 */
export function flowStepGatePromptText(gate?: FlowStepGate | null): string {
  if (!gate) return '未声明质量门（不判定）';
  const note = typeof gate.note === 'string' ? gate.note.trim() : '';
  if (note) return note;
  const kind = isKnownGateKind(String(gate.kind)) ? gate.kind : null;
  const label = kind ? FLOW_STEP_GATE_KIND_LABELS[kind] : String(gate.kind);
  const threshold = typeof gate.threshold === 'number' ? `（阈值 ${gate.threshold}）` : '';
  return `${label}${threshold}`;
}

export interface FlowStepGateDisplay {
  readonly kind: FlowStepGateKind | null;
  readonly kindLabel: string;
  /** true = 文本验收门：只展示，不拦截推进。 */
  readonly advisory: boolean;
  /** true = 该门会拦截推进（mechanical / critic / manual）。 */
  readonly intercepting: boolean;
  readonly text: string;
}

/** 界面展示口径（与提示词共用 flowStepGatePromptText）。 */
export function flowStepGateDisplay(gate?: FlowStepGate | null): FlowStepGateDisplay {
  if (!gate || !isKnownGateKind(String(gate.kind))) {
    return {
      kind: null,
      kindLabel: '未声明',
      advisory: false,
      intercepting: false,
      text: flowStepGatePromptText(null),
    };
  }
  return {
    kind: gate.kind,
    kindLabel: FLOW_STEP_GATE_KIND_LABELS[gate.kind],
    advisory: gate.kind === 'advisory',
    intercepting: gate.kind !== 'advisory',
    text: flowStepGatePromptText(gate),
  };
}

function compactChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

function normalizeSkipReason(reason: string | undefined): string {
  return (reason || '').replace(/\s+/g, ' ').trim().slice(0, FLOW_STEP_SKIP_REASON_MAX);
}

/** 解析步骤声明的 gate：未声明 / 结构非法 → null（不判定，旧行为不变）。 */
export function resolveFlowStepGate(
  step: { gate?: FlowStepGate } | null | undefined
): FlowStepGate | null {
  const gate = step?.gate;
  if (!gate || !isKnownGateKind(String(gate.kind))) return null;
  return gate;
}

function evaluateMechanical(
  input: FlowStepGateInput,
  threshold: number | undefined,
  warnings: FlowStepGateWarning[]
): { reasons: string[]; evidence: FlowStepGateEvidence } {
  const draft = input.draftText ?? '';
  // 与 validateCompleteChapterDraftQuality 内部同一夹取规则：声明值只能把字符门档位
  // 在 [场景下限, 整章上限] 之间调整，不能突破整章交付合同。
  const requiredChars = Math.min(
    Math.max(threshold ?? MIN_COMPLETE_CHAPTER_CHARS, MIN_COMPLETE_SCENE_CHARS),
    MIN_COMPLETE_CHAPTER_CHARS
  );
  if (!draft.trim()) {
    warnings.push('FLOW_STEP_GATE_DRAFT_MISSING');
    return {
      reasons: ['未提供草稿文本，无法执行机械门校验'],
      evidence: { draftChars: 0, mechanicalRequiredChars: requiredChars },
    };
  }
  const result = validateCompleteChapterDraftQuality(
    draft,
    undefined,
    threshold === undefined ? undefined : { minChars: threshold }
  );
  const mechanical = result.mechanicalReview;
  const evidence: FlowStepGateEvidence = {
    draftChars: compactChars(draft),
    mechanicalRequiredChars: requiredChars,
    ...(mechanical
      ? {
          mechanicalScore: mechanical.score,
          mechanicalScoreThreshold: mechanical.threshold,
        }
      : {}),
  };
  if (result.ok) return { reasons: [], evidence };
  const violations = result.violations.slice(0, BLOCKED_REASON_LIMIT);
  return {
    reasons: violations.length > 0 ? violations : ['草稿未通过整章交付质量门'],
    evidence: { ...evidence, violations },
  };
}

function evaluateCritic(
  input: FlowStepGateInput,
  threshold: number | undefined,
  warnings: FlowStepGateWarning[]
): { reasons: string[]; evidence: FlowStepGateEvidence } {
  const critic = input.critic;
  const status = critic?.status;
  if (!status || status === 'not_run') {
    warnings.push('FLOW_STEP_GATE_CRITIC_MISSING');
    return { reasons: ['审稿未运行，无法执行 critic 门校验'], evidence: { criticStatus: status ?? 'not_run' } };
  }
  const evidence: FlowStepGateEvidence = {
    criticStatus: status,
    ...(typeof critic?.score === 'number' ? { criticScore: critic.score } : {}),
  };
  if (status === 'unknown') {
    return { reasons: ['审稿结果不可验证（unknown），未确认达标前不放行'], evidence };
  }
  if (status === 'fail') {
    return {
      reasons: [`审稿未通过${typeof critic?.score === 'number' ? `（${critic.score} 分）` : ''}`],
      evidence,
    };
  }
  if (threshold !== undefined) {
    if (typeof critic?.score !== 'number' || !Number.isFinite(critic.score)) {
      warnings.push('FLOW_STEP_GATE_CRITIC_SCORE_MISSING');
      return { reasons: [`审稿分数不可得，无法确认达到阈值 ${threshold}`], evidence };
    }
    if (critic.score < threshold) {
      return { reasons: [`审稿分数 ${critic.score} 低于阈值 ${threshold}`], evidence };
    }
  }
  return { reasons: [], evidence };
}

/**
 * 判定步骤质量门。返回 `blocked` 时调用方**不得推进**；`skipped` 需带非空 `skipReason`
 * 并用 `buildFlowStepAdvanceTags` 落标签。
 */
export function evaluateFlowStepGate(input: FlowStepGateInput): FlowStepGateEvaluation {
  const warnings: FlowStepGateWarning[] = [];
  const skipReason = normalizeSkipReason(input.skipReason);

  let base: FlowStepGateEvaluation;
  const gate = input.gate ?? null;
  if (!gate) {
    warnings.push('FLOW_STEP_GATE_UNDECLARED');
    base = { status: 'pass', kind: null, reasons: [], evidence: {}, warnings };
  } else if (!isKnownGateKind(String(gate.kind))) {
    warnings.push('FLOW_STEP_GATE_KIND_INVALID');
    base = {
      status: 'blocked',
      kind: null,
      reasons: [`未知质量门类型「${String(gate.kind)}」，无法判定`],
      evidence: {},
      warnings,
    };
  } else if (gate.threshold !== undefined && !hasUsableThreshold(gate.threshold)) {
    warnings.push('FLOW_STEP_GATE_THRESHOLD_INVALID');
    base = {
      status: 'blocked',
      kind: gate.kind,
      reasons: [`质量门阈值「${String(gate.threshold)}」非法，无法判定`],
      evidence: {},
      warnings,
    };
  } else if (gate.kind === 'advisory') {
    if (gate.threshold !== undefined) warnings.push('FLOW_STEP_GATE_THRESHOLD_IGNORED');
    warnings.push('FLOW_STEP_GATE_ADVISORY');
    base = { status: 'pass', kind: 'advisory', reasons: [], evidence: {}, warnings };
  } else {
    const threshold = gate.threshold;
    const outcome =
      gate.kind === 'mechanical'
        ? evaluateMechanical(input, threshold, warnings)
        : gate.kind === 'critic'
          ? evaluateCritic(input, threshold, warnings)
          : { reasons: input.confirmed === true ? [] : ['该步骤需要人工确认后方可推进'], evidence: {} };
    base = {
      status: outcome.reasons.length === 0 ? 'pass' : 'blocked',
      kind: gate.kind,
      reasons: outcome.reasons,
      evidence: outcome.evidence,
      warnings,
    };
  }

  if (!skipReason) return base;
  warnings.push('FLOW_STEP_GATE_SKIP_RECORDED');
  if (base.status === 'pass') warnings.push('FLOW_STEP_GATE_SKIP_WITHOUT_BLOCK');
  return { ...base, status: 'skipped', skipReason };
}

/** 生成跳过记录标签；原因归一后为空 → 返回空串（跳过必须带原因）。 */
export function formatFlowStepSkipTag(activeSeriesId: string, stepId: string, reason: string): string {
  const normalized = normalizeSkipReason(reason);
  if (!activeSeriesId || !stepId || !normalized) return '';
  return `${FLOW_STEP_SKIP_TAG_PREFIX}${activeSeriesId}:${stepId}:${normalized}`;
}

/** 解析跳过记录标签（原因允许含 `:`，按前两段切分后整体回填）。 */
export function parseFlowStepSkipTag(
  tag: string
): { seriesId: string; stepId: string; reason: string } | null {
  if (!tag.startsWith(FLOW_STEP_SKIP_TAG_PREFIX)) return null;
  const parts = tag.slice(FLOW_STEP_SKIP_TAG_PREFIX.length).split(':');
  if (parts.length < 3) return null;
  const [seriesId, stepId, ...rest] = parts;
  if (!seriesId || !stepId) return null;
  return { seriesId, stepId, reason: rest.join(':') };
}

/** 查询某条链路的跳过记录（跳过原因可查询）。 */
export function getNovelSkippedSteps(
  novel: Novel,
  activeSeriesId: string
): { stepId: string; reason: string }[] {
  const tags = novel.projectPreferenceProfile?.tags || [];
  const result: { stepId: string; reason: string }[] = [];
  for (const tag of tags) {
    const parsed = parseFlowStepSkipTag(tag);
    if (parsed && parsed.seriesId === activeSeriesId) {
      result.push({ stepId: parsed.stepId, reason: parsed.reason });
    }
  }
  return result;
}

/**
 * 步骤推进标签的单一出口（`current-step:` / `completed-step:` / `completed-flow:` /
 * `skipped-step:`）。语义：
 * - 完成当前步并入列 `completedStepIds`（顺序与旧实现一致）；
 * - 有 `nextStepId` → 标记下一步为 current；否则写 `completed-flow:{flowId}`；
 * - 带 `skipReason` → 额外写跳过记录（该步仍计入完成，原因独立可查）；
 * - 不带 `skipReason` 完成某步时，清掉该步的**旧跳过记录**（重新完成即纠正历史）。
 */
export function buildFlowStepAdvanceTags(input: {
  activeSeriesId: string;
  tags?: readonly string[] | null;
  completedStepIds: readonly string[];
  currentStepId: string;
  nextStepId?: string | null;
  skipReason?: string;
}): string[] {
  const { activeSeriesId, completedStepIds, currentStepId, nextStepId } = input;
  const currentPrefix = `current-step:${activeSeriesId}:`;
  const completedPrefix = `completed-step:${activeSeriesId}:`;
  const skipReason = normalizeSkipReason(input.skipReason);
  // 保持旧实现顺序：先保留无关标签，再追加完成标记与 current 标记。
  const otherTags = (input.tags ?? []).filter((tag) => {
    if (tag.startsWith(currentPrefix) || tag.startsWith(completedPrefix)) return false;
    const parsedSkip = parseFlowStepSkipTag(tag);
    // 不带原因的重新完成 → 清掉该步旧跳过记录；带原因跳过 → 由下文追加新记录。
    if (!skipReason && parsedSkip && parsedSkip.seriesId === activeSeriesId) {
      return parsedSkip.stepId !== currentStepId;
    }
    return true;
  });
  const completedSet = new Set(completedStepIds);
  completedSet.add(currentStepId);
  const nextTags = [
    ...otherTags,
    ...Array.from(completedSet).map((id) => `completed-step:${activeSeriesId}:${id}`),
  ];
  if (nextStepId) {
    nextTags.push(`current-step:${activeSeriesId}:${nextStepId}`);
  } else {
    // 最后一步：标记整条链路完成，避免缺 current-step 标签时回退到第 1 步。
    nextTags.push(`completed-flow:${activeSeriesId}`);
  }
  const skipTag = skipReason ? formatFlowStepSkipTag(activeSeriesId, currentStepId, skipReason) : '';
  if (skipTag) nextTags.push(skipTag);
  return nextTags;
}
