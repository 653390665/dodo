/**
 * 公开目录生成管线（单一事实源 / 本小类核心）。
 *
 * 为什么存在：`scripts/generate-public-catalog.ts` 是 CLI（含 fs 写入），守卫测试无法直接
 * 复用它内部的纯函数，仓内因此长期存在两份手工同步的镜像副本
 * （tests/public-catalog-freshness.test.ts、tests/public-catalog-governance.test.ts 的
 * 「镜像自 scripts/generate-public-catalog.ts」段落）。本模块只放纯函数（无 fs、无顶层副作用），
 * 生成脚本与守卫测试共用同一实现，「生成物 = 源」的断言不会再因镜像漂移而误报/漏报。
 *
 * 安全敏感：改动本模块等于改动公开目录的全部卡面正文，必须重跑
 * `node --import tsx scripts/generate-public-catalog.ts` 再生产物。
 */
import {
  GOVERNED_ASSETS_V2_REGISTRY,
  SKILL_SERIES_FLOWS,
  CURATED_PRODUCT_SKILLS,
  PROMPT_GOVERNANCE_CATALOG,
  ENHANCEMENT_PACKAGES,
  isPublicRuntimeAsset,
} from '../../shared/lib/prompt-governance-catalog.js';
import {
  COMMERCIAL_COPY_PATTERN,
  sanitizeWhiteLabelText,
} from '../../shared/lib/prompt-sanitizer.js';
import { isShellTemplatePrompt } from '../../shared/lib/prompt-shell.js';
// Plan 262 B2：分档与封顶分常量单源（此前本文件自带一份分档实现）。
import {
  FEATURED_MIN_SCORE,
  PLACEHOLDER_SCORE_CAP,
  gradeFromScore,
} from '../../shared/lib/prompt-score-policy.js';
export { FEATURED_MIN_SCORE, PLACEHOLDER_SCORE_CAP } from '../../shared/lib/prompt-score-policy.js';
import type {
  CuratedProductSkill,
  EnhancementPackage,
  GovernedPromptAsset,
  SkillSeriesFlow,
} from '../../shared/types/prompt-assets-governed.js';

export const CATALOG_MODULE_PATH = 'shared/lib/public-skill-catalog.ts';

// Define the keys that contain sanitizable human-facing text
const TEXT_KEYS_TO_SANITIZE = new Set([
  'title',
  'goal',
  'successSignal',
  'description',
  'name',
  'whyUpgrade',
  'riskNotes',
  'recommendationReason',
]);

// 嵌套路径的文本键（步骤质量门文案迁入 gate.note，见 Plan 262 C2「双门合一」）：
// 按「父键.子键」精确匹配，避免把任意对象的 note 都当可脱敏文本。
const PATH_TEXT_KEYS_TO_SANITIZE = new Set(['gate.note']);

/**
 * Deep-cleans and sanitizes strings, converting specific brand-related terminology
 * into industry-standard clean text representation.
 */
export function cleanText(text: string): string {
  if (!text) return '';
  // 1. Run prompt-governance-catalog's standard white-label sanitizer
  let s = sanitizeWhiteLabelText(text);
  // 2. Perform specific map replacements for "小飞鸡" and "风华" as requested
  s = s.replace(/小飞鸡长篇流/g, '长篇商业连载流程');
  s = s.replace(/小飞鸡、风华/g, '名家');
  s = s.replace(/小飞鸡/g, '名家');
  s = s.replace(/风华/g, '名家');
  s = s.replace(/天马/g, '结构工坊');
  s = s.replace(/墨流/g, '外部工具');
  // 2.5. Normalize author-facing asset names so the public shelf describes
  // confirmable tools rather than promising automatic one-click outcomes.
  s = s.replace(/长篇一键破解爆款小说并生成脑洞/g, '长篇爆款拆解与脑洞生成');
  s = s.replace(/一键破解爆款并生成脑洞/g, '爆款拆解与脑洞生成');
  s = s.replace(/一键生成章节梗概/g, '章节梗概生成');
  s = s.replace(/一键润色降ai\s*([0-9.]+)/gi, '降 AI 润色 $1');
  s = s.replace(/一键融梗换心/g, '融梗换心候选生成');
  // 3. Final round of system sanitizer just in case
  s = sanitizeWhiteLabelText(s);
  return s;
}

// isPublicRuntimeAsset 已单源化至 shared/lib/prompt-governance-catalog.ts（Plan 197 Step 1），
// 生成脚本与新鲜度守卫共用同一判定。

/**
 * 深度克隆并脱敏对象，清空 "template" 属性并对文本字段进行白标清洗
 * Deep clones and sanitizes objects, clearing "template" attributes and sanitizing text keys
 */
export function cloneAndSanitize<T>(obj: T): T {
  return cloneAndSanitizeAt(obj, '');
}

function cloneAndSanitizeAt<T>(obj: T, path: string): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => cloneAndSanitizeAt(item, path)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const copy: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;
    for (const key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        const val = record[key];
        const childPath = path ? `${path}.${key}` : key;
        if (key === 'template') {
          copy[key] = ''; // 物理强制清空提示词模板 / Force set template to empty string physically
        } else if (
          (TEXT_KEYS_TO_SANITIZE.has(key) || PATH_TEXT_KEYS_TO_SANITIZE.has(childPath)) &&
          typeof val === 'string'
        ) {
          copy[key] = cleanText(val);
        } else if (typeof val === 'object') {
          copy[key] = cloneAndSanitizeAt(val, childPath);
        } else {
          copy[key] = val;
        }
      }
    }
    return copy as unknown as T;
  }
  return obj;
}

// ─── 生成侧消毒副本（Plan 197 Step 2）─────────────────────────────────────────
// 镜像运行时先例 POST /api/skills/sanitize/:assetId（server/routes/skills.ts）：
// id = 'sanitized-' + asset.id，文案字段走白标清洗管线，runtime-ready + active，
// sourceType 'plaza'。与公开目录本体的区别：副本保留消毒后的提示词主体
// （运行时端点把 asset.template 消毒后写入 style 字段，不物理清空），
// placementTier 提升为公开档 'optional-style'。test-fixture 候选不产副本（与货架口径一致）。

export const SANITIZED_COPY_NOTE =
  '生成侧消毒副本：白标清洗完成，原署名与联系方式已剥离。';

// ─── Plan 234 消毒副本文案变体（构建期改写）────────────────────────────────
// 源候选的 goal 模板含商业承诺词（如「利用定制付费资产…」），原样透传会在渲染时
// 被 getCapabilityDisplayText 塌缩成同一句「广场共享能力…」（31/38 张同句）。
// 构建期按 primaryCategory 桶轮换改写（卡名入文案保证跨卡可辨），改写后不含
// 商业词，运行时替换自然不触发（保留兜底）。
type GoalVariantFactory = (cardTitle: string) => string;

const SANITIZED_GOAL_VARIANTS: Record<string, GoalVariantFactory[]> = {
  'constellation-pack': [
    (t) => `题材风格包：围绕「${t}」提供题材背景与配置基线，效果以实际运行为准。`,
    (t) => `「${t}」的社区题材支撑卡：补充题材期待与红线约束，请以生成结果自验。`,
    (t) => `面向「${t}」的共享题材模板：提供背景支撑与配置起点。`,
  ],
  'utility-tool': [
    (t) => `「${t}」的社区工具卡：按卡面说明辅助相应环节，效果请以实际生成验证。`,
    (t) => `共享工具提示词（${t}）：作用范围见卡面，效果因作品而异。`,
    (t) => `${t}：社区供给的辅助工具，写作效果以运行为准。`,
  ],
  'author-workflow': [
    (t) => `「${t}」的社区写作配方：服务卡面所示创作环节，效果请以实际生成验证。`,
    (t) => `共享写作提示词（${t}）：聚焦卡面场景，效果因作品而异。`,
    (t) => `${t}：社区贡献的写作配方，生成效果以运行为准。`,
  ],
};

const SANITIZED_GOAL_DEFAULT_VARIANTS: GoalVariantFactory[] = [
  (t) => `广场共享写作卡（${t}）：围绕卡面主题提供提示词支持，实际效果以运行结果为准。`,
  (t) => `社区贡献的写作配方（${t}），效果请以实际生成验证。`,
  (t) => `${t}：广场共享提示词模板，写作效果因作品而异。`,
];

const SANITIZED_SIGNAL_VARIANTS = [
  '实际效果以运行结果为准。',
  '效果请以实际生成验证。',
  '社区供给 · 效果请自验。',
];

/**
 * 改写计数器（原为生成脚本的模块级可变状态；改成显式传入后本管线可重入，
 * 同一进程内连续生成两次得到逐字节相同的产物）。
 */
export interface SanitizedCopyRewriteCounters {
  goal: number;
  signal: number;
}

export function createSanitizedCopyRewriteCounters(): SanitizedCopyRewriteCounters {
  return { goal: 0, signal: 0 };
}

export function rewriteSanitizedCopyText(
  field: 'goal' | 'successSignal',
  text: string | undefined,
  cardTitle: string,
  primaryCategory: string | undefined,
  counters: SanitizedCopyRewriteCounters
): string {
  const clean = sanitizeCopyText(text);
  if (!clean || !COMMERCIAL_COPY_PATTERN.test(clean)) return clean;
  if (field === 'successSignal') {
    const signal = SANITIZED_SIGNAL_VARIANTS[counters.signal % SANITIZED_SIGNAL_VARIANTS.length];
    counters.signal += 1;
    return signal;
  }
  counters.goal += 1;
  const bucket = primaryCategory ? SANITIZED_GOAL_VARIANTS[primaryCategory] : undefined;
  const variants = bucket ?? SANITIZED_GOAL_DEFAULT_VARIANTS;
  const variant = variants[counters.goal % variants.length];
  return variant(cardTitle);
}

export function sanitizeCopyText(text: string | undefined): string {
  return text ? cleanText(text) : '';
}

// ─── Plan 258 散卡层治理：占位空壳评分惩罚（Step 1）──────────────────────────
// 依据（三路审查实证）：square-* 批量投喂的模板体只有「广场优秀提示词模版体」占位句，
// 却按 scorecard 分拿 74-88 高分（47 张），「88 分的卡没有正文」直接误导用户；
// sanitized-raw-comp-brand-detector 正文消毒后仅剩 22 字残缺句。
// 规则：占位/残缺正文 → score 封顶 60（grade 按源映射同步校准）。
// 只改分与档，卡片数量守恒；licensed/private-* 付费版块与白标精选不在此规则射程
// （它们的正文为真实内容，占位判定天然不命中）。
//
// 可单测性（本小类落地）：纯函数已抽至本模块，生成脚本与两个守卫测试同源 import，
// 不再需要仓内镜像副本。

// 占位标记：square 批量投喂循环（prompt-governance-catalog.ts rawSquareConfigs）
// 写入的模板占位句特征词。
export const PLACEHOLDER_TEMPLATE_MARKER = '广场优秀提示词模版体';
// 消毒副本运行时正文的最短可信长度（字符）。扫描实证：真实副本正文最短 103 字，
// 残缺壳（sanitized-raw-comp-brand-detector）22 字，取 80 居中分离。计划建议值 120
// 会误伤 9 张 103-119 字的真实 private 副本（private-* 分档不在治理射程），据证据否决；
// 源卡级禁用本数值阈值——源级真实正文最短 23 字（内置工具卡）与占位句 37-50 字区间
// 交叠，任何数值阈值都必然误伤真实卡，源级仅用「标记命中或模板为空」判定。
export const PLACEHOLDER_BODY_MIN_LENGTH = 80;
// 占位惩罚封顶分：占位/残缺正文的卡评分不得高于此值。
// featured 档最低分门槛（Plan 258 Step 2）：低于此分或正文占位的卡不得挂 featured
// ——审查实证 sanitized-raw-comp-brand-detector（45 分、正文残缺）挂 featured 档失守。

type PlaceholderPredicate = (template: string | undefined) => boolean;

/**
 * 源卡占位判定（公共目录/注册表条目）：模板为空或命中占位标记。
 * 不使用数值长度阈值（会误伤真实短卡，见 PLACEHOLDER_BODY_MIN_LENGTH 注释）。
 */
export function isPlaceholderSourceBody(template: string | undefined): boolean {
  return !template || template.includes(PLACEHOLDER_TEMPLATE_MARKER);
}

/**
 * 消毒副本占位判定：源级判定之外，运行时正文低于可信长度阈值同样视为占位
 * （残缺壳经白标清洗后只剩联系方式残句）。
 */
export function isPlaceholderRuntimeBody(template: string | undefined): boolean {
  if (isPlaceholderSourceBody(template)) return true;
  return (template as string).length < PLACEHOLDER_BODY_MIN_LENGTH;
}

/**
 * 与 prompt-governance-catalog.ts square 投喂循环一致的 grade 映射
 * （≥90 A / ≥80 B / 其余 C），封顶降分后同步校准，避免「60 分 B 级」的新脱钩。
 */
export function recalibrateGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  // Plan 262 B2：与治理目录同一分档实现（A≥90 / B≥80 / C≥70 / D≥60 / F<60）。
  return gradeFromScore(score);
}

/**
 * 占位评分惩罚（纯函数）：命中占位判定且 score 高于封顶值时，把 score 降到封顶
 * 并同步校准 grade；已低于封顶的卡原样返回（封顶只降不升，保留原 grade 语义）。
 */
export function applyPlaceholderScorePenalty(
  asset: GovernedPromptAsset,
  isPlaceholder: PlaceholderPredicate
): GovernedPromptAsset {
  if (!isPlaceholder(asset.template)) return asset;
  if ((asset.score ?? 0) <= PLACEHOLDER_SCORE_CAP) return asset;
  return { ...asset, score: PLACEHOLDER_SCORE_CAP, grade: recalibrateGrade(PLACEHOLDER_SCORE_CAP) };
}

/** 源卡惩罚入口（绑定源级占位判定）。 */
export function applyPlaceholderScorePenaltySource(
  asset: GovernedPromptAsset
): GovernedPromptAsset {
  return applyPlaceholderScorePenalty(asset, isPlaceholderSourceBody);
}

/** 消毒副本惩罚入口（绑定副本运行时正文占位判定）。 */
export function applyPlaceholderScorePenaltyCopy(
  asset: GovernedPromptAsset
): GovernedPromptAsset {
  return applyPlaceholderScorePenalty(asset, isPlaceholderRuntimeBody);
}

/**
 * featured 授予守卫（纯函数）：score < FEATURED_MIN_SCORE 或正文占位的卡
 * 拒绝 featured 档，已挂的降 standard；其余档位原样返回。
 */
export function applyFeaturedGuard(
  asset: GovernedPromptAsset,
  isPlaceholder: PlaceholderPredicate
): GovernedPromptAsset {
  if (asset.curationTier !== 'featured') return asset;
  if ((asset.score ?? 0) < FEATURED_MIN_SCORE || isPlaceholder(asset.template)) {
    return { ...asset, curationTier: 'standard' };
  }
  return asset;
}

/** 源卡治理组合：先惩罚后守卫（封顶后 60 < 70 自然触发降档）。 */
export function applySourceCardGovernance(asset: GovernedPromptAsset): GovernedPromptAsset {
  const penalized = applyPlaceholderScorePenaltySource(asset);
  return applyFeaturedGuard(penalized, isPlaceholderSourceBody);
}

/** 消毒副本治理组合：判定基准为副本自身的运行时正文。 */
export function applySanitizedCopyGovernance(asset: GovernedPromptAsset): GovernedPromptAsset {
  const penalized = applyPlaceholderScorePenaltyCopy(asset);
  return applyFeaturedGuard(penalized, isPlaceholderRuntimeBody);
}

/** 治理前后差异留痕：score/curationTier 被改动的卡逐张列出，供生成日志审计。 */
export function diffGovernanceChanges(
  before: GovernedPromptAsset[],
  after: GovernedPromptAsset[]
): string[] {
  const afterById = new Map(after.map((asset) => [asset.id, asset]));
  return before
    .map((asset) => {
      const governed = afterById.get(asset.id);
      if (!governed) return '';
      const parts: string[] = [];
      if (governed.score !== asset.score) parts.push(`score ${asset.score}→${governed.score}`);
      if (governed.curationTier !== asset.curationTier) {
        parts.push(`curationTier ${asset.curationTier || '-'}→${governed.curationTier || '-'}`);
      }
      return parts.length > 0 ? `${asset.id}（${parts.join('，')}）` : '';
    })
    .filter((entry) => entry !== '');
}

// ─── Plan 233 目录准入规则（生成侧守门，排除动作全部留痕）────────────────────
// 垃圾标题：测试/内测卡与 test 边界匹配——只拦「以测试开头/结尾」「以内测开头/结尾」
// 与整名等值，不误伤语义完整标题（如「A/B 测试设计器」不在本目录域）。
export const JUNK_TITLE_PATTERN = /(^测试)|(^内测)|(^test)|(测试$)|(内测$)|(test$)/i;

// 镜像渲染路径那份 sanitizeWhiteLabelText（public-skill-catalog 生成副本，含
// 「X出品/X专用/X定制/X私有化/X自用」通配剥除）的品牌剥除规则：整名被剥空的卡
// 上架即空标题卡（如 private-186「fire角色定制」），源头不入册。
export function renderPathTitleCollapsesToEmpty(title: string): boolean {
  return (
    !title
      .replace(/【[^】]*(?:出品|专用|定制|私有化|自用)[^】]*】/g, '')
      .replace(/[\u4e00-\u9fa5A-Za-z0-9_-]{1,24}(?:出品|专用|定制)/g, '')
      .trim()
      ? true
      : false
  );
}

// 标准化去重键：先过渲染路径 sanitizer（Plan 236 合一后品牌剥除一致），再去空白/结尾数字
// ——「沐殇定制细纲」与「细纲」这类换皮重投在合一后互为同卡。
export function normalizedTitleKey(title: string): string {
  return sanitizeWhiteLabelText(title).replace(/\s+/g, '').replace(/\d+$/, '');
}

/** 公开池准入（Plan 233）：垃圾标题 / 渲染空标题的卡不入册。 */
export function admitPublicAsset(asset: GovernedPromptAsset): boolean {
  return (
    !JUNK_TITLE_PATTERN.test((asset.title || '').trim()) &&
    !renderPathTitleCollapsesToEmpty((asset.title || '').trim())
  );
}

export interface SanitizeCandidateCollection {
  candidates: GovernedPromptAsset[];
  excluded: string[];
  deduped: string[];
}

export function collectSanitizeCandidates(): SanitizeCandidateCollection {
  const seen = new Set<string>();
  const merged = [...GOVERNED_ASSETS_V2_REGISTRY, ...PROMPT_GOVERNANCE_CATALOG].filter((asset) =>
    seen.has(asset.id) ? false : (seen.add(asset.id), true)
  );
  const eligible = merged.filter(
    (asset) =>
      asset.placementTier === 'sanitize-required' &&
      asset.sanitizationStatus === 'needs-sanitization' &&
      asset.runtimeStatus === 'candidate' &&
      asset.sourceGroup !== 'test-fixture'
  );
  const junk = eligible.filter(
    (asset) =>
      JUNK_TITLE_PATTERN.test(asset.title.trim()) ||
      renderPathTitleCollapsesToEmpty(asset.title.trim())
  );
  const kept = eligible.filter((asset) => !junk.includes(asset));
  // 标准化标题去重：同键保留分高者，平分保留标题更短者（原始版优于数字后缀版）。
  const byKey = new Map<string, GovernedPromptAsset>();
  const dups: string[] = [];
  for (const asset of kept) {
    const key = normalizedTitleKey(asset.title);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, asset);
      continue;
    }
    const challenger =
      (asset.score || 0) > (current.score || 0) ||
      ((asset.score || 0) === (current.score || 0) && asset.title.length < current.title.length)
        ? asset
        : current;
    dups.push((challenger === asset ? current : asset).id);
    byKey.set(key, challenger);
  }
  return {
    candidates: kept.filter((asset) => byKey.get(normalizedTitleKey(asset.title)) === asset),
    excluded: junk.map((asset) => asset.id),
    deduped: dups,
  };
}

export function buildSanitizedCopy(
  asset: GovernedPromptAsset,
  counters: SanitizedCopyRewriteCounters
): GovernedPromptAsset {
  const cardTitle = sanitizeCopyText(asset.title);
  const goal = rewriteSanitizedCopyText(
    'goal',
    asset.goal,
    cardTitle,
    asset.primaryCategory,
    counters
  );
  const successSignal = rewriteSanitizedCopyText(
    'successSignal',
    asset.successSignal,
    cardTitle,
    asset.primaryCategory,
    counters
  );
  return {
    ...asset,
    id: `sanitized-${asset.id}`,
    title: cardTitle,
    goal,
    template: sanitizeCopyText(asset.template),
    successSignal,
    recommendationReason: asset.recommendationReason
      ? sanitizeCopyText(asset.recommendationReason)
      : asset.recommendationReason,
    // 源候选的 riskNotes 为「未清洗，禁止直接加载」，对 runtime-ready 副本已不成立，
    //替换为如实描述生成侧消毒结果（镜像运行时端点不携带源 riskNotes 的语义）。
    riskNotes: [SANITIZED_COPY_NOTE],
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    placementTier: 'optional-style',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'plaza',
  };
}

/** 生成物六段数据（与 shared/lib/public-skill-catalog.ts 的导出逐字段对应）。 */
export interface PublicCatalogModel {
  registry: GovernedPromptAsset[];
  flows: SkillSeriesFlow[];
  curatedSkills: CuratedProductSkill[];
  catalog: GovernedPromptAsset[];
  sanitizedCopies: GovernedPromptAsset[];
  shellCatalog: GovernedPromptAsset[];
  packages: EnhancementPackage[];
}

export interface CatalogGenerationReport {
  excludedJunkPublic: string[];
  excludedJunkCandidates: string[];
  dedupedCandidates: string[];
  penaltyLog: string[];
  goalRewrites: number;
  signalRewrites: number;
  counts: {
    registry: number;
    flows: number;
    curatedSkills: number;
    catalog: number;
    packages: number;
    sanitizedCopies: number;
    shellCatalog: number;
    sanitizeCandidates: number;
  };
}

/** JSON 序列化语义：产物落盘再 import 时 undefined 键会被丢弃，模型对齐该口径。 */
function asSerialized<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 跑完整管线（纯函数，可重复调用）：源货架 → 公开池准入 → 治理 → 克隆消毒 →
 * 消毒副本 → 序列化口径。生成脚本写盘、守卫测试比对，都从这里取数。
 */
/** 按 id 去重（保留首个）：注册表条目为源目录子集，合并时避免重复。 */
function dedupeById(assets: GovernedPromptAsset[]): GovernedPromptAsset[] {
  const seen = new Set<string>();
  const out: GovernedPromptAsset[] = [];
  for (const asset of assets) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    out.push(asset);
  }
  return out;
}

export function buildPublicCatalogModel(): {
  model: PublicCatalogModel;
  report: CatalogGenerationReport;
} {
  const admittedOut = [
    ...GOVERNED_ASSETS_V2_REGISTRY.filter(isPublicRuntimeAsset),
    ...PROMPT_GOVERNANCE_CATALOG.filter(isPublicRuntimeAsset),
  ].filter((asset) => !admitPublicAsset(asset));

  const publicAssetsRegistry = GOVERNED_ASSETS_V2_REGISTRY.filter(isPublicRuntimeAsset).filter(
    admitPublicAsset
  );
  const publicCatalog = PROMPT_GOVERNANCE_CATALOG.filter(isPublicRuntimeAsset).filter(
    admitPublicAsset
  );

  // Plan 258 散卡层治理：占位空壳评分惩罚 + featured 授予守卫。必须在
  // cloneAndSanitize 之前对源卡执行——克隆会把 template 物理清空，克隆后
  // 无法再做占位判定。组合顺序：先惩罚（封顶 60）后守卫（60 < 70 降档）。
  const governedAssetsRegistry = publicAssetsRegistry.map(applySourceCardGovernance);
  const governedCatalog = publicCatalog.map(applySourceCardGovernance);

  const cleanedAssetsRegistry = cloneAndSanitize(governedAssetsRegistry);
  const cleanedFlows = cloneAndSanitize(SKILL_SERIES_FLOWS);
  const cleanedCuratedSkills = cloneAndSanitize(CURATED_PRODUCT_SKILLS);
  const cleanedCatalog = cloneAndSanitize(governedCatalog);
  const cleanedPackages = cloneAndSanitize(ENHANCEMENT_PACKAGES);
  // Plan 262 B1：渲染层壳目录 —— 全量源资产（含未公开 / 仅内部 / 夹具）物理清空 template 后的投影，
  // 供前端治理与审计消费。条目 id 与源目录一一对应，但不含任何提示词正文。
  const shellCatalog = cloneAndSanitize(
    dedupeById([...PROMPT_GOVERNANCE_CATALOG, ...GOVERNED_ASSETS_V2_REGISTRY]).map((asset) => ({
      ...asset,
      // 壳判定必须在清空 template 之前固化：cloneAndSanitize 会把 template 置空，
      // 之后 isShellTemplatePrompt('') 恒为假，审计面会丢掉「引用壳」这一类。
      isShellBody: isShellTemplatePrompt(asset.template),
    }))
  );

  const candidateCollection = collectSanitizeCandidates();
  const counters = createSanitizedCopyRewriteCounters();
  const rawSanitizedCopies = candidateCollection.candidates.map((asset) =>
    buildSanitizedCopy(asset, counters)
  );
  // Plan 258：副本治理判定基准为副本自身的运行时正文（消毒后残缺句）。
  const sanitizedCopies = rawSanitizedCopies.map(applySanitizedCopyGovernance);
  const penaltyLog = [
    ...diffGovernanceChanges(publicAssetsRegistry, governedAssetsRegistry),
    ...diffGovernanceChanges(publicCatalog, governedCatalog),
    ...diffGovernanceChanges(rawSanitizedCopies, sanitizedCopies),
  ];

  const model: PublicCatalogModel = {
    registry: asSerialized(cleanedAssetsRegistry),
    flows: asSerialized(cleanedFlows),
    curatedSkills: asSerialized(cleanedCuratedSkills),
    catalog: asSerialized(cleanedCatalog),
    sanitizedCopies: asSerialized(sanitizedCopies),
    shellCatalog: asSerialized(shellCatalog),
    packages: asSerialized(cleanedPackages),
  };

  return {
    model,
    report: {
      excludedJunkPublic: admittedOut.map((asset) => asset.id),
      excludedJunkCandidates: candidateCollection.excluded,
      dedupedCandidates: candidateCollection.deduped,
      penaltyLog,
      goalRewrites: counters.goal,
      signalRewrites: counters.signal,
      counts: {
        registry: model.registry.length,
        flows: model.flows.length,
        curatedSkills: model.curatedSkills.length,
        catalog: model.catalog.length,
        packages: model.packages.length,
        sanitizedCopies: model.sanitizedCopies.length,
        shellCatalog: model.shellCatalog.length,
        sanitizeCandidates: candidateCollection.candidates.length,
      },
    },
  };
}

/**
 * 渲染生成物全文（与写盘内容逐字节同一函数，守卫测试据此比对仓内文件）。
 */
export function renderPublicCatalogModule(model: PublicCatalogModel): string {
  const {
    registry: cleanedAssetsRegistry,
    flows: cleanedFlows,
    curatedSkills: cleanedCuratedSkills,
    catalog: cleanedCatalog,
    sanitizedCopies,
    shellCatalog,
    packages: cleanedPackages,
  } = model;

  // Hardcode 7 pure functions with accurate TS type definitions to guarantee zero errors
  return `// ─────────────────────────────────────────────────────────────────────────────
// InkFlow Public Decoupled & Whitewashed Skill Catalog
// This file is auto-generated by scripts/generate-public-catalog.ts
// DO NOT EDIT THIS FILE DIRECTLY. ALL INTENDED EDITS MUST BE APPLIED TO
// THE GENERATION SCRIPT OR THE SOURCE GOVERNANCE CATALOG.
// ─────────────────────────────────────────────────────────────────────────────

import type { GovernedPromptAsset, EnhancementPackage, EnhancementPackageStep, SkillSeriesFlowStep, SkillSeriesFlow, CuratedProductSkill } from '../types/prompt-assets-governed.js';
import type { Novel } from '../types.js';

export const GOVERNED_ASSETS_V2_REGISTRY: GovernedPromptAsset[] = ${JSON.stringify(cleanedAssetsRegistry, null, 2)};

export const SKILL_SERIES_FLOWS: SkillSeriesFlow[] = ${JSON.stringify(cleanedFlows, null, 2)};

export const CURATED_PRODUCT_SKILLS: CuratedProductSkill[] = ${JSON.stringify(cleanedCuratedSkills, null, 2)};

export const PUBLIC_SKILL_GOVERNANCE_CATALOG: GovernedPromptAsset[] = ${JSON.stringify(cleanedCatalog, null, 2)};

export const SANITIZED_SKILL_COPIES: GovernedPromptAsset[] = ${JSON.stringify(sanitizedCopies, null, 2)};

export const PUBLIC_SHELL_CATALOG: GovernedPromptAsset[] = ${JSON.stringify(shellCatalog, null, 2)};

export const ENHANCEMENT_PACKAGES: EnhancementPackage[] = ${JSON.stringify(cleanedPackages, null, 2)};

// ── 7 Core Pure Computational Utility Functions with Strict TS Annotation ──

/**
 * 获取小说在当前流程系列中的最新执行步骤 ID
 */
export function getNovelCurrentStepId(novel: Novel, activeSeriesId: string): string {
  const tags = novel.projectPreferenceProfile?.tags || [];
  const prefix = \`current-step:\${activeSeriesId}:\`;
  const found = tags.find(t => t.startsWith(prefix));
  if (found) {
    return found.slice(prefix.length);
  }
  const flow = SKILL_SERIES_FLOWS.find(f => f.id === activeSeriesId);
  if (flow && flow.steps.length > 0) {
    return flow.steps[0].id;
  }
  return '';
}

/**
 * 获取当前小说已经执行完毕并标记完成的步骤 ID 列表
 */
export function getNovelCompletedStepIds(novel: Novel, activeSeriesId: string): string[] {
  const tags = novel.projectPreferenceProfile?.tags || [];
  const prefix = \`completed-step:\${activeSeriesId}:\`;
  return tags
    .filter(t => t.startsWith(prefix))
    .map(t => t.slice(prefix.length));
}

/**
 * 根据当前状态与已完成步骤，路由判定下一步应该执行的创作流步骤
 */
export function getNextFlowStep(
  activeSeriesId: string,
  currentStage: string,
  completedStepIds: string[]
): SkillSeriesFlowStep | null {
  const flow = SKILL_SERIES_FLOWS.find(f => f.id === activeSeriesId);
  if (!flow) return null;

  // 1. 如果 currentStage 是某个步骤的 ID，直接根据 nextStepId 寻找
  const currentStep = flow.steps.find(s => s.id === currentStage);
  if (currentStep) {
    if (currentStep.nextStepId) {
      return flow.steps.find(s => s.id === currentStep.nextStepId) || null;
    }
    return null; // 已经是最后一步
  }

  // 2. Fallback：如果 currentStage 为空或外部业务非步骤 ID，返回第一个未完成的步骤
  const uncompleted = flow.steps.find(s => !completedStepIds.includes(s.id));
  if (uncompleted) return uncompleted;

  return null;
}

/**
 * 根据包 ID 判定一个包是否是付费包，并且当前商业模式下是否被拦截。
 */
export function isPackageRestricted(packageId: string, commercialMode: string = 'free'): boolean {
  const pkg = ENHANCEMENT_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return false;
  return pkg.type === 'paid' && commercialMode !== 'paid';
}

/**
 * 根据资产 ID 获取对应的增强包配置
 */
export function getAssetEnhancementPackage(assetId: string): EnhancementPackage | null {
  let pkgId = '';
  if (assetId === 'core-dialogue-enhancer' || assetId === 'core-slop-shield') {
    pkgId = 'paid-advanced-audit-patch';
  } else if (assetId === 'tomato-opening-validator') {
    pkgId = 'paid-platform-diagnostics';
  } else if (assetId === 'plaza-golden-three') {
    pkgId = 'paid-cross-chapter-continuity';
  } else if (assetId === 'licensed-cthulhu-style' || assetId === 'ancient-gorgeous-reference') {
    pkgId = 'paid-deconstruction-fusion';
  }

  if (!pkgId) return null;
  return ENHANCEMENT_PACKAGES.find(p => p.id === pkgId) || null;
}

/**
 * 根据流程 ID 获取对应的增强包配置
 */
export function getFlowEnhancementPackage(flowId: string): EnhancementPackage | null {
  if (flowId === 'fenghua-short-flow' || flowId === 'tianma-outline-flow') {
    return ENHANCEMENT_PACKAGES.find(p => p.id === 'paid-author-flows') || null;
  }
  return null;
}

/**
 * 返回包的步骤配方；对仅有 assets 的旧包保持可读性。
 */
export function getEnhancementPackageSteps(pkg: EnhancementPackage): readonly EnhancementPackageStep[] {
  if (pkg.steps?.length) return pkg.steps;
  return (pkg.assets || []).map((assetId, index) => ({
    id: \`\${pkg.id}-step-\${index + 1}\`, assetId, mode: 'recommend' as const, trigger: 'milestone' as const,
    scope: 'single-run' as const, order: index + 1, required: false,
  }));
}

// Plan 236（CORR-02）：白标清洗器单源化——本文件不再内嵌漂移的函数副本，
// 统一 re-export 正典实现（shared/lib/prompt-sanitizer.ts，行为取并集）。
export { sanitizeWhiteLabelText } from './prompt-sanitizer.js';
`;
}

/**
 * 生成物新鲜度比对（负向用例的判定核）：逐行定位差异，最多报告 limit 条。
 * 返回空数组 = 仓内文件与现场渲染逐字节一致。
 */
export function diffCatalogModuleText(
  committed: string,
  expected: string,
  limit = 20
): string[] {
  const committedLines = committed.split('\n');
  const expectedLines = expected.split('\n');
  const diffs: string[] = [];
  const max = Math.max(committedLines.length, expectedLines.length);
  for (let i = 0; i < max; i += 1) {
    if (committedLines[i] !== expectedLines[i]) {
      diffs.push(
        `L${i + 1}: 仓库=${JSON.stringify(committedLines[i] ?? '<missing>')} 期望=${JSON.stringify(
          expectedLines[i] ?? '<missing>'
        )}`
      );
      if (diffs.length >= limit) {
        diffs.push('…（其余差异省略）');
        break;
      }
    }
  }
  return diffs;
}
