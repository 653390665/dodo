/**
 * Plan 192 spike prototype — deck pack export → zip → import round-trip.
 * 构造 2 张拆书卡 → 导出（消毒快照 + zip）→ 临时库导入（re-id + 落库）→ 断言一致。
 * 只用临时库，不碰 data.db。运行：node --import tsx scripts/deck-pack-prototype.ts
 */
import JSZip from 'jszip';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { initDb } from '../server/lib/db-init.ts';
import { createSkill, getSkill, listSkills } from '../server/lib/db/skills.ts';
import { sanitizeWhiteLabelText } from '../shared/lib/public-skill-catalog.ts';
import type { Skill } from '../shared/types/skills.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` :: ${detail}`}`);
  if (!cond) failures += 1;
}

const TEXT_FIELDS: Array<keyof Skill> = [
  'name', 'description', 'style', 'pacing', 'characterTraits', 'worldBuilding',
  'foreshadowing', 'plotPattern', 'evaluationFeedback', 'whyThisSkillWorks',
];

/** 导出子集：排除运行时字段（PRD §2）；version 导入侧重置。 */
function toExportCard(skill: Skill): Partial<Skill> {
  const card = JSON.parse(JSON.stringify(skill)) as Partial<Skill> & Record<string, unknown>;
  // 运行时与治理字段不随文件流通（PRD §2/§4）
  delete card.usageStats;
  delete card.feedbackScore;
  delete card.executionScore;
  delete card.stabilityScore;
  delete card.version;
  delete card.accessTier;
  delete card.sourceType;
  return card;
}

function reId(id: string | undefined, idMap: Map<string, string>): string | undefined {
  if (!id) return undefined;
  if (!idMap.has(id)) {
    const h = createHash('sha256').update(id).digest('hex').slice(0, 8);
    idMap.set(id, `imp-${h}-${id}`);
  }
  return idMap.get(id);
}

function importCard(card: Partial<Skill>, idMap: Map<string, string>): Skill {
  const imported: Skill = {
    ...(card as Skill),
    id: reId(card.id, idMap)!,
    version: 1,
    sanitizationStatus: 'runtime-ready',
    runtimeStatus: 'active',
    // 治理边界（PRD §4）：不信任原 sourceType/accessTier。'book-extracted' 是
    // manifest.ts 授权枚举中拆书卡专属来源；导出侧已过消毒管线、导入侧重跑快照，
    // 通过即 runtime-ready（与 /api/skills/sanitize 端点的落库先例一致）。
    sourceType: 'book-extracted',
    isRuntimeReady: true,
  };
  if (imported.parentSkillId) imported.parentSkillId = reId(imported.parentSkillId, idMap);
  if (imported.lineageRootId) imported.lineageRootId = reId(imported.lineageRootId, idMap);
  if (imported.deckGroupId) imported.deckGroupId = reId(imported.deckGroupId, idMap);
  return imported;
}

// ── 1. 构造 deck fixtures（模拟两张真实拆书卡，含白标文本）──
const deckId = 'deck-demo-001';
const fixtures: Skill[] = [
  {
    id: 'skill-style-001', name: '冷峻悬疑主笔卡（XX 工坊出品）',
    description: '短句压迫感叙事。想要了解更多请联系微信：abc12345。',
    style: '冷峻、克制、短句', pacing: '前三章每章必留钩子',
    bannedWords: ['缓缓', '一瞬间'], corePatterns: ['钩子-延迟满足'],
    stabilityScore: 0.8, evaluationFeedback: '',
    version: 3, deckGroupId: deckId, deconstructionCardType: 'style-card',
    sourceBadge: 'book-extracted', sanitizationStatus: 'raw', runtimeStatus: 'active',
    primaryDimension: 'style', createdAt: Date.now(), updatedAt: Date.now(),
  },
  {
    id: 'skill-world-002', name: '力量体系世界观卡', description: '修炼等级与代价设定。',
    style: '设定驱动', pacing: '匀速', worldBuilding: '九级力量体系，每一级折寿一年',
    stabilityScore: 0.7, evaluationFeedback: '', version: 1,
    parentSkillId: 'skill-style-001', lineageRootId: 'skill-style-001',
    deckGroupId: deckId, deconstructionCardType: 'worldview-card',
    sourceBadge: 'book-extracted', sanitizationStatus: 'raw', runtimeStatus: 'active',
    primaryDimension: 'world', createdAt: Date.now(),
  },
];

// ── 2. 导出：消毒快照 + zip ──
const tmp = mkdtempSync(join(tmpdir(), 'inkdeck-'));
const zipPath = join(tmp, 'deck-demo-001.inkdeck');
const zip = new JSZip();
const manifest = {
  format: 'inkflow-deck-pack', formatVersion: 1, deckId,
  title: '示例悬疑卡组', exportedAt: new Date().toISOString(), sanitized: true,
  cards: fixtures.map((s) => ({ id: s.id, file: `cards/${s.id}.json`, deconstructionCardType: s.deconstructionCardType })),
};
zip.file('manifest.json', JSON.stringify(manifest, null, 2));
for (const raw of fixtures) {
  const card = toExportCard(raw);
  for (const f of TEXT_FIELDS) {
    if (typeof card[f] === 'string') (card as Record<string, unknown>)[f] = sanitizeWhiteLabelText(card[f] as string);
  }
  card.sanitizationStatus = 'sanitized';
  zip.file(`cards/${raw.id}.json`, JSON.stringify(card, null, 2));
}
writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
check('P1 zip 落盘', existsSync(zipPath));

// ── 3. 导入：解包 → re-id → 临时库落库 ──
const dbPath = join(tmp, 'imported.db');
initDb(dbPath);
check('P2 临时库空', listSkills().length === 0);

const unpack = await JSZip.loadAsync(readFileSync(zipPath));
const manifestBack = JSON.parse(await unpack.file('manifest.json')!.async('string'));
check('P3 manifest 往返', manifestBack.format === 'inkflow-deck-pack' && manifestBack.formatVersion === 1 && manifestBack.sanitized === true);

const importMap = new Map<string, string>();
const cardFiles = Object.keys(unpack.files).filter((f) => f.startsWith('cards/') && f.endsWith('.json'));
check('P4 卡文件数 = 2', cardFiles.length === 2, String(cardFiles));
for (const f of cardFiles) {
  const card = JSON.parse(await unpack.file(f)!.async('string')) as Partial<Skill>;
  createSkill(importCard(card, importMap));
}
check('P5 落库 2 张', listSkills().length === 2);

// ── 4. 往返断言 ──
for (const orig of fixtures) {
  const newId = importMap.get(orig.id)!;
  const back = getSkill(newId);
  check(`P6 ${orig.id} 重映射落库`, !!back);
  if (!back) continue;
  check(`P7 ${orig.id} 消毒文本一致`, back.description === sanitizeWhiteLabelText(orig.description)
    && back.style === sanitizeWhiteLabelText(orig.style), JSON.stringify({ back: back.description }));
  check(`P8 ${orig.id} 联系方式类白标已物理剥离`, !back.description.includes('abc12345') && !back.description.includes('微信'));
  check(`P9 ${orig.id} version 重置=1`, back.version === 1);
  check(`P10 ${orig.id} runtime 治理=active+runtime-ready+book-extracted`, back.runtimeStatus === 'active' && back.sanitizationStatus === 'runtime-ready' && back.isRuntimeReady === true && back.sourceType === 'book-extracted');
  check(`P11 ${orig.id} 非文本字段保真`, back.deconstructionCardType === orig.deconstructionCardType && back.primaryDimension === orig.primaryDimension);
  // 注意：DB mapper 读取会补 runtime 默认值，P12 只能断言在 zip 导出层
  const zipCard = JSON.parse(await unpack.file(`cards/${orig.id}.json`)!.async('string'));
  check(`P12 ${orig.id} 运行时/治理字段未导出（zip 层）`, zipCard.usageStats === undefined && zipCard.feedbackScore === undefined && zipCard.accessTier === undefined && zipCard.sourceType === undefined);
}
const world = getSkill(importMap.get('skill-world-002')!)!;
check('P13 血缘重映射', world.parentSkillId === importMap.get('skill-style-001'));
// 发现（已记入 PRD §2）：skills 表 insertColumns 不含 deck_group_id，
// deck 分组不落库——分组保真只能在 zip/manifest 层断言。
const zipStyle = JSON.parse(await unpack.file('cards/skill-style-001.json')!.async('string'));
const zipWorld = JSON.parse(await unpack.file('cards/skill-world-002.json')!.async('string'));
check('P14 deckGroup 分组保真（manifest 层；DB 列缺失为已登记发现）', zipStyle.deckGroupId === zipWorld.deckGroupId && zipWorld.deckGroupId === deckId);

// ── 5. 清理与总结 ──
rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? `\nALL ${14} CHECKS PASSED` : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
