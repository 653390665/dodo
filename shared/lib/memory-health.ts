/**
 * 批次 D · 记忆健康度看板（2026-09-27）：五项指标的单一口径。
 *
 * 纯逻辑，不读库、不发请求：
 * - 服务端 `server/helpers/memory-health.ts` 负责取数（台账 / 伏笔 / 图边 / 向量索引 / 嵌入状态），
 *   再调用 `buildMemoryHealthMetrics` 组装；
 * - 前端 `src/components/MemoryHealthPanel.tsx` 只渲染服务端返回值。
 * 「指标口径与后端计算同源」即由此保证（孤立节点定义也只在此处实现一次）。
 *
 * 诚实性（沿用 `llm-status-honesty` 口径）：数据缺失一律 `value: null` + `unknownReason`，
 * 界面渲染为「未知」，绝不以 0 代替；0 只在真实取到 0（查询成功且确为 0）时出现。
 */

import { MAX_ARREARS_IN_PROMPT } from './knowledge-capabilities.js';

export const MEMORY_HEALTH_METRIC_KEYS = [
  'openForeshadowings',
  'foreshadowArrears',
  'orphanNodes',
  'staleKnowledge',
  'ragHits',
] as const;

export type MemoryHealthMetricKey = (typeof MEMORY_HEALTH_METRIC_KEYS)[number];

export type MemoryHealthEntityType = 'character' | 'location' | 'item' | 'faction';

export const MEMORY_HEALTH_ENTITY_TYPES = [
  'character',
  'location',
  'item',
  'faction',
] as const satisfies readonly MemoryHealthEntityType[];

/** 界面口径：数据缺失统一显示此文案，不显示 0。 */
export const MEMORY_HEALTH_UNKNOWN_TEXT = '未知';

export const MEMORY_HEALTH_METRIC_LABELS: Record<MemoryHealthMetricKey, string> = {
  openForeshadowings: '未回收伏笔',
  foreshadowArrears: '伏笔欠账',
  orphanNodes: '孤立节点',
  staleKnowledge: '失效知识',
  ragHits: 'RAG 命中',
};

export interface MemoryHealthMetric {
  key: MemoryHealthMetricKey;
  label: string;
  /** null = 数据缺失（未知）；0 是真实数值。 */
  value: number | null;
  detail?: string;
  unknownReason?: string;
  /** 越过有代码依据的阈值时出现（当前仅「伏笔欠账 > MAX_ARREARS_IN_PROMPT」）。 */
  severity?: "warn";
  /** 阈值说明（越阈值时展示，供界面标注告警依据）。 */
  thresholdNote?: string;
}

export interface MemoryHealthEntityRef {
  type: MemoryHealthEntityType;
  id: string;
}

export interface MemoryHealthOrphanInput {
  entities: readonly MemoryHealthEntityRef[];
  relationships: readonly {
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
  }[];
}

export interface MemoryHealthInput {
  /** 未回收伏笔（planted / hinted）条数；null = 台账不可用。 */
  openForeshadowings: number | null;
  openForeshadowingsUnknownReason?: string;
  /** 伏笔欠账：埋设章序早于当前章且未回收；null = 台账不可用。 */
  foreshadowArrears: number | null;
  foreshadowArrearsUnknownReason?: string;
  /** 孤立节点（无任何关系边引用）个数；null = 图谱不可判定。 */
  orphanNodes: number | null;
  orphanNodesUnknownReason?: string;
  /** 失效知识：台账行与关系边的 stale 计数；任一为 null = 不可用。 */
  staleLedger: number | null;
  staleEdges: number | null;
  staleUnknownReason?: string;
  /** RAG 命中条数（最近一次按章检索）；null = 未索引或嵌入不可用。 */
  ragHits: number | null;
  ragUnknownReason?: string;
  ragDetail?: string;
}

/**
 * 孤立节点：在 `entity_relationships` 中既不是 source 也不是 target 的实体。
 * 输出按（实体类型序、id）稳定排序，便于断言与展示。
 */
export function computeOrphanEntityIds(input: MemoryHealthOrphanInput): MemoryHealthEntityRef[] {
  const referenced = new Set<string>();
  for (const rel of input.relationships) {
    referenced.add(`${rel.sourceType}:${rel.sourceId}`);
    referenced.add(`${rel.targetType}:${rel.targetId}`);
  }
  const typeOrder = new Map<string, number>(MEMORY_HEALTH_ENTITY_TYPES.map((type, index) => [type, index]));
  return input.entities
    .filter((entity) => entity.id.length > 0 && !referenced.has(`${entity.type}:${entity.id}`))
    .slice()
    .sort((a, b) => {
      const left = typeOrder.get(a.type) ?? Number.MAX_SAFE_INTEGER;
      const right = typeOrder.get(b.type) ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return a.id.localeCompare(b.id);
    });
}

/** 单项指标的缺失态（界面与测试共用同一构造，避免各处硬编码文案）。 */
export function memoryHealthUnknownMetric(
  key: MemoryHealthMetricKey,
  unknownReason: string
): MemoryHealthMetric {
  return { key, label: MEMORY_HEALTH_METRIC_LABELS[key], value: null, unknownReason };
}

/** 全部五项指标均为缺失态（请求失败 / 尚无数据时的界面回退）。 */
export function memoryHealthUnknownMetrics(unknownReason: string): MemoryHealthMetric[] {
  return MEMORY_HEALTH_METRIC_KEYS.map((key) => memoryHealthUnknownMetric(key, unknownReason));
}

/** 组装五项指标（顺序固定 = `MEMORY_HEALTH_METRIC_KEYS`）。 */
export function buildMemoryHealthMetrics(input: MemoryHealthInput): MemoryHealthMetric[] {
  const openMetric: MemoryHealthMetric =
    input.openForeshadowings === null
      ? memoryHealthUnknownMetric('openForeshadowings', input.openForeshadowingsUnknownReason ?? '暂无伏笔台账数据')
      : {
          key: 'openForeshadowings',
          label: MEMORY_HEALTH_METRIC_LABELS.openForeshadowings,
          value: input.openForeshadowings,
        };

  const arrearsMetric: MemoryHealthMetric =
    input.foreshadowArrears === null
      ? memoryHealthUnknownMetric('foreshadowArrears', input.foreshadowArrearsUnknownReason ?? '暂无伏笔台账数据')
      : {
          key: 'foreshadowArrears',
          label: MEMORY_HEALTH_METRIC_LABELS.foreshadowArrears,
          value: input.foreshadowArrears,
          ...(isForeshadowArrearsWarning(input.foreshadowArrears)
            ? {
                severity: 'warn' as const,
                thresholdNote: '超过核对清单注入预算（> ' + MAX_ARREARS_IN_PROMPT + ' 条）',
              }
            : {}),
        };

  const orphanMetric: MemoryHealthMetric =
    input.orphanNodes === null
      ? memoryHealthUnknownMetric('orphanNodes', input.orphanNodesUnknownReason ?? '图谱不可判定')
      : {
          key: 'orphanNodes',
          label: MEMORY_HEALTH_METRIC_LABELS.orphanNodes,
          value: input.orphanNodes,
        };

  const staleAvailable = input.staleLedger !== null && input.staleEdges !== null;
  const staleMetric: MemoryHealthMetric = staleAvailable
    ? {
        key: 'staleKnowledge',
        label: MEMORY_HEALTH_METRIC_LABELS.staleKnowledge,
        value: (input.staleLedger ?? 0) + (input.staleEdges ?? 0),
        detail: `台账 ${input.staleLedger} · 关系边 ${input.staleEdges}`,
      }
    : memoryHealthUnknownMetric('staleKnowledge', input.staleUnknownReason ?? '暂无失效标记数据');

  const ragMetric: MemoryHealthMetric =
    input.ragHits === null
      ? memoryHealthUnknownMetric('ragHits', input.ragUnknownReason ?? '尚无检索结果')
      : {
          key: 'ragHits',
          label: MEMORY_HEALTH_METRIC_LABELS.ragHits,
          value: input.ragHits,
          ...(input.ragDetail ? { detail: input.ragDetail } : {}),
        };

  return [openMetric, arrearsMetric, orphanMetric, staleMetric, ragMetric];
}

/** 欠账告警：超过 critic 核对清单注入预算（单一阈值来源）。 */
export function isForeshadowArrearsWarning(arrears: number | null): boolean {
  return arrears !== null && arrears > MAX_ARREARS_IN_PROMPT;
}

/** 指标值展示文案：缺失 → 「未知」，否则数字的字符串形式。 */
export function memoryHealthValueLabel(metric: MemoryHealthMetric): string {
  return metric.value === null ? MEMORY_HEALTH_UNKNOWN_TEXT : String(metric.value);
}

export function memoryHealthMetricByKey(
  metrics: readonly MemoryHealthMetric[],
  key: MemoryHealthMetricKey
): MemoryHealthMetric | undefined {
  return metrics.find((metric) => metric.key === key);
}
