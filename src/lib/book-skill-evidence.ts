import type { SegmentSkillEvidence, SkillDimension, SkillSignalEvidence } from '../../shared/types';

export function collectSignalEvidenceFromSkill(skill: any): SkillSignalEvidence[] {
  const signals: SkillSignalEvidence[] = [];
  const profile = skill?.compositionProfile || {};

  const pushSignal = (dimension: SkillDimension, source: string, fallbackWeight: number) => {
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

  pushSignal('style', skill?.style, 0.88);
  pushSignal('character', skill?.characterTraits, 0.72);
  pushSignal('world', skill?.worldBuilding, 0.68);
  pushSignal('power', [skill?.worldBuilding, skill?.plotPattern].filter(Boolean).join('；'), 0.58);
  pushSignal('plot', [skill?.plotPattern, skill?.foreshadowing].filter(Boolean).join('；'), 0.8);
  pushSignal('pacing', skill?.pacing, 0.74);

  return signals;
}

export function collectSegmentEvidence(rawSkills: any[], stage: SegmentSkillEvidence['stage']): SegmentSkillEvidence | null {
  const skillSignals = rawSkills.flatMap((skill) => collectSignalEvidenceFromSkill(skill));
  if (skillSignals.length === 0) return null;

  return {
    stage,
    skillSignals,
  };
}
