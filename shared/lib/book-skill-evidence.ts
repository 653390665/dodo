import type { SegmentSkillEvidence, SkillDimension, SkillSignalEvidence, Skill } from '../types';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function collectSignalEvidenceFromSkill(skill: Partial<Skill> | Record<string, unknown>): SkillSignalEvidence[] {
  const signals: SkillSignalEvidence[] = [];
  const skillRec = asRecord(skill);
  const profile = asRecord(skillRec.compositionProfile);

  const pushSignal = (dimension: SkillDimension, source: unknown, fallbackWeight: number) => {
    const evidence = String(source || '').trim();
    if (!evidence) return;

    const weightByDimension: Record<SkillDimension, number> = {
      style: Number(profile.styleWeight || fallbackWeight),
      character: Number(profile.characterWeight || fallbackWeight),
      world: Number(profile.worldWeight || fallbackWeight),
      power: Number(profile.powerWeight || fallbackWeight),
      plot: Number(profile.plotWeight || fallbackWeight),
      pacing: Number(profile.pacingWeight || fallbackWeight),
    };

    signals.push({
      dimension,
      weight: Math.max(0.35, Math.min(1, weightByDimension[dimension] || fallbackWeight)),
      evidence: evidence.length > 120 ? `${evidence.slice(0, 120)}…` : evidence,
    });
  };

  pushSignal('style', skillRec.style, 0.88);
  pushSignal('character', skillRec.characterTraits, 0.72);
  pushSignal('world', skillRec.worldBuilding, 0.68);
  pushSignal('power', [skillRec.worldBuilding, skillRec.plotPattern].filter(Boolean).map(String).join('；'), 0.58);
  pushSignal('plot', [skillRec.plotPattern, skillRec.foreshadowing].filter(Boolean).map(String).join('；'), 0.8);
  pushSignal('pacing', skillRec.pacing, 0.74);

  return signals;
}

export function collectSegmentEvidence(rawSkills: Array<Partial<Skill> | Record<string, unknown>>, stage: SegmentSkillEvidence['stage']): SegmentSkillEvidence | null {
  const skillSignals = rawSkills.flatMap((skill) => collectSignalEvidenceFromSkill(skill));
  if (skillSignals.length === 0) return null;

  return {
    stage,
    skillSignals,
  };
}
