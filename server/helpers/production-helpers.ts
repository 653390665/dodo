export function buildEmptyContinuityReport() {
  return {
    score: 70,
    issues: [],
    proposedPatch: {
      characterUpdates: [],
      itemUpdates: [],
      foreshadowingUpdates: [],
      timelineEventsToCreate: [],
      foreshadowingsToCreate: [],
    },
  };
}

export function buildContractPrompt(contract: {
  powerCeiling?: string;
  noResurrection?: boolean;
  characterConsistency?: string;
  customConstraints?: string[];
}): string {
  const rules: string[] = [];
  if (contract.powerCeiling) {
    rules.push(`战力天花板：${contract.powerCeiling}`);
  }
  if (contract.noResurrection) {
    rules.push('禁止复活已死角色');
  }
  if (contract.characterConsistency === 'strict') {
    rules.push('角色行为须严格符合人设，重大转变需铺垫');
  }
  if (contract.customConstraints?.length) {
    contract.customConstraints.forEach((r) => rules.push(r));
  }
  if (rules.length === 0) return '';
  return '【写作合同约束 — 必须遵守】\n' + rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
}
