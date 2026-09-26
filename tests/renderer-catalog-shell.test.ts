/**
 * Plan 262 B1：渲染层目录边界守卫。
 *
 * 背景：`src/lib/capability-governance.ts` 曾直接 import 源治理目录（含 `template` 全文）进渲染层，
 * 可能绕过公开目录的模板剥离面。修复后渲染层只消费生成物 `PUBLIC_SHELL_CATALOG`（全量源资产、
 * `template` 物理清空）。本测试钉住三件事：① 静态边界（src/ 不得再 import 源目录）；
 * ② 壳目录无正文且 id 覆盖源目录；③ 壳条目保留全部治理字段（渲染层只读这些字段，故治理面零漂移）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOVERNED_ASSETS_V2_REGISTRY,
  PUBLIC_SHELL_CATALOG,
  PUBLIC_SKILL_GOVERNANCE_CATALOG,
  SANITIZED_SKILL_COPIES,
} from '../shared/lib/public-skill-catalog';
import { PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog';
import { isShellGuardrail } from '../shared/lib/guardrail-scope';
import { isShellTemplatePrompt } from '../shared/lib/prompt-shell';
import {
  getCoreDefaultGuardrailCount,
  getGovernanceStage,
  getOptionalStyleAssets,
  getSanitizeRequiredAssets,
} from '../src/lib/capability-governance';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 唯一携带 `template` 正文的源模块；`prompt-assets-governed` 是纯类型 barrel，渲染层可正常引用。
const SOURCE_CATALOG_MODULES = ['prompt-governance-catalog'];

function listSourceFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests') continue; // 测试允许对照源目录
      out.push(...listSourceFiles(full, base));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) out.push(path.relative(base, full));
  }
  return out;
}

test('B1: src/** 不得 import 源治理目录（渲染层只消费公开壳目录）', () => {
  const files = listSourceFiles(path.join(repoRoot, 'src'), repoRoot);
  assert.ok(files.length > 50, '渲染层文件数量异常');
  const offenders: string[] = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    for (const mod of SOURCE_CATALOG_MODULES) {
      const pattern = new RegExp(`from ['"][^'"]*${mod}(\\.js)?['"]`);
      if (pattern.test(text)) offenders.push(`${rel} → ${mod}`);
    }
  }
  assert.deepEqual(offenders, [], `渲染层不得依赖源治理目录：${offenders.join('; ')}`);
});

test('B1: 壳目录物理无正文（template 全空）且规模与源目录一致', () => {
  assert.ok(PUBLIC_SHELL_CATALOG.length >= 180, `壳目录条目不足：${PUBLIC_SHELL_CATALOG.length}`);
  const withBody = PUBLIC_SHELL_CATALOG.filter((asset) => (asset.template ?? '') !== '');
  assert.deepEqual(
    withBody.map((asset) => asset.id),
    [],
    '壳目录不得携带任何提示词正文'
  );
});

test('B1: 壳目录 id 覆盖源目录与注册表且无重复', () => {
  const shellIds = PUBLIC_SHELL_CATALOG.map((asset) => asset.id);
  const shellIdSet = new Set(shellIds);
  assert.equal(shellIdSet.size, shellIds.length, '壳目录存在重复 id');
  const expected = new Set([
    ...PROMPT_GOVERNANCE_CATALOG.map((asset) => asset.id),
    ...GOVERNED_ASSETS_V2_REGISTRY.map((asset) => asset.id),
  ]);
  const missing = [...expected].filter((id) => !shellIdSet.has(id));
  assert.deepEqual(missing, [], `壳目录缺条目：${missing.join(', ')}`);
  const publicMissing = PUBLIC_SKILL_GOVERNANCE_CATALOG.map((asset) => asset.id).filter(
    (id) => !shellIdSet.has(id)
  );
  assert.deepEqual(publicMissing, [], `壳目录缺公开池条目：${publicMissing.join(', ')}`);
  // 消毒副本是独立池（`SANITIZED_SKILL_COPIES`），渲染层按 `[...壳目录, ...副本]` 合并消费。
  assert.ok(SANITIZED_SKILL_COPIES.length > 0, '消毒副本池为空');
});

test('B1: 壳目录固化源正文的壳判定（模板派生语义不得随投影丢失）', () => {
  const shellById = new Map(PUBLIC_SHELL_CATALOG.map((asset) => [asset.id, asset]));
  const drifted: string[] = [];
  for (const source of PROMPT_GOVERNANCE_CATALOG) {
    const shell = shellById.get(source.id);
    if (!shell) continue;
    const expected = isShellTemplatePrompt(source.template);
    if (shell.isShellBody !== expected) {
      drifted.push(`${source.id}: ${String(shell.isShellBody)} != ${String(expected)}`);
    }
  }
  assert.deepEqual(drifted, [], `壳标记漂移：${drifted.join('; ')}`);
  assert.ok(
    PUBLIC_SHELL_CATALOG.some((asset) => asset.isShellBody === true),
    '样本中应存在壳正文资产，否则本守卫失效'
  );
});

test('B1: 引用壳分类在壳目录与源目录两侧一致（模板清空不改变审计结论）', () => {
  const idsOf = (list: readonly { id: string }[]) =>
    list
      .filter((asset) => isShellGuardrail(asset as never))
      .map((asset) => asset.id)
      .sort();
  const shellSide = idsOf(PUBLIC_SHELL_CATALOG);
  const sourceSide = idsOf(PROMPT_GOVERNANCE_CATALOG);
  assert.deepEqual(shellSide, sourceSide);
  assert.ok(sourceSide.length > 0, '样本中应存在引用壳护栏');
});

const GOVERNANCE_FIELDS = [
  'stage',
  'score',
  'grade',
  'placementTier',
  'sanitizationStatus',
  'runtimeStatus',
  'licenseStatus',
  'sourceType',
  'isRuntimeReady',
  'isWhiteLabeled',
  'primaryCategory',
  'secondaryCategory',
  'deconstructionCardType',
  'processDecision',
  'evidenceLevel',
  'sourceGroup',
  'inputs',
] as const;

const normalize = (value: unknown): unknown =>
  value === undefined ? null : Array.isArray(value) ? [...value] : value;

test('B1: 壳条目保留全部治理字段（渲染仅读这些字段 → 治理面零漂移）', () => {
  const shellById = new Map(PUBLIC_SHELL_CATALOG.map((asset) => [asset.id, asset]));
  const drifted: string[] = [];
  for (const source of PROMPT_GOVERNANCE_CATALOG) {
    const shell = shellById.get(source.id);
    if (!shell) {
      drifted.push(`${source.id}:缺失`);
      continue;
    }
    for (const field of GOVERNANCE_FIELDS) {
      const a = JSON.stringify(normalize((source as unknown as Record<string, unknown>)[field]));
      const b = JSON.stringify(normalize((shell as unknown as Record<string, unknown>)[field]));
      if (a !== b) drifted.push(`${source.id}.${field}: ${a} → ${b}`);
    }
  }
  assert.deepEqual(drifted, [], `壳目录治理字段漂移：${drifted.join('; ')}`);
});

test('B1: 渲染层治理函数在壳目录上仍可用（货架 / 解锁 / 护栏计数非空）', () => {
  assert.ok(getCoreDefaultGuardrailCount() > 0, 'core-default 护栏计数为 0');
  const shelf = getOptionalStyleAssets();
  assert.ok(shelf.length > 0, '可选文风货架为空');
  assert.ok(
    shelf.every((asset) => getGovernanceStage(asset) !== null),
    '货架条目缺少阶段映射'
  );
  // 「需解锁」投影当前为空（实测源目录口径同样为 0：候选或已被副本吸收、
  // 或标题判为垃圾/重复；见 2026-09-28 诊断），故只断言口径不缩水。
  const locked = getSanitizeRequiredAssets();
  const shellIds = new Set(PUBLIC_SHELL_CATALOG.map((asset) => asset.id));
  assert.deepEqual(
    locked.map((asset) => asset.id).filter((id) => !shellIds.has(id)),
    [],
    '需解锁投影含壳目录外条目'
  );
});
