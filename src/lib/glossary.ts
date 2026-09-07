/**
 * 006 词汇表：对外文案的唯一名词映射。
 *
 * 规则：
 * - 用户可见文案一律使用"对外唯一名词"；旧词只允许出现在代码标识符、
 *   数据字段与类型定义中。
 * - "写法确认"是专有流程名，保留不动（留存化机制依赖其语义）。
 * - 收敛是渐进的：新增文案必须用新词；存量旧词按文件逐步替换。
 */
export const GLOSSARY: ReadonlyArray<{ term: string; replaces: ReadonlyArray<string>; note?: string }> = [
  { term: '能力卡', replaces: ['技能', '拆书卡', '结构卡', '职责卡'], note: '能力中心/商店里的一切可启用卡片统称能力卡' },
  { term: '常用技法', replaces: ['技法', '偏好技法'], note: '启用后写入 favoriteTechniqueIds 的卡' },
  { term: '写法确认', replaces: [], note: '专有流程名，保留（写法确认留存化依赖其语义）' },
  { term: '质量标准', replaces: ['系统护栏', '护栏增强'], note: '003 起护栏不再上货架，统一叫质量标准面板' },
  { term: '创作流程', replaces: ['流程', '技能系列'], note: 'SKILL_SERIES_FLOWS 的对外名称' },
  { term: '质量报告', replaces: ['AI 审稿报告', '审稿标签'], note: '002 起完成审查结论的唯一查看面' },
];

/** 判断某词是否为被收编的旧词（用于 lint 式 grep 检查与测试）。 */
export function isLegacyTerm(term: string): boolean {
  return GLOSSARY.some((entry) => entry.replaces.includes(term));
}
