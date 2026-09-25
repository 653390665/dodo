import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  GOVERNED_ASSETS_V2_REGISTRY as SOURCE_REGISTRY,
  SKILL_SERIES_FLOWS as SOURCE_FLOWS,
  CURATED_PRODUCT_SKILLS as SOURCE_CURATED,
  PROMPT_GOVERNANCE_CATALOG as SOURCE_CATALOG,
  ENHANCEMENT_PACKAGES as SOURCE_PACKAGES,
  isPublicRuntimeAsset,
} from '../shared/lib/prompt-governance-catalog.js';
import {
  GOVERNED_ASSETS_V2_REGISTRY as PUBLIC_REGISTRY,
  SKILL_SERIES_FLOWS as PUBLIC_FLOWS,
  CURATED_PRODUCT_SKILLS as PUBLIC_CURATED,
  PUBLIC_SKILL_GOVERNANCE_CATALOG as PUBLIC_CATALOG,
  ENHANCEMENT_PACKAGES as PUBLIC_PACKAGES,
  SANITIZED_SKILL_COPIES as PUBLIC_COPIES,
} from '../shared/lib/public-skill-catalog.js';
import type { GovernedPromptAsset } from '../shared/types/prompt-assets-governed.js';
import {
  CATALOG_MODULE_PATH,
  buildPublicCatalogModel,
  collectSanitizeCandidates,
  diffCatalogModuleText,
  renderPublicCatalogModule,
} from '../scripts/lib/public-catalog-pipeline.js';

// ─────────────────────────────────────────────────────────────────────────────
// 生成物新鲜度守卫（单源版）。
//
// 旧版（2026-09-24 前）本文件镜像了 ~300 行生成脚本纯函数（TEXT_KEYS_TO_SANITIZE /
// cleanText / cloneAndSanitize / pipeline / collectSanitizeCandidates /
// buildSanitizedCopy / Plan 233 准入 / Plan 258 治理），镜像漂移是真实风险面：
// 脚本规则变更必须手工同步，漏同步则守卫误报或漏报。
//
// 现在期望值一律来自 scripts/lib/public-catalog-pipeline.ts —— 与生成脚本
// scripts/generate-public-catalog.ts 同一实现，仓内不存在第二份卡面正文规则。
// ─────────────────────────────────────────────────────────────────────────────

const { model: EXPECTED, report: REPORT } = buildPublicCatalogModel();
const CATALOG_FILE = path.resolve(process.cwd(), CATALOG_MODULE_PATH);

const REMIX_HINT =
  '生成副本已陈旧：请重新运行 `node --import tsx scripts/generate-public-catalog.ts` 再生 shared/lib/public-skill-catalog.ts（渲染层数据源必须与消毒管线输出逐字节一致）。';

function assertFresh(name: string, expected: unknown[], committed: unknown[]): void {
  const sourceIds = expected.map((item: any) => item.id);
  const publicIds = committed.map((item: any) => item.id);
  assert.deepEqual(
    publicIds,
    sourceIds,
    `${name} 条数/id 集合不一致（管线 ${sourceIds.length} 条 vs 生成物 ${publicIds.length} 条；首个差异: 管线=${sourceIds.find((id) => !publicIds.includes(id))} 生成物多出=${publicIds.find((id) => !sourceIds.includes(id))}）。${REMIX_HINT}`
  );
  assert.deepEqual(
    committed,
    expected,
    `${name} 存在字段与 sanitize(源) 不一致（生成物陈旧或被手工编辑）。${REMIX_HINT}`
  );
}

test('public-skill-catalog is fresh: equals sanitize pipeline over the source catalog', () => {
  assertFresh('GOVERNED_ASSETS_V2_REGISTRY', EXPECTED.registry, PUBLIC_REGISTRY);
  assertFresh('SKILL_SERIES_FLOWS', EXPECTED.flows, PUBLIC_FLOWS);
  assertFresh('CURATED_PRODUCT_SKILLS', EXPECTED.curatedSkills, PUBLIC_CURATED);
  assertFresh('PUBLIC_SKILL_GOVERNANCE_CATALOG', EXPECTED.catalog, PUBLIC_CATALOG);
});

test('public ENHANCEMENT_PACKAGES is fresh: equals sanitize pipeline over the source packages', () => {
  assertFresh('ENHANCEMENT_PACKAGES', EXPECTED.packages, PUBLIC_PACKAGES);
});

test('生成物 id 全部来自源货架（消毒管线不新增、不改名卡片）', () => {
  const sourceIds = new Set<string>(
    [
      ...SOURCE_REGISTRY,
      ...SOURCE_CATALOG,
      ...SOURCE_FLOWS,
      ...SOURCE_CURATED,
      ...SOURCE_PACKAGES,
    ].map((item) => (item as { id: string }).id)
  );
  for (const item of [...PUBLIC_REGISTRY, ...PUBLIC_CATALOG, ...PUBLIC_FLOWS, ...PUBLIC_CURATED]) {
    assert.equal(
      sourceIds.has(item.id),
      true,
      `生成物条目 ${item.id} 不在源货架中（管线只允许过滤/消毒，不允许造卡）`
    );
  }
});

test('SANITIZED_SKILL_COPIES is fresh: one runtime-ready copy per sanitize-required candidate', () => {
  const candidates = collectSanitizeCandidates().candidates;
  // Plan 233 重锚 45→38：准入规则排除 6 张垃圾标题候选（测试审稿/测试黄金一章/测试/
  // fire角色定制/风华长篇大纲测试/私密内测）+ 去重 1 张（番茄正文过保底2）。
  // Plan 236 再锚 38→33：sanitizer 合一后去重键含品牌剥除——「沐殇定制细纲 vs 细纲」
  // 等 5 对换皮重投互为同卡，只留一张。口径不变：每张准入候选各产一张副本。
  assert.equal(
    PUBLIC_COPIES.length,
    33,
    `sanitized copies count should be 33, got ${PUBLIC_COPIES.length}`
  );
  assert.equal(
    candidates.length,
    33,
    `sanitize-required candidates count should be 33, got ${candidates.length}`
  );

  // 副本 id 集合与候选一一对应（同序）
  assert.deepEqual(
    PUBLIC_COPIES.map((copy) => copy.id),
    candidates.map((asset) => `sanitized-${asset.id}`),
    `sanitized copies must correspond 1:1 to sanitize-required candidates. ${REMIX_HINT}`
  );

  // 逐字段新鲜：与管线同源产出比对（Plan 258 副本治理与生成器同序：
  // 构建后逐张过占位惩罚 + featured 守卫；改写计数器已显式传入，不再需要手动归零）
  assertFresh('SANITIZED_SKILL_COPIES', EXPECTED.sanitizedCopies, PUBLIC_COPIES);
  assert.equal(
    REPORT.counts.sanitizedCopies,
    PUBLIC_COPIES.length,
    '管线报告与生成物副本数必须一致'
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

// ─── 新鲜度的文件级断言（生成物 = 现场渲染，逐字节）─────────────────────────

test('生成物文件与现场渲染逐字节一致（源 → 生成物；手改产物即红）', () => {
  const committed = fs.readFileSync(CATALOG_FILE, 'utf-8');
  const expected = renderPublicCatalogModule(EXPECTED);
  assert.deepEqual(
    diffCatalogModuleText(committed, expected),
    [],
    `shared/lib/public-skill-catalog.ts 与现场渲染不一致（被手工编辑或源变更后未重跑生成）。${REMIX_HINT}`
  );
});

test('负向：手改生成物必被新鲜度测试拦下（单点篡改 → 比对指向具体行）', () => {
  const committed = fs.readFileSync(CATALOG_FILE, 'utf-8');
  const expected = renderPublicCatalogModule(EXPECTED);
  // 前置：仓内产物当前必须新鲜，否则本负向用例失去意义
  assert.deepEqual(diffCatalogModuleText(committed, expected), [], `前置失败：${REMIX_HINT}`);

  const needle = '"score": 60';
  const at = committed.indexOf(needle);
  assert.notEqual(at, -1, '前置：生成物中应存在 Plan 258 治理后的 score 字段（封顶 60）');
  const tampered = `${committed.slice(0, at)}"score": 61${committed.slice(at + needle.length)}`;

  const diffs = diffCatalogModuleText(tampered, expected);
  assert.equal(diffs.length > 0, true, '手改生成物（score 60→61）必须被新鲜度比对拦下');
  assert.match(diffs[0], /^L\d+: /, '差异信息必须指向具体行号，便于定位手改点');
  // 比对是纯函数：对新鲜内容再次比对仍为空（无缓存/副作用）
  assert.deepEqual(diffCatalogModuleText(committed, expected), []);
});

test('负向：结构性比对同样拦下被手改的字段（assertFresh 视角）', () => {
  const [first, ...rest] = PUBLIC_COPIES;
  const tamperedCopies = [{ ...first, goal: `${first.goal}（手改）` }, ...rest];
  assert.throws(
    () => assertFresh('SANITIZED_SKILL_COPIES', EXPECTED.sanitizedCopies, tamperedCopies),
    /不一致/,
    '生成物字段被手改后，结构性新鲜度断言必须失败'
  );
});

// ─── 确定性（脚本重复执行输出稳定）───────────────────────────────────────────

test('确定性：重复构建 → 同哈希；改写计数器不跨次漂移', () => {
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
  const first = renderPublicCatalogModule(EXPECTED);
  const second = buildPublicCatalogModel();

  assert.equal(
    sha256(first),
    sha256(renderPublicCatalogModule(second.model)),
    '同一进程连续两次构建/渲染必须逐字节一致（旧版模块级改写计数器会跨次漂移）'
  );
  assert.equal(
    REPORT.goalRewrites,
    second.report.goalRewrites,
    'goal 改写计数器必须可重入（显式传入，不再依赖手动归零）'
  );
  assert.equal(
    REPORT.signalRewrites,
    second.report.signalRewrites,
    'successSignal 改写计数器必须可重入'
  );
  assert.equal(
    sha256(first),
    sha256(fs.readFileSync(CATALOG_FILE, 'utf-8')),
    `现场渲染必须与仓内生成物哈希一致。${REMIX_HINT}`
  );
});
