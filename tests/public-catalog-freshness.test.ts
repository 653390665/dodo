import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOVERNED_ASSETS_V2_REGISTRY as SOURCE_REGISTRY,
  SKILL_SERIES_FLOWS as SOURCE_FLOWS,
  CURATED_PRODUCT_SKILLS as SOURCE_CURATED,
  PROMPT_GOVERNANCE_CATALOG as SOURCE_CATALOG,
  ENHANCEMENT_PACKAGES as SOURCE_PACKAGES,
} from '../shared/lib/prompt-governance-catalog.js';
import { sanitizeWhiteLabelText } from '../shared/lib/prompt-sanitizer.js';
import {
  GOVERNED_ASSETS_V2_REGISTRY as PUBLIC_REGISTRY,
  SKILL_SERIES_FLOWS as PUBLIC_FLOWS,
  CURATED_PRODUCT_SKILLS as PUBLIC_CURATED,
  PROMPT_GOVERNANCE_CATALOG as PUBLIC_CATALOG,
  ENHANCEMENT_PACKAGES as PUBLIC_PACKAGES,
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
  'recommendationReason'
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

function isPublicRuntimeAsset(asset: GovernedPromptAsset): boolean {
  return (
    asset.placementTier !== 'sanitize-required' &&
    asset.placementTier !== 'research-only' &&
    asset.sanitizationStatus !== 'needs-sanitization' &&
    asset.processDecision !== 'research-only' &&
    asset.evidenceLevel !== 'test-fixture' &&
    asset.isRuntimeReady !== false &&
    asset.isWhiteLabeled !== false
  );
}

function cloneAndSanitize<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => cloneAndSanitize(item)) as unknown as T;
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
  const filtered = filterUnsafe ? items.filter(item => isPublicRuntimeAsset(item as unknown as GovernedPromptAsset)) : items;
  return JSON.parse(JSON.stringify(filtered.map(item => cloneAndSanitize(item))));
}

const REMIX_HINT = '生成副本已陈旧：请重新运行 `node --import tsx scripts/generate-public-catalog.ts` 再生 shared/lib/public-skill-catalog.ts（渲染层数据源必须与消毒管线输出逐字节一致）。';

function assertFresh(name: string, source: unknown[], publicCopy: unknown[], filterUnsafe: boolean): void {
  const expected = pipeline(source, filterUnsafe);
  const sourceIds = expected.map((item: any) => item.id);
  const publicIds = publicCopy.map((item: any) => item.id);
  assert.deepEqual(
    publicIds,
    sourceIds,
    `${name} 条数/id 集合不一致（源管线 ${sourceIds.length} 条 vs 副本 ${publicIds.length} 条；首个差异: 源=${sourceIds.find(id => !publicIds.includes(id))} 副本多出=${publicIds.find(id => !sourceIds.includes(id))}）。${REMIX_HINT}`,
  );
  assert.deepEqual(
    publicCopy,
    expected,
    `${name} 存在字段与 sanitize(源) 不一致（副本陈旧或被手工编辑）。${REMIX_HINT}`,
  );
}

test('public-skill-catalog is fresh: equals sanitize pipeline over the source catalog', () => {
  assertFresh('GOVERNED_ASSETS_V2_REGISTRY', SOURCE_REGISTRY, PUBLIC_REGISTRY, true);
  assertFresh('SKILL_SERIES_FLOWS', SOURCE_FLOWS, PUBLIC_FLOWS, false);
  assertFresh('CURATED_PRODUCT_SKILLS', SOURCE_CURATED, PUBLIC_CURATED, false);
  assertFresh('PROMPT_GOVERNANCE_CATALOG', SOURCE_CATALOG, PUBLIC_CATALOG, true);
});

test('public ENHANCEMENT_PACKAGES is fresh: equals sanitize pipeline over the source packages', () => {
  assertFresh('ENHANCEMENT_PACKAGES', SOURCE_PACKAGES, PUBLIC_PACKAGES, false);
});
