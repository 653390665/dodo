import type {
  AggregatedSkillDeck,
  BookEvidenceStage,
  SegmentSkillEvidence,
  SkillDeckCard,
  SkillDimension,
  SkillEvidenceCoverage,
} from '../types';

type EvidenceBucket = {
  total: number;
  moments: BookEvidenceStage[];
  evidence: string[];
};

const CARD_ROLE_META: Record<
  SkillDimension,
  {
    name: string;
    summary: string;
    useHint: string;
  }
> = {
  style: {
    name: '主笔文风卡',
    summary: '负责统一正文的语气、句法和画面质感。',
    useHint: '适合挂在主笔位，先决定整段文字怎么说。',
  },
  character: {
    name: '人物驱动卡',
    summary: '负责稳定角色说话方式、行为模式与关系张力。',
    useHint: '适合在人物戏、对手戏和情绪推进段落中补强。',
  },
  world: {
    name: '世界约束卡',
    summary: '负责维持世界规则、背景气压与设定边界。',
    useHint: '适合在设定展开、场景落地和规则约束时挂载。',
  },
  power: {
    name: '体系爆点卡',
    summary: '负责战力规则、能力升级与高能爆点的可信度。',
    useHint: '适合在修炼、对决和力量展示段落中补强。',
  },
  plot: {
    name: '剧情推进卡',
    summary: '负责冲突升级、钩子回收和爽点排列。',
    useHint: '适合在章节转折、钩子埋放和高潮推进时使用。',
  },
  pacing: {
    name: '节奏调速卡',
    summary: '负责控制快慢、停顿和爆点密度。',
    useHint: '适合在铺垫过长或推进过急时调节整体手感。',
  },
};

function deriveCoverage(stages: BookEvidenceStage[]): SkillEvidenceCoverage {
  const unique = Array.from(new Set(stages));
  if (unique.length >= 4) return 'full-book-stable';
  if (unique.every((stage) => stage === 'opening' || stage === 'early-mid')) return 'opening-heavy';
  if (unique.every((stage) => stage === 'mid' || stage === 'late-mid')) return 'mid-book-heavy';
  if (unique.every((stage) => stage === 'climax')) return 'climax-heavy';
  return 'weak-evidence';
}

function compactEvidenceLines(lines: Array<string | undefined>, limit = 2): string {
  const unique = Array.from(
    new Set(
      lines
        .map((line) => String(line || '').trim())
        .filter(Boolean),
    ),
  );

  return unique.slice(0, limit).join('；');
}

function getBucketText(buckets: Map<SkillDimension, EvidenceBucket>, dimension: SkillDimension, limit = 2): string {
  return compactEvidenceLines(buckets.get(dimension)?.evidence || [], limit);
}

export function buildSkillDeckFromEvidence(evidence: SegmentSkillEvidence[]): AggregatedSkillDeck {
  const buckets = new Map<SkillDimension, EvidenceBucket>();

  for (const segment of evidence) {
    for (const signal of segment.skillSignals) {
      const current = buckets.get(signal.dimension) || { total: 0, moments: [], evidence: [] };
      current.total += signal.weight;
      current.moments.push(segment.stage);
      current.evidence.push(signal.evidence);
      buckets.set(signal.dimension, current);
    }
  }

  const cards = Array.from(buckets.entries())
    .map(([dimension, bucket]) => {
      const coverage = deriveCoverage(bucket.moments);
      const role = CARD_ROLE_META[dimension];
      const styleText = getBucketText(buckets, 'style');
      const characterText = getBucketText(buckets, 'character');
      const worldText = getBucketText(buckets, 'world');
      const powerText = getBucketText(buckets, 'power');
      const plotText = getBucketText(buckets, 'plot');
      const pacingText = getBucketText(buckets, 'pacing');

      const strategyFields: Record<
        SkillDimension,
        Pick<SkillDeckCard, 'style' | 'pacing' | 'characterTraits' | 'worldBuilding' | 'plotPattern' | 'foreshadowing'>
      > = {
        style: {
          style: compactEvidenceLines([getBucketText(buckets, 'style', 3)]),
          pacing: compactEvidenceLines([pacingText, plotText]),
          characterTraits: compactEvidenceLines([characterText]),
          worldBuilding: compactEvidenceLines([worldText]),
          plotPattern: compactEvidenceLines([plotText]),
          foreshadowing: compactEvidenceLines([plotText]),
        },
        character: {
          style: compactEvidenceLines([styleText]),
          pacing: compactEvidenceLines([pacingText]),
          characterTraits: compactEvidenceLines([getBucketText(buckets, 'character', 3), plotText]),
          worldBuilding: compactEvidenceLines([worldText]),
          plotPattern: compactEvidenceLines([plotText]),
          foreshadowing: compactEvidenceLines([plotText]),
        },
        world: {
          style: compactEvidenceLines([styleText]),
          pacing: compactEvidenceLines([pacingText]),
          characterTraits: compactEvidenceLines([characterText]),
          worldBuilding: compactEvidenceLines([getBucketText(buckets, 'world', 3), powerText]),
          plotPattern: compactEvidenceLines([plotText]),
          foreshadowing: compactEvidenceLines([plotText]),
        },
        power: {
          style: compactEvidenceLines([styleText]),
          pacing: compactEvidenceLines([pacingText]),
          characterTraits: compactEvidenceLines([characterText]),
          worldBuilding: compactEvidenceLines([worldText, getBucketText(buckets, 'power', 3)]),
          plotPattern: compactEvidenceLines([plotText, powerText]),
          foreshadowing: compactEvidenceLines([plotText]),
        },
        plot: {
          style: compactEvidenceLines([styleText]),
          pacing: compactEvidenceLines([pacingText, getBucketText(buckets, 'plot', 3)]),
          characterTraits: compactEvidenceLines([characterText]),
          worldBuilding: compactEvidenceLines([worldText]),
          plotPattern: compactEvidenceLines([getBucketText(buckets, 'plot', 3), powerText]),
          foreshadowing: compactEvidenceLines([getBucketText(buckets, 'plot', 3)]),
        },
        pacing: {
          style: compactEvidenceLines([styleText]),
          pacing: compactEvidenceLines([getBucketText(buckets, 'pacing', 3), plotText]),
          characterTraits: compactEvidenceLines([characterText]),
          worldBuilding: compactEvidenceLines([worldText]),
          plotPattern: compactEvidenceLines([plotText]),
          foreshadowing: compactEvidenceLines([plotText]),
        },
      };

      return {
        id: `deck-${dimension}`,
        name: role.name,
        description: `${role.summary}${bucket.evidence[0] ? ` 证据锚点：${bucket.evidence[0]}` : ''}`,
        ...strategyFields[dimension],
        stabilityScore: Math.round((bucket.total / bucket.moments.length) * 100),
        evaluationFeedback: `${role.useHint}｜${coverage}｜基于整书分段证据汇总`,
        version: 1,
        createdAt: Date.now(),
        primaryDimension: dimension,
        dimensionTags: [dimension],
        compositionProfile: {
          styleWeight: dimension === 'style' ? 0.85 : 0.25,
          characterWeight: dimension === 'character' ? 0.85 : 0.25,
          worldWeight: dimension === 'world' ? 0.85 : 0.25,
          powerWeight: dimension === 'power' ? 0.85 : 0.25,
          plotWeight: dimension === 'plot' ? 0.85 : 0.25,
          pacingWeight: dimension === 'pacing' ? 0.85 : 0.25,
          conflictTags: [],
          blendHints: [],
        },
        evidenceCoverage: coverage,
        evidenceMoments: Array.from(new Set(bucket.moments)),
      } satisfies SkillDeckCard;
    })
    .filter((card) => card.stabilityScore >= 60)
    .sort((left, right) => right.stabilityScore - left.stabilityScore);

  if (cards.length === 0) {
    throw new Error('No strong enough deck cards could be derived from whole-book evidence');
  }

  return {
    mainCard: cards[0],
    supportCards: cards.slice(1, 5),
  };
}
