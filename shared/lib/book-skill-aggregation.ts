import type {
  AggregatedSkillDeck,
  BookEvidenceStage,
  SegmentSkillEvidence,
  SkillDeckCard,
  SkillDimension,
  SkillEvidenceCoverage,
  SkillMethodChain,
  SkillMethodQA,
} from '../types';
import { evaluateDeconstructionCard } from './deconstruction-scoring';
import type { DeconstructionCardType } from '../types';


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
    useHint: '适合在设定展开、场景落地和规则约束时配置到本次写作。',
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

export function buildMethodChain(dimension: SkillDimension, evidence: string[]): SkillMethodChain {
  const role = CARD_ROLE_META[dimension];
  const uniqueEvidence = Array.from(new Set(evidence.map((e) => e.trim()).filter(Boolean))).slice(0, 4);

  const generateScale = `${uniqueEvidence.join(' + ')}`.length > 60 ? 2 : 3;

  const items: SkillMethodQA[] = uniqueEvidence.slice(0, generateScale).map((item, index) => {
    return {
      question: index === 0
        ? `为什么这个写法在${role.name}中有效？`
        : index === 1
        ? `这个模式在什么条件下会失效？`
        : `如果不使用这个技巧，会产生什么后果？`,
      answer: index === 0
        ? `证据显示：${item}。这种写法之所以成立，是因为它同时满足了${role.summary}的核心约束。`
        : index === 1
        ? `当${item}的前提条件不满足时，硬套这个模式会导致失真。具体边界：偏离设定逻辑、人物性格不一致、节奏突然变化时均应停用。`
        : `不使用这个技巧时，${role.name}维度的写作会缺乏方向感，容易出现风格漂移或设定矛盾。`,
      formalization: index === 0
        ? `${role.name} = 稳定特征 + 证据锚点`
        : index === 1
        ? `失效条件 = 前提崩塌 ∨ 边界突破`
        : `缺失成本 = 无方向 × 漂移概率`,
      steps: index === 0
        ? ['提取关键特征', '匹配当前场景', '验证风格一致性', '输出调整后文本']
        : ['检查前提是否成立', '确认边界内操作', '若边界外，降级为参考', '若前提崩塌，停用该卡'],
      boundary: index === 0
        ? `适用于${role.useHint.slice(0, 30)}等场景。不适用于设定冲突或跨维度混合场景。`
        : index === 1
        ? `超出${role.name}覆盖范围时不应使用。不适合的维度领域应切换其他卡。`
        : `代价可控时不使用也可。但对${role.name}敏感的场景缺失该技法会显著降低一致性。`,
    };
  });

  return {
    items,
    summary: `${role.name}基于 ${evidence.length} 条证据锚定。${role.summary}`,
  };
}

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

      const DIMENSION_TO_CARD_TYPE: Record<SkillDimension, DeconstructionCardType> = {
        style: 'style-card',
        character: 'character-card',
        world: 'worldview-card',
        power: 'worldview-card',
        plot: 'conflict-card',
        pacing: 'pacing-card',
      };

      const cardType = DIMENSION_TO_CARD_TYPE[dimension];
      const scoreReport = evaluateDeconstructionCard({
        ...strategyFields[dimension],
        fewShots: bucket.evidence,
      });

      return {
        id: `deck-${dimension}`,
        sourceCardId: `deck-${dimension}`,
        name: role.name,
        description: `${role.summary}${bucket.evidence[0] ? ` 证据锚点：${bucket.evidence[0]}` : ''}`,
        ...strategyFields[dimension],
        fewShots: bucket.evidence,
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
        sourceBadge: 'book-extracted',
        deconstructionCardType: cardType,
        executionScore: scoreReport.score,
      } satisfies SkillDeckCard & { sourceCardId?: string };
    })
    .filter((card) => card.stabilityScore >= 60)
    .sort((left, right) => right.stabilityScore - left.stabilityScore);

  if (cards.length === 0) {
    throw new Error('No strong enough deck cards could be derived from whole-book evidence');
  }

  // Cards remain unassigned until the project deck explicitly selects a main
  // card. Method chains are attached per dimension; the compatibility field
  // below is presentation-only and must not be treated as runtime selection.
  const methodChains = new Map<SkillDimension, SkillMethodChain>();
  for (const card of cards) {
    const dimension = card.primaryDimension || 'style';
    if (methodChains.has(dimension)) continue;
    const bucket = buckets.get(dimension);
    if (bucket) methodChains.set(dimension, buildMethodChain(dimension, bucket.evidence));
  }
  const enrichedCards = cards.map((card) => {
    const methodChain = methodChains.get(card.primaryDimension || 'style');
    return methodChain ? { ...card, methodChain, whyThisSkillWorks: methodChain.summary } : card;
  });
  const methodChain = methodChains.get(enrichedCards[0]?.primaryDimension || 'style');
  const compatibilityMainCard = enrichedCards.find(Boolean);
  if (!compatibilityMainCard) throw new Error('No deck cards available for compatibility output');

  return {
    // AggregatedSkillDeck still exposes mainCard for legacy consumers. Runtime
    // callers must use the explicit project deck selection instead.
    mainCard: { ...compatibilityMainCard, sourceCardId: compatibilityMainCard.id } as unknown as SkillDeckCard,
    supportCards: enrichedCards,
    methodChain,
  };
}
