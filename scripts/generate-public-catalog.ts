import * as fs from 'fs';
import * as path from 'path';
import {
  GOVERNED_ASSETS_V2_REGISTRY,
  SKILL_SERIES_FLOWS,
  CURATED_PRODUCT_SKILLS,
  PROMPT_GOVERNANCE_CATALOG,
  ENHANCEMENT_PACKAGES,
  isPublicRuntimeAsset,
} from '../shared/lib/prompt-governance-catalog.js';
import { sanitizeWhiteLabelText } from '../shared/lib/prompt-sanitizer.js';
import type { GovernedPromptAsset } from '../shared/types/prompt-assets-governed.js';

// Define the keys that contain sanitizable human-facing text
const TEXT_KEYS_TO_SANITIZE = new Set([
  'title',
  'goal',
  'successSignal',
  'description',
  'name',
  'whyUpgrade',
  'riskNotes',
  'qualityGate',
  'recommendationReason',
]);

/**
 * Deep-cleans and sanitizes strings, converting specific brand-related terminology
 * into industry-standard clean text representation.
 */
function cleanText(text: string): string {
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
function cloneAndSanitize<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => cloneAndSanitize(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const copy: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;
    for (const key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        const val = record[key];
        if (key === 'template') {
          copy[key] = ''; // 物理强制清空提示词模板 / Force set template to empty string physically
        } else if (TEXT_KEYS_TO_SANITIZE.has(key) && typeof val === 'string') {
          copy[key] = cleanText(val);
        } else if (typeof val === 'object') {
          copy[key] = cloneAndSanitize(val);
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

const SANITIZED_COPY_NOTE = '生成侧消毒副本：白标清洗完成，原署名与联系方式已剥离。';

function sanitizeCopyText(text: string | undefined): string {
  return text ? cleanText(text) : '';
}

// ─── Plan 233 目录准入规则（生成侧守门，排除动作全部留痕）────────────────────
// 垃圾标题：测试/内测卡与 test 边界匹配——只拦「以测试开头/结尾」「以内测开头/结尾」
// 与整名等值，不误伤语义完整标题（如「A/B 测试设计器」不在本目录域）。
const JUNK_TITLE_PATTERN = /(^测试)|(^内测)|(^test)|(测试$)|(内测$)|(test$)/i;

// 镜像渲染路径那份 sanitizeWhiteLabelText（public-skill-catalog 生成副本，含
// 「X出品/X专用/X定制/X私有化/X自用」通配剥除）的品牌剥除规则：整名被剥空的卡
// 上架即空标题卡（如 private-186「fire角色定制」），源头不入册。
function renderPathTitleCollapsesToEmpty(title: string): boolean {
  return (
    !title
      .replace(/【[^】]*(?:出品|专用|定制|私有化|自用)[^】]*】/g, '')
      .replace(/[\u4e00-\u9fa5A-Za-z0-9_-]{1,24}(?:出品|专用|定制)/g, '')
      .trim()
      ? true
      : false
  );
}

// 标准化去重键：去空白 + 去结尾数字（「番茄正文过保底」vs「…2」这类改名重投）。
function normalizedTitleKey(title: string): string {
  return title.replace(/\s+/g, '').replace(/\d+$/, '');
}

function collectSanitizeCandidates(): GovernedPromptAsset[] {
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
  if (junk.length > 0) {
    console.log(
      `Excluded ${junk.length} junk-title candidates: [${junk.map((a) => a.id).join(', ')}]`
    );
  }
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
  if (dups.length > 0) {
    console.log(`Deduped ${dups.length} normalized-title duplicates: [${dups.join(', ')}]`);
  }
  return kept.filter((asset) => byKey.get(normalizedTitleKey(asset.title)) === asset);
}

function buildSanitizedCopy(asset: GovernedPromptAsset): GovernedPromptAsset {
  return {
    ...asset,
    id: `sanitized-${asset.id}`,
    title: sanitizeCopyText(asset.title),
    goal: sanitizeCopyText(asset.goal),
    template: sanitizeCopyText(asset.template),
    successSignal: sanitizeCopyText(asset.successSignal),
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

function generate() {
  console.log('Starting white-label physical catalog sanitization pipeline...');

  // Plan 233 准入规则对公共池源头生效：垃圾标题/渲染空标题的源卡连同其消毒候选
  // 一并不入册（否则副本被排除后源卡回落「需解锁」组重新露出）。
  const admitPublicAsset = (asset: GovernedPromptAsset): boolean =>
    !JUNK_TITLE_PATTERN.test((asset.title || '').trim()) &&
    !renderPathTitleCollapsesToEmpty((asset.title || '').trim());
  const admittedOut = [
    ...GOVERNED_ASSETS_V2_REGISTRY.filter(isPublicRuntimeAsset),
    ...PROMPT_GOVERNANCE_CATALOG.filter(isPublicRuntimeAsset),
  ].filter((asset) => !admitPublicAsset(asset));
  if (admittedOut.length > 0) {
    console.log(
      `Excluded ${admittedOut.length} junk assets from public pools: [${admittedOut
        .map((a) => a.id)
        .join(', ')}]`
    );
  }

  const publicAssetsRegistry = GOVERNED_ASSETS_V2_REGISTRY.filter(isPublicRuntimeAsset).filter(
    admitPublicAsset
  );
  const publicCatalog = PROMPT_GOVERNANCE_CATALOG.filter(isPublicRuntimeAsset).filter(
    admitPublicAsset
  );

  const cleanedAssetsRegistry = cloneAndSanitize(publicAssetsRegistry);
  const cleanedFlows = cloneAndSanitize(SKILL_SERIES_FLOWS);
  const cleanedCuratedSkills = cloneAndSanitize(CURATED_PRODUCT_SKILLS);
  const cleanedCatalog = cloneAndSanitize(publicCatalog);
  const cleanedPackages = cloneAndSanitize(ENHANCEMENT_PACKAGES);

  const sanitizeCandidates = collectSanitizeCandidates();
  const sanitizedCopies = sanitizeCandidates.map(buildSanitizedCopy);

  console.log(`Cleaned ${cleanedAssetsRegistry.length} registry assets.`);
  console.log(`Cleaned ${cleanedFlows.length} series flows.`);
  console.log(`Cleaned ${cleanedCuratedSkills.length} curated skills.`);
  console.log(`Cleaned ${cleanedCatalog.length} total catalog assets.`);
  console.log(`Cleaned ${cleanedPackages.length} enhancement packages.`);
  console.log(
    `Generated ${sanitizedCopies.length} sanitized copies from ${sanitizeCandidates.length} sanitize-required candidates.`
  );

  const outputPath = path.resolve(process.cwd(), 'shared/lib/public-skill-catalog.ts');

  // Hardcode 7 pure functions with accurate TS type definitions to guarantee zero errors
  const tsContent = `// ─────────────────────────────────────────────────────────────────────────────
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

/**
 * 白标物理净化函数：剔除联系方式、外链与作者签名式标识。
 */
export function sanitizeWhiteLabelText(text: string): string {
  if (!text) return '';
  let s = text;
  s = s.replace(/(?:qq\\s*群|群号|扣扣群|企鹅群)[:：]?\\s*\\d+/gi, '');
  s = s.replace(/(?:https?:\\/\\/)?[\\w.-]+\\.[a-zA-Z]{2,6}(?:\\/\\S*)?/gi, m => (m.includes('localhost') || m.includes('api') ? m : ''));
  s = s.replace(/(?:微信号|微信|vx号|vx|we\\s*chat)\\s*[:：]?\\s*[a-zA-Z0-9_-]{5,20}/gi, '');
  s = s.replace(/【[^】]*(?:出品|专用|定制|私有化|自用)[^】]*】/gi, '');
  s = s.replace(/[\\u4e00-\\u9fa5A-Za-z0-9_-]{1,24}(?:出品|专用|定制)/g, '');
  return s;
}
`;

  fs.writeFileSync(outputPath, tsContent, 'utf-8');
  console.log(`Successfully generated safe public catalog at \${outputPath}`);
}

generate();
