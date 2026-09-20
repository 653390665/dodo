/**
 * 存量能力卡文本一次性重洗（Plan 253 后续）。
 *
 * 背景：旧「货架克隆」路径在 sanitizeWhiteLabelText 接入前落库了带上传者
 * 品牌（【小飞鸡】等）的原始标题；消毒管线只在写入新卡时生效，存量行不会被
 * 重洗。本脚本对 skills 表全部卡的文本字段跑与 finalizeExtractedCard 同源的
 * 清洗（name 额外过 sanitizeWhiteLabelText 剥品牌前缀），仅在发生变化时回写。
 *
 * 运行：npx tsx scripts/reclean-skill-brands.ts（建议先停 dev server 再执行）
 * 幂等：重复运行第二遍应为 0 张变更。
 */
import { initDb, listSkills, updateSkillRowForMaintenance } from '../server/lib/db';
import { sanitizeWhiteLabelText, analyzeAndSanitize } from '../shared/lib/prompt-sanitizer';
import type { Skill, SanitizationHits } from '../shared/types';

const STRING_FIELDS = [
  'name',
  'description',
  'style',
  'pacing',
  'characterTraits',
  'worldBuilding',
  'plotPattern',
  'foreshadowing',
] as const;
const LIST_FIELDS = [
  'vocabulary',
  'imagery',
  'fewShots',
  'corePatterns',
  'bannedElements',
  'bannedWords',
] as const;

function cleanName(value: string): string {
  // name 是品牌前缀高发位：先剥【小飞鸡】等括号/前缀形态，再走通用扫描。
  return analyzeAndSanitize(sanitizeWhiteLabelText(value)).sanitizedText.trim();
}

function cleanBody(value: string): string {
  // 正文类字段不用 sanitizeWhiteLabelText（其「X专用/定制」宽正则会误删正常文案），
  // 只做 analyzeAndSanitize 的联系方式/竞品/水印剥除。
  return analyzeAndSanitize(value).sanitizedText;
}

function main(): void {
  initDb();
  const skills = listSkills();
  let changed = 0;
  for (const skill of skills) {
    const patch: Record<string, unknown> = {};
    const hits: SanitizationHits = { contacts: 0, authors: 0, brands: 0, watermarks: 0 };
    const scan = (value: string): string => {
      const result = analyzeAndSanitize(value);
      hits.contacts += result.hits.contacts;
      hits.authors += result.hits.authors;
      hits.brands += result.hits.brands;
      hits.watermarks += result.hits.watermarks;
      return result.sanitizedText;
    };
    for (const field of STRING_FIELDS) {
      const value = (skill as Skill)[field];
      if (typeof value !== 'string' || !value) continue;
      const cleaned = field === 'name' ? cleanName(value) : cleanBody(value);
      if (cleaned !== value) patch[field] = cleaned;
    }
    for (const field of LIST_FIELDS) {
      const value = (skill as Skill)[field];
      if (!Array.isArray(value)) continue;
      const cleaned = value.map((item) => (typeof item === 'string' ? scan(item) : item));
      if (cleaned.some((item, i) => item !== value[i])) patch[field] = cleaned;
    }
    if (Object.keys(patch).length === 0) continue;
    patch.sanitizationHits = hits;
    updateSkillRowForMaintenance(skill.id, patch as Partial<Skill>);
    changed += 1;
    const nameBefore = skill.name;
    const nameAfter = typeof patch.name === 'string' ? patch.name : skill.name;
    console.log(`[reclean] ${skill.id}\n  name: ${nameBefore} -> ${nameAfter}`);
  }
  console.log(`[reclean] 完成：${skills.length} 张卡，重写 ${changed} 张。`);
}

main();
