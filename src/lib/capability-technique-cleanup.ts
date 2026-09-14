/**
 * 技法引用清理（「技法不存在」锁死配置修复的客户端半边）：
 * 服务端预览对失效技法引用降级为 warnings（TECHNIQUE_UNRESOLVED:<id> 等前缀格式），
 * 这里把 warning 解析回失效 id，并从配置草稿中摘除对应引用——
 * 摘除规则：id 本身命中，或 capabilityMemberships.sourceId 命中（连带移除对应落库引用）。
 */

export interface TechniqueMembershipRef {
  persistedSkillId?: string;
  sourceId?: string;
}

export interface TechniqueRefsDraft {
  favoriteTechniqueIds?: string[];
  projectTechniqueIds?: string[];
  capabilityMemberships?: TechniqueMembershipRef[];
}

const TECHNIQUE_WARNING_PREFIXES = [
  'TECHNIQUE_UNRESOLVED:',
  'TECHNIQUE_KIND_INVALID:',
  'TECHNIQUE_NOT_RUNTIME_READY:',
];

export function extractUnresolvedTechniqueIds(warnings: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const warning of warnings) {
    const prefix = TECHNIQUE_WARNING_PREFIXES.find((candidate) => warning.startsWith(candidate));
    if (!prefix) continue;
    const id = warning.slice(prefix.length).trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function stripUnresolvedTechniqueRefs<T extends TechniqueRefsDraft>(
  draft: T,
  unresolvedIds: readonly string[]
): T {
  const deadSources = new Set(unresolvedIds);
  if (deadSources.size === 0) return draft;
  const deadIds = new Set<string>(deadSources);
  for (const membership of draft.capabilityMemberships || []) {
    if (membership.sourceId && deadSources.has(membership.sourceId) && membership.persistedSkillId) {
      deadIds.add(membership.persistedSkillId);
    }
  }
  const stripList = (ids?: string[]) => ids?.filter((id) => !deadIds.has(id));
  return {
    ...draft,
    favoriteTechniqueIds: stripList(draft.favoriteTechniqueIds),
    projectTechniqueIds: stripList(draft.projectTechniqueIds),
    capabilityMemberships: draft.capabilityMemberships?.filter(
      (membership) =>
        !(membership.persistedSkillId && deadIds.has(membership.persistedSkillId)) &&
        !(membership.sourceId && deadSources.has(membership.sourceId))
    ),
  };
}
