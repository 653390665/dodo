import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOVERNED_ASSETS_V2_REGISTRY as SOURCE_REGISTRY,
  SKILL_SERIES_FLOWS as SOURCE_FLOWS,
  CURATED_PRODUCT_SKILLS as SOURCE_CURATED,
  PROMPT_GOVERNANCE_CATALOG as SOURCE_CATALOG,
  ENHANCEMENT_PACKAGES as SOURCE_PACKAGES,
  isPublicRuntimeAsset,
} from '../shared/lib/prompt-governance-catalog.js';
import { sanitizeWhiteLabelText } from '../shared/lib/prompt-sanitizer.js';
import {
  GOVERNED_ASSETS_V2_REGISTRY as PUBLIC_REGISTRY,
  SKILL_SERIES_FLOWS as PUBLIC_FLOWS,
  CURATED_PRODUCT_SKILLS as PUBLIC_CURATED,
  PUBLIC_SKILL_GOVERNANCE_CATALOG as PUBLIC_CATALOG,
  ENHANCEMENT_PACKAGES as PUBLIC_PACKAGES,
  SANITIZED_SKILL_COPIES as PUBLIC_COPIES,
} from '../shared/lib/public-skill-catalog.js';
import type { GovernedPromptAsset } from '../shared/types/prompt-assets-governed.js';

// ─────────────────────────────────────────────────────────────────────────────
// 以下纯函数镜像自 scripts/generate-public-catalog.ts（TEXT_KEYS_TO_SANITIZE /
// cleanText / isPublicRuntimeAsset / cloneAndSanitize）。脚本管线若变更，必须
// 同步此处，否则本守卫会误报/漏报。修改生成脚本消毒逻辑属于安全敏感变更。
// ─────────────────────────────────────────────────────────────────────────────

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

function cleanText(text: string): string {
  if (!text) return '';
  let s = sanitizeWhiteLabelText(text);
  s = s.replace(/小飞鸡长篇流/g, '长篇商业连载流程');
  s = s.replace(/小飞鸡、风华/g, '名家');
  s = s.replace(/小飞鸡/g, '名家');
  s = s.replace(/风华/g, '名家');
  s = s.replace(/天马/g, '结构工坊');
  s = s.replace(/墨流/g, '外部工具');
  s = s.replace(/长篇一键破解爆款小说并生成脑洞/g, '长篇爆款拆解与脑洞生成');
  s = s.replace(/一键破解爆款并生成脑洞/g, '爆款拆解与脑洞生成');
  s = s.replace(/一键生成章节梗概/g, '章节梗概生成');
  s = s.replace(/一键润色降ai\s*([0-9.]+)/gi, '降 AI 润色 $1');
  s = s.replace(/一键融梗换心/g, '融梗换心候选生成');
  s = sanitizeWhiteLabelText(s);
  return s;
}

// isPublicRuntimeAsset 自 shared/lib/prompt-governance-catalog.ts 单源导入（Plan 197 Step 1），
// 不再本地复制；生成脚本与守卫共用同一准入判定。

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
          copy[key] = '';
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

/** 复刻脚本输出语义：JSON 序列化落盘再被 import（undefined 键会被丢弃）。 */
function pipeline<T>(items: T[], filterUnsafe: boolean): T[] {
  const filtered = filterUnsafe
    ? items.filter((item) => isPublicRuntimeAsset(item as unknown as GovernedPromptAsset))
    : items;
  return JSON.parse(JSON.stringify(filtered.map((item) => cloneAndSanitize(item))));
}

// ─── 生成侧消毒副本镜像（Plan 197 Step 2）────────────────────────────────────
// 镜像 scripts/generate-public-catalog.ts 的 collectSanitizeCandidates /
// buildSanitizedCopy；脚本管线若变更，必须同步此处。

const SANITIZED_COPY_NOTE = '生成侧消毒副本：白标清洗完成，原署名与联系方式已剥离。';

function sanitizeCopyText(text: string | undefined): string {
  return text ? cleanText(text) : '';
}

// Plan 233 准入规则镜像（与 scripts/generate-public-catalog.ts 保持一致）。
const JUNK_TITLE_PATTERN = /(^测试)|(^内测)|(^test)|(测试$)|(内测$)|(test$)/i;

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

function normalizedTitleKey(title: string): string {
  return title.replace(/\s+/g, '').replace(/\d+$/, '');
}

function collectSanitizeCandidates(): GovernedPromptAsset[] {
  const seen = new Set<string>();
  const merged = [...SOURCE_REGISTRY, ...SOURCE_CATALOG].filter((asset) =>
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
  const byKey = new Map<string, GovernedPromptAsset>();
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
    byKey.set(key, challenger);
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
    riskNotes: [SANITIZED_COPY_NOTE],
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    placementTier: 'optional-style',
    isWhiteLabeled: true,
    isRuntimeReady: true,
    sourceType: 'plaza',
  };
}

const REMIX_HINT =
  '生成副本已陈旧：请重新运行 `node --import tsx scripts/generate-public-catalog.ts` 再生 shared/lib/public-skill-catalog.ts（渲染层数据源必须与消毒管线输出逐字节一致）。';

function assertFresh(
  name: string,
  source: unknown[],
  publicCopy: unknown[],
  filterUnsafe: boolean
): void {
  const expected = pipeline(source, filterUnsafe);
  const sourceIds = expected.map((item: any) => item.id);
  const publicIds = publicCopy.map((item: any) => item.id);
  assert.deepEqual(
    publicIds,
    sourceIds,
    `${name} 条数/id 集合不一致（源管线 ${sourceIds.length} 条 vs 副本 ${publicIds.length} 条；首个差异: 源=${sourceIds.find((id) => !publicIds.includes(id))} 副本多出=${publicIds.find((id) => !sourceIds.includes(id))}）。${REMIX_HINT}`
  );
  assert.deepEqual(
    publicCopy,
    expected,
    `${name} 存在字段与 sanitize(源) 不一致（副本陈旧或被手工编辑）。${REMIX_HINT}`
  );
}

test('public-skill-catalog is fresh: equals sanitize pipeline over the source catalog', () => {
  assertFresh('GOVERNED_ASSETS_V2_REGISTRY', SOURCE_REGISTRY, PUBLIC_REGISTRY, true);
  assertFresh('SKILL_SERIES_FLOWS', SOURCE_FLOWS, PUBLIC_FLOWS, false);
  assertFresh('CURATED_PRODUCT_SKILLS', SOURCE_CURATED, PUBLIC_CURATED, false);
  assertFresh('PUBLIC_SKILL_GOVERNANCE_CATALOG', SOURCE_CATALOG, PUBLIC_CATALOG, true);
});

test('public ENHANCEMENT_PACKAGES is fresh: equals sanitize pipeline over the source packages', () => {
  assertFresh('ENHANCEMENT_PACKAGES', SOURCE_PACKAGES, PUBLIC_PACKAGES, false);
});

test('SANITIZED_SKILL_COPIES is fresh: one runtime-ready copy per sanitize-required candidate', () => {
  const candidates = collectSanitizeCandidates();
  // Plan 233 重锚 45→38：准入规则排除 6 张垃圾标题候选（测试审稿/测试黄金一章/测试/
  // fire角色定制/风华长篇大纲测试/私密内测）+ 去重 1 张（番茄正文过保底2）。
  // 口径不变：每张准入候选各产一张副本。
  assert.equal(
    PUBLIC_COPIES.length,
    38,
    `sanitized copies count should be 38, got ${PUBLIC_COPIES.length}`
  );
  assert.equal(
    candidates.length,
    38,
    `sanitize-required candidates count should be 38, got ${candidates.length}`
  );

  // 副本 id 集合与候选一一对应（同序）
  assert.deepEqual(
    PUBLIC_COPIES.map((copy) => copy.id),
    candidates.map((asset) => `sanitized-${asset.id}`),
    `sanitized copies must correspond 1:1 to sanitize-required candidates. ${REMIX_HINT}`
  );

  // 逐字节新鲜：等于镜像副本管线输出
  const expectedCopies = JSON.parse(JSON.stringify(candidates.map(buildSanitizedCopy)));
  assert.deepEqual(
    PUBLIC_COPIES,
    expectedCopies,
    `SANITIZED_SKILL_COPIES 存在字段与 sanitize(源) 不一致（副本陈旧或被手工编辑）。${REMIX_HINT}`
  );

  // 每张副本必须通过公开运行时准入过滤器，且治理状态与运行时消毒先例一致
  for (const copy of PUBLIC_COPIES) {
    assert.equal(
      isPublicRuntimeAsset(copy as unknown as GovernedPromptAsset),
      true,
      `sanitized copy ${copy.id} must pass isPublicRuntimeAsset`
    );
    assert.equal(copy.sanitizationStatus, 'runtime-ready', `copy ${copy.id} sanitizationStatus`);
    assert.equal(copy.runtimeStatus, 'active', `copy ${copy.id} runtimeStatus`);
    assert.equal(copy.placementTier, 'optional-style', `copy ${copy.id} placementTier`);
    assert.equal(copy.isWhiteLabeled, true, `copy ${copy.id} isWhiteLabeled`);
    assert.equal(copy.isRuntimeReady, true, `copy ${copy.id} isRuntimeReady`);
    assert.equal(copy.sourceType, 'plaza', `copy ${copy.id} sourceType（镜像运行时端点）`);
  }
});
