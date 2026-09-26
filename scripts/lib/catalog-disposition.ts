/**
 * Plan 262 B3：目录滞留清账 —— 每张治理资产都必须有明确去向。
 *
 * 背景（2026-09-28 实测）：179 张 runtime 目录资产只有 132 张上架公开目录；`admitPublicAsset`
 * 拒绝 6 张；41 张通过准入却不在公开目录；`needs-sanitization` 46 张中 33 张产出消毒副本、
 * 13 张永不产副本。这些「滞留」此前只以散落数字存在，没有逐张去向，无法判断是漏做还是有意为之。
 *
 * 本模块给出唯一去向判定（纯函数，无 IO）：
 * - `public`：已在公开目录（runtime-ready + 白标）；
 * - `sanitized-copy`：公开以 `sanitized-<id>` 副本形态存在（源卡本身按设计不上架）；
 * - `duplicate-absorbed`：与同键卡重复（换皮重投），保留得分更高/标题更短者，本卡被吸收；
 * - `declared-internal`：明确不公开，理由必须可复算（垃圾标题 / 渲染空标题 / 测试夹具）；
 * - `unclassified`：无去向 —— 既未上架、无副本、也未被声明为不公开（**必须为 0**）。
 *
 * 判定顺序：public → sanitized-copy → duplicate-absorbed → declared-internal → unclassified。
 */

import {
  PROMPT_GOVERNANCE_CATALOG,
} from '../../shared/lib/prompt-governance-catalog.js';
import {
  PUBLIC_SKILL_GOVERNANCE_CATALOG,
  SANITIZED_SKILL_COPIES,
} from '../../shared/lib/public-skill-catalog.js';
import type { GovernedPromptAsset } from '../../shared/types/prompt-assets-governed.js';
import {
  admitPublicAsset,
  collectSanitizeCandidates,
  normalizedTitleKey,
  renderPathTitleCollapsesToEmpty,
} from './public-catalog-pipeline.js';

export type CatalogDispositionKind =
  | 'public'
  | 'sanitized-copy'
  | 'duplicate-absorbed'
  | 'declared-internal'
  | 'unclassified';

export interface CatalogDisposition {
  readonly id: string;
  readonly kind: CatalogDispositionKind;
  readonly reason: string;
  /** 重复吸收时指向保留的那张卡。 */
  readonly coveredBy?: string;
}

export interface CatalogDispositionReport {
  readonly entries: CatalogDisposition[];
  readonly counts: Record<CatalogDispositionKind, number>;
  /** 无去向的滞留资产（必须为空数组）。 */
  readonly stranded: CatalogDisposition[];
}

const KIND_ORDER: CatalogDispositionKind[] = [
  'public',
  'sanitized-copy',
  'duplicate-absorbed',
  'declared-internal',
  'unclassified',
];

function isTestFixture(asset: GovernedPromptAsset): boolean {
  return asset.sourceGroup === 'test-fixture' || asset.evidenceLevel === 'test-fixture';
}

/** 逐张判定去向；同一张卡只落入一个去向。 */
export function describeCatalogDispositions(
  catalog: GovernedPromptAsset[] = PROMPT_GOVERNANCE_CATALOG
): CatalogDispositionReport {
  const publicIds = new Set(PUBLIC_SKILL_GOVERNANCE_CATALOG.map((asset) => asset.id));
  const copySourceIds = new Set(
    SANITIZED_SKILL_COPIES.map((copy) => copy.id.replace(/^sanitized-/, ''))
  );
  const collected = collectSanitizeCandidates();
  const dedupedIds = new Set(collected.deduped);
  const candidateByKey = new Map(
    collected.candidates.map((asset) => [normalizedTitleKey(asset.title), asset.id])
  );

  const entries: CatalogDisposition[] = catalog.map((asset) => {
    if (publicIds.has(asset.id)) {
      return { id: asset.id, kind: 'public', reason: '已上架公开目录（runtime-ready + 白标）' };
    }
    if (copySourceIds.has(asset.id)) {
      return {
        id: asset.id,
        kind: 'sanitized-copy',
        reason: `公开以消毒副本形态存在（sanitized-${asset.id}）`,
      };
    }
    if (dedupedIds.has(asset.id)) {
      const coveredBy = candidateByKey.get(normalizedTitleKey(asset.title));
      return {
        id: asset.id,
        kind: 'duplicate-absorbed',
        reason: coveredBy
          ? `与 ${coveredBy} 同键（换皮重投），保留得分更高者`
          : '与同键卡重复，本卡被吸收',
        coveredBy,
      };
    }
    if (isTestFixture(asset)) {
      return {
        id: asset.id,
        kind: 'declared-internal',
        reason: '测试夹具（sourceGroup/evidenceLevel = test-fixture），不参与公开与副本',
      };
    }
    if (renderPathTitleCollapsesToEmpty((asset.title || '').trim())) {
      return {
        id: asset.id,
        kind: 'declared-internal',
        reason: '渲染路径标题被品牌剥除后为空（上架即空标题卡），源头不入册',
      };
    }
    if (!admitPublicAsset(asset)) {
      return {
        id: asset.id,
        kind: 'declared-internal',
        reason: `标题命中垃圾卡准入规则（测试/内测语料），明确不公开：${asset.title}`,
      };
    }
    return {
      id: asset.id,
      kind: 'unclassified',
      reason: '无去向：既未上架、无消毒副本、也未被声明为不公开（需补副本或补登记）',
    };
  });

  const counts = KIND_ORDER.reduce(
    (acc, kind) => ({ ...acc, [kind]: entries.filter((entry) => entry.kind === kind).length }),
    {} as Record<CatalogDispositionKind, number>
  );

  return { entries, counts, stranded: entries.filter((entry) => entry.kind === 'unclassified') };
}

/** 人读摘要：去向分布 + 滞留清单（滞留为空时给 PASS 行）。 */
export function formatCatalogDispositionReport(report: CatalogDispositionReport): string[] {
  const lines = [
    `目录去向：total ${report.entries.length} ｜ public ${report.counts.public} ｜ sanitized-copy ${report.counts['sanitized-copy']} ｜ duplicate-absorbed ${report.counts['duplicate-absorbed']} ｜ declared-internal ${report.counts['declared-internal']} ｜ unclassified ${report.counts.unclassified}`,
  ];
  for (const entry of report.entries) {
    if (entry.kind === 'declared-internal' || entry.kind === 'unclassified') {
      lines.push(`  [${entry.kind}] ${entry.id}：${entry.reason}`);
    }
  }
  lines.push(
    report.stranded.length === 0
      ? 'PASS：无滞留资产（每张卡都有明确去向）'
      : `FAIL：${report.stranded.length} 张资产管理无去向`
  );
  return lines;
}
