/**
 * 批次 C · 图谱能力卡（2026-09-26）：知识图谱能力卡的两张「工具卡」纯逻辑。
 *
 * 与写作规则卡（skill-card / technique）不同，工具卡不注入文本规则，
 * 而是在被装配（作品卡组 / 本章使用卡）或直接调用时触发一次服务端动作：
 * - `knowledge-extract`：跑知识谱系抽取（`runLineageEnrichment`），返回 coverage 数值；
 * - `foreshadow-settle`：读伏笔台账，给出「未回收伏笔」的核对清单。
 *
 * 本模块无 IO、前后端同源；执行入口在 `server/helpers/knowledge-capabilities.ts`。
 */
import type { CapabilityManifestEntry } from '../types/capability-manifest.js';

export const KNOWLEDGE_EXTRACT_CAPABILITY_ID = 'knowledge-extract';
export const FORESHADOW_SETTLE_CAPABILITY_ID = 'foreshadow-settle';
export const KNOWLEDGE_CAPABILITY_IDS = [
  KNOWLEDGE_EXTRACT_CAPABILITY_ID,
  FORESHADOW_SETTLE_CAPABILITY_ID,
] as const;
export type KnowledgeCapabilityId = (typeof KNOWLEDGE_CAPABILITY_IDS)[number];

export function isKnowledgeCapabilityId(id: string | null | undefined): id is KnowledgeCapabilityId {
  return (
    typeof id === 'string' && (KNOWLEDGE_CAPABILITY_IDS as readonly string[]).includes(id)
  );
}

/** 工具卡 kind：utility → role transform、diagnostic → role diagnostic（见 capability-card-role）。 */
export const TOOL_CAPABILITY_KINDS = ['utility', 'diagnostic'] as const;
export const TOOL_CAPABILITY_ACTIONS = ['run-utility', 'run-diagnostic'] as const;

/** 可运行的工具卡判定：运行类动作 + runtimeStatus active。 */
export function isRunnableToolManifest(
  manifest:
    | Pick<CapabilityManifestEntry, 'kind' | 'action' | 'runtimeStatus'>
    | null
    | undefined
): boolean {
  if (!manifest) return false;
  return (
    (TOOL_CAPABILITY_KINDS as readonly string[]).includes(manifest.kind) &&
    (TOOL_CAPABILITY_ACTIONS as readonly string[]).includes(manifest.action) &&
    manifest.runtimeStatus === 'active'
  );
}

/** 解析 `Ch012` / `Ch012_1` 形式的章节序号；无法解析返回 null（与 knowledge-lineage-enrich 同口径）。 */
export function chapterOrderOfId(chapterId: string | null | undefined): number | null {
  if (!chapterId) return null;
  const match = /^Ch(\d+)/i.exec(chapterId.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

export type ForeshadowSettlementStatus = 'planted' | 'hinted' | 'payoff';
export const FORESHADOW_OPEN_STATUSES = ['planted', 'hinted'] as const;

export interface ForeshadowSettlementRowInput {
  id: string;
  title: string;
  status: string;
  description?: string;
  notes?: string;
  plantedChapterId?: string;
  payoffChapterId?: string;
}

export interface ForeshadowSettlementEntry {
  id: string;
  title: string;
  status: ForeshadowSettlementStatus;
  description?: string;
  plantedChapterId?: string;
  plantedChapterNo?: number;
  plannedPayoffChapterId?: string;
  plannedPayoffChapterNo?: number;
  /** 埋点早于参考章仍未回收 → 属「欠账」，优先核对。 */
  arrears: boolean;
  /** 人类可读的建议动作。 */
  action: string;
}

export interface ForeshadowSettlementChecklist {
  /** 未回收伏笔（planted / hinted），欠账在前、埋设章序升序。 */
  entries: ForeshadowSettlementEntry[];
  arrears: number;
  openCount: number;
  settledCount: number;
  currentChapterOrder?: number;
  summary: string;
}

export interface ForeshadowSettlementInput {
  foreshadowings: readonly ForeshadowSettlementRowInput[];
  /** 参考章序（通常是作品当前最新章）；缺省取台账中最大埋设/回收章序。 */
  currentChapterOrder?: number | null;
}

function normalizeStatus(status: string): ForeshadowSettlementStatus {
  return status === 'payoff' || status === 'hinted' ? status : 'planted';
}

/**
 * 未回收伏笔核对清单（foreshadow-settle 的核心产出）。
 *
 * 判定沿用 `loadForeshadowingContext` 的既有口径：status !== 'payoff' 即未回收；
 * 「欠账」= 埋设章序早于参考章序且尚未回收（novel 级视图不排除「本章计划回收」）。
 * 纯函数：不读库、不产生副作用，输入决定输出（同输入两次调用结果 deepEqual）。
 */
export function buildForeshadowSettlementChecklist(
  input: ForeshadowSettlementInput
): ForeshadowSettlementChecklist {
  const rows = Array.isArray(input.foreshadowings) ? input.foreshadowings : [];
  const open = rows.filter((row) => normalizeStatus(row.status) !== 'payoff');
  const settledCount = rows.length - open.length;
  const explicitOrder =
    typeof input.currentChapterOrder === 'number' && Number.isFinite(input.currentChapterOrder)
      ? input.currentChapterOrder
      : undefined;
  const inferredOrder = rows.reduce<number | undefined>((max, row) => {
    const candidates = [chapterOrderOfId(row.plantedChapterId), chapterOrderOfId(row.payoffChapterId)];
    for (const value of candidates) {
      if (value === null) continue;
      max = max === undefined ? value : Math.max(max, value);
    }
    return max;
  }, undefined);
  const currentChapterOrder = explicitOrder ?? inferredOrder;

  const entries: ForeshadowSettlementEntry[] = open.map((row) => {
    const plantedChapterNo = chapterOrderOfId(row.plantedChapterId) ?? undefined;
    const plannedPayoffChapterNo = chapterOrderOfId(row.payoffChapterId) ?? undefined;
    const arrears =
      plantedChapterNo !== undefined &&
      currentChapterOrder !== undefined &&
      plantedChapterNo < currentChapterOrder;
    return {
      id: row.id,
      title: row.title,
      status: normalizeStatus(row.status),
      ...(row.description ? { description: row.description } : {}),
      ...(row.plantedChapterId ? { plantedChapterId: row.plantedChapterId } : {}),
      ...(plantedChapterNo !== undefined ? { plantedChapterNo } : {}),
      ...(row.payoffChapterId ? { plannedPayoffChapterId: row.payoffChapterId } : {}),
      ...(plannedPayoffChapterNo !== undefined ? { plannedPayoffChapterNo } : {}),
      arrears,
      action: arrears
        ? '仍未回收：安排回收章，或补记回收说明并更新伏笔状态'
        : '按计划推进：确认埋设是否已按本章落地',
    };
  });

  entries.sort((a, b) => {
    if (a.arrears !== b.arrears) return a.arrears ? -1 : 1;
    const left = a.plantedChapterNo ?? Number.MAX_SAFE_INTEGER;
    const right = b.plantedChapterNo ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return a.title.localeCompare(b.title);
  });

  const arrears = entries.filter((entry) => entry.arrears).length;
  const summary =
    open.length === 0
      ? `未回收 0 条 / 已回收 ${settledCount} 条`
      : `未回收 ${open.length} 条（其中欠账 ${arrears} 条）/ 已回收 ${settledCount} 条`;

  return {
    entries,
    arrears,
    openCount: open.length,
    settledCount,
    ...(currentChapterOrder !== undefined ? { currentChapterOrder } : {}),
    summary,
  };
}

/** coverage 的十个计数（与 server 侧 `LineageReport['coverage']` 结构一致）。 */
export interface LineageCoverage {
  characters: number;
  items: number;
  locations: number;
  factions: number;
  powerLevels: number;
  timelineEvents: number;
  foreshadowings: number;
  edges: number;
  /** 失效台账行数（章节删除等来源失效后打标，只增不删）。 */
  staleLedger: number;
  /** 失效关系边行数（来源版本失效后打标，只增不删）。 */
  staleEdges: number;
}

export type LineageCoverageField = keyof LineageCoverage;

export interface LineageCoverageFieldView {
  key: LineageCoverageField;
  label: string;
  /** narrative = 六项叙事元素（维护面板主区）；graph = 图谱规模与失效补充项（伏笔 / 关系边 / 失效台账 / 失效边）。 */
  group: 'narrative' | 'graph';
}

/** 界面主区固定展示的六项叙事元素（顺序即展示顺序）。 */
export const LINEAGE_NARRATIVE_COVERAGE_FIELDS: readonly LineageCoverageField[] = [
  'characters',
  'items',
  'locations',
  'factions',
  'powerLevels',
  'timelineEvents',
] as const;

export const LINEAGE_COVERAGE_FIELDS: readonly LineageCoverageFieldView[] = [
  { key: 'characters', label: '角色', group: 'narrative' },
  { key: 'items', label: '道具', group: 'narrative' },
  { key: 'locations', label: '地点', group: 'narrative' },
  { key: 'factions', label: '势力', group: 'narrative' },
  { key: 'powerLevels', label: '境界', group: 'narrative' },
  { key: 'timelineEvents', label: '时间线', group: 'narrative' },
  { key: 'foreshadowings', label: '伏笔', group: 'graph' },
  { key: 'edges', label: '关系边', group: 'graph' },
  { key: 'staleLedger', label: '失效台账', group: 'graph' },
  { key: 'staleEdges', label: '失效边', group: 'graph' },
];

export function lineageCoverageFieldsOf(
  group: LineageCoverageFieldView['group']
): readonly LineageCoverageFieldView[] {
  return LINEAGE_COVERAGE_FIELDS.filter((field) => field.group === group);
}

/** `runLineageEnrichment` 报告的结构镜像（server 侧 `LineageReport` 结构一致，前端只读数值）。 */
export interface LineageEnrichmentReport {
  xigangEntries: number;
  ledgerInserted: number;
  ledgerSkipped: number;
  ledgerBackfilled: number;
  powerEdgesAdded: number;
  relicEdgesAdded: number;
  affinityEdgesAdded: number;
  residenceEdgesAdded: number;
  relicUnmatched: string[];
  relationshipTypesNormalized: number;
  coverage: LineageCoverage;
}

export interface KnowledgeExtractResult {
  capabilityId: typeof KNOWLEDGE_EXTRACT_CAPABILITY_ID;
  kind: 'coverage';
  coverage: LineageEnrichmentReport;
}

export interface ForeshadowSettleResult {
  capabilityId: typeof FORESHADOW_SETTLE_CAPABILITY_ID;
  kind: 'checklist';
  checklist: ForeshadowSettlementChecklist;
}

export type KnowledgeCapabilityRunResult = KnowledgeExtractResult | ForeshadowSettleResult;

/** 无续写资料包时拒绝重跑（前置校验：明确错误 + 零写入）。 */
export const KNOWLEDGE_SOURCE_PACK_MISSING = 'KNOWLEDGE_SOURCE_PACK_MISSING';

/**
 * 能力运行结果 → 界面摘要（运行入口唯一文案源；纯函数，无 IO）。
 *
 * 口径与 `KnowledgeMaintenancePanel` 的覆盖率展示一致（区间：细纲/台账/图谱边/覆盖实体），
 * 但只输出一行摘要 —— 链路步骤里的运行入口不需要铺开十项计数。
 */
export function summarizeKnowledgeCapabilityResult(
  result: KnowledgeCapabilityRunResult
): string {
  if (result.kind === 'coverage') {
    const report = result.coverage;
    const edges =
      report.powerEdgesAdded +
      report.relicEdgesAdded +
      report.affinityEdgesAdded +
      report.residenceEdgesAdded;
    return `细纲条目 ${report.xigangEntries}；台账新增 ${report.ledgerInserted}；图谱边 +${edges}；覆盖角色 ${report.coverage.characters} / 道具 ${report.coverage.items} / 地点 ${report.coverage.locations}`;
  }
  return `${result.checklist.summary}；欠账 ${result.checklist.arrears} 条`;
}
