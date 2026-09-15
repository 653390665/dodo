/**
 * Plan 226 症候入口：把「这章要解决什么」映射到现有货架卡的过滤条件。
 * 首版为固定症候 + 关键词/分类映射（不新增目录字段）；
 * 映射只命中过滤谓词，不构成任何新的治理语义。
 */

import type { CuratedProductSkill } from '../../shared/types/prompt-assets-governed';

export interface CapabilitySymptom {
  key: string;
  label: string;
  hint: string;
  /** 命中判定：标题/目标/分类/阶段关键词任一命中即入选。 */
  matches: (asset: CuratedProductSkill) => boolean;
}

const hasAny = (haystack: string, needles: readonly string[]) =>
  needles.some((needle) => haystack.includes(needle));

export const CAPABILITY_SYMPTOMS: readonly CapabilitySymptom[] = [
  {
    key: 'de-ai',
    label: '去 AI 味',
    hint: '翻案腔、套话、机械句式',
    matches: (asset) =>
      asset.id.includes('slop') ||
      hasAny(`${asset.title}${asset.goal}`, ['AI', '去味', '净化', '套话', '翻译腔']),
  },
  {
    key: 'hook-opening',
    label: '开篇与钩子',
    hint: '开篇、悬念、完读率',
    matches: (asset) =>
      hasAny(`${asset.title}${asset.goal}${asset.successSignal ?? ''}`, [
        '开头',
        '开篇',
        '钩子',
        '悬念',
        '完读',
        '标题',
      ]),
  },
  {
    key: 'voice',
    label: '口吻腔调',
    hint: '文风、对白、人物语气',
    matches: (asset) =>
      hasAny(`${asset.title}${asset.goal}`, ['口吻', '文风', '对白', '语气', '腔调']),
  },
  {
    key: 'pacing',
    label: '节奏推进',
    hint: '场景推进、冲突、爽点',
    matches: (asset) =>
      hasAny(`${asset.title}${asset.goal}`, ['节奏', '爽点', '场面']),
  },
  {
    key: 'platform-pass',
    label: '过签与平台',
    hint: '番茄、阅文、平台检查',
    matches: (asset) =>
      hasAny(`${asset.title}${asset.goal}${asset.successSignal ?? ''}`, [
        '番茄',
        '阅文',
        'Webnovel',
        '平台',
        '过签',
        '完读率',
      ]),
  },
];

export function filterBySymptom(
  assets: readonly CuratedProductSkill[],
  symptomKey: string
): CuratedProductSkill[] {
  const symptom = CAPABILITY_SYMPTOMS.find((entry) => entry.key === symptomKey);
  if (!symptom) return [];
  return assets.filter((asset) => symptom.matches(asset));
}
