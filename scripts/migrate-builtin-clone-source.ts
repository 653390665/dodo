/**
 * Plan 257 存量克隆 sourceType 迁移：plaza → built-in（一次性维护）。
 *
 * 背景：prose-mouth-flavor、audit-logical-sanity、deconstruct-golden-climax、
 * deconstruct-suspense-hook 四张官方卡已 asset 与 manifest 双层转 built-in。
 * 此后货架克隆（cloneAssetToSkill 按 manifest.sourceType 落库）带 built-in，
 * 而存量克隆仍为 plaza——前端 existing/去重按资产 sourceType（built-in）查找
 * 会失配：表现为重复导入克隆、包内启用被标 skipped。本脚本把 parentSkillId
 * 命中四个源 id 且 sourceType 仍为 plaza 的存量行统一改为 built-in。
 *
 * 运行：npx tsx scripts/migrate-builtin-clone-source.ts（建议先停 dev server 再执行）
 * 幂等：重复运行第二遍应为 0 行变更（只选 sourceType 仍为 plaza 的行）。
 */
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import { initDb, listSkills, updateSkillRowForMaintenance } from '../server/lib/db';
import type { Skill } from '../shared/types';

/** Plan 257 双层转 built-in 的源卡 id（与 asset/manifest 翻转清单一致）。 */
export const BUILTIN_SOURCE_IDS = [
  'prose-mouth-flavor',
  'audit-logical-sanity',
  'deconstruct-golden-climax',
  'deconstruct-suspense-hook',
] as const;

export interface BuiltinCloneMigration {
  id: string;
  parentSkillId: string;
  from: 'plaza';
  to: 'built-in';
}

/** 纯函数：从技能清单选出需要迁移的克隆行（测试用同一逻辑做幂等验证）。 */
export function selectBuiltinCloneMigrations(skills: Skill[]): BuiltinCloneMigration[] {
  const migrations: BuiltinCloneMigration[] = [];
  for (const skill of skills) {
    const parentSkillId = skill.parentSkillId || skill.id;
    if (!(BUILTIN_SOURCE_IDS as readonly string[]).includes(parentSkillId)) continue;
    if (skill.sourceType !== 'plaza') continue;
    migrations.push({ id: skill.id, parentSkillId, from: 'plaza', to: 'built-in' });
  }
  return migrations;
}

/** 对给定清单执行迁移（写库走 updateSkillRowForMaintenance 维护通道）。 */
export function applyBuiltinCloneMigrations(skills: Skill[]): BuiltinCloneMigration[] {
  const migrations = selectBuiltinCloneMigrations(skills);
  for (const migration of migrations) {
    updateSkillRowForMaintenance(migration.id, { sourceType: 'built-in' });
  }
  return migrations;
}

function main(): void {
  initDb();
  const skills = listSkills();
  const migrations = applyBuiltinCloneMigrations(skills);
  for (const migration of migrations) {
    console.log(
      `[migrate-builtin-clone] ${migration.id} (parent=${migration.parentSkillId}): ${migration.from} -> ${migration.to}`
    );
  }
  console.log(`[migrate-builtin-clone] 完成：扫描 ${skills.length} 行，迁移 ${migrations.length} 行。`);
}

// 仅脚本直跑时执行；被测试导入时跳过。
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) main();
