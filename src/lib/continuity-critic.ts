import type {
  ContinuityIssue,
  ContinuityIssueCategory,
  ContinuityIssueSeverity,
  ContinuityReport,
  ProposedLedgerPatch,
  StoryStateLedger,
} from '../../shared/types';
import { summarizeStoryStateLedger } from './story-state-ledger';

const VALID_SEVERITIES: ContinuityIssueSeverity[] = ['low', 'medium', 'high'];
const VALID_CATEGORIES: ContinuityIssueCategory[] = [
  'character',
  'timeline',
  'item',
  'location',
  'power',
  'foreshadowing',
  'logic',
];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value != null ? String(value) : '';
}

function clampScore(score: unknown): number {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSeverity(value: unknown): ContinuityIssueSeverity {
  return VALID_SEVERITIES.includes(value as ContinuityIssueSeverity)
    ? (value as ContinuityIssueSeverity)
    : 'medium';
}

function normalizeCategory(value: unknown): ContinuityIssueCategory {
  return VALID_CATEGORIES.includes(value as ContinuityIssueCategory)
    ? (value as ContinuityIssueCategory)
    : 'logic';
}

function normalizeIssue(raw: unknown): ContinuityIssue {
  const obj = asRecord(raw);
  return {
    severity: normalizeSeverity(obj.severity),
    category: normalizeCategory(obj.category),
    message: stringValue(obj.message).trim() || '未提供问题描述',
    evidence: obj.evidence != null ? stringValue(obj.evidence) : undefined,
    suggestedFix:
      obj.suggestedFix
        ? stringValue(obj.suggestedFix)
        : obj.suggestion
          ? stringValue(obj.suggestion)
          : undefined,
  };
}

function emptyPatch(): ProposedLedgerPatch {
  return {
    characterUpdates: [],
    itemUpdates: [],
    locationUpdates: [],
    powerUpdates: [],
    foreshadowingUpdates: [],
    timelineEventsToCreate: [],
    foreshadowingsToCreate: [],
    narrativePromiseCandidates: [],
  };
}

export function normalizeContinuityReport(raw: unknown): ContinuityReport {
  const root = asRecord(raw);
  const patch = asRecord(root.proposedPatch);
  const normalizedPatch = emptyPatch();

  normalizedPatch.characterUpdates = asArray(patch.characterUpdates)
    .map((item) => {
      const entry = asRecord(item);
      return {
        characterId: stringValue(entry.characterId).trim(),
        summaryAppend: stringValue(entry.summaryAppend).trim(),
        evidenceQuote: stringValue(entry.evidenceQuote).trim() || undefined,
      };
    })
    .filter((entry) => entry.characterId && entry.summaryAppend && entry.evidenceQuote);

  normalizedPatch.itemUpdates = asArray(patch.itemUpdates)
    .map((item) => {
      const entry = asRecord(item);
      return {
        itemId: stringValue(entry.itemId).trim(),
        descriptionAppend: stringValue(entry.descriptionAppend).trim(),
        evidenceQuote: stringValue(entry.evidenceQuote).trim() || undefined,
      };
    })
    .filter((entry) => entry.itemId && entry.descriptionAppend && entry.evidenceQuote);

  normalizedPatch.locationUpdates = asArray(patch.locationUpdates)
    .map((item) => {
      const entry = asRecord(item);
      return {
        locationId: stringValue(entry.locationId).trim(),
        descriptionAppend: stringValue(entry.descriptionAppend).trim(),
        evidenceQuote: stringValue(entry.evidenceQuote).trim() || undefined,
      };
    })
    .filter((entry) => entry.locationId && entry.descriptionAppend && entry.evidenceQuote);

  normalizedPatch.powerUpdates = asArray(patch.powerUpdates)
    .map((item) => {
      const entry = asRecord(item);
      return {
        powerLevelId: stringValue(entry.powerLevelId).trim(),
        descriptionAppend: stringValue(entry.descriptionAppend).trim(),
        evidenceQuote: stringValue(entry.evidenceQuote).trim() || undefined,
      };
    })
    .filter((entry) => entry.powerLevelId && entry.descriptionAppend && entry.evidenceQuote);

  normalizedPatch.foreshadowingUpdates = asArray(patch.foreshadowingUpdates)
    .map((item) => {
      const entry = asRecord(item);
      const notesAppend = stringValue(entry.notesAppend || entry.notes).trim();
      const status = (entry.status === 'hinted' || entry.status === 'payoff' ? entry.status : 'planted') as 'planted' | 'hinted' | 'payoff';
      return {
        foreshadowingId: stringValue(entry.foreshadowingId || entry.id).trim(),
        status,
        notesAppend,
      };
    })
    .filter((entry) => entry.foreshadowingId && entry.notesAppend);

  normalizedPatch.timelineEventsToCreate = asArray(patch.timelineEventsToCreate)
    .map((item) => {
      const event = asRecord(item);
      return {
        title: stringValue(event.title).trim(),
        timestamp: stringValue(event.timestamp).trim(),
        description: stringValue(event.description).trim(),
        statusTag: stringValue(event.statusTag || '已发生').trim() || '已发生',
        evidenceQuote: stringValue(event.evidenceQuote).trim() || undefined,
      };
    })
    .filter((event) => event.title && event.description && event.evidenceQuote);

  normalizedPatch.foreshadowingsToCreate = asArray(patch.foreshadowingsToCreate)
    .map((item) => {
      const entry = asRecord(item);
      const status = (entry.status === 'hinted' || entry.status === 'payoff' ? entry.status : 'planted') as 'planted' | 'hinted' | 'payoff';
      return {
        title: stringValue(entry.title).trim(),
        description: stringValue(entry.description).trim(),
        status,
        plantedChapterId: entry.plantedChapterId ? stringValue(entry.plantedChapterId).trim() : undefined,
      };
    })
    .filter((entry) => entry.title && entry.description);

  normalizedPatch.narrativePromiseCandidates = asArray(patch.narrativePromiseCandidates)
    .map((item): NonNullable<ProposedLedgerPatch['narrativePromiseCandidates']>[number] | undefined => {
      const entry = asRecord(item);
      const targetType = entry.targetType === 'existing' || entry.targetType === 'discovered'
        ? entry.targetType
        : undefined;
      const action = entry.action === 'hint' || entry.action === 'payoff' ? entry.action : entry.action === 'plant' ? 'plant' : undefined;
      const foreshadowingId = stringValue(entry.foreshadowingId).trim() || undefined;
      const title = stringValue(entry.title).trim() || undefined;
      const description = stringValue(entry.description).trim() || undefined;
      const evidenceQuote = stringValue(entry.evidenceQuote || entry.quote).trim();
      if (!targetType || !action || !evidenceQuote) return undefined;
      if (targetType === 'existing' ? !foreshadowingId : !title || !description) return undefined;
      return {
        targetType,
        foreshadowingId,
        title,
        description,
        action,
        evidenceQuote,
        location: stringValue(entry.location).trim() || undefined,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return {
    score: clampScore(root.score),
    issues: asArray(root.issues).map(normalizeIssue),
    proposedPatch: normalizedPatch,
  };
}

export function extractContinuityReportJson(text: string): ContinuityReport {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? trimmed;
  const cleaned = source.trim();
  return normalizeContinuityReport(JSON.parse(cleaned));
}

export function buildContinuityCriticPrompt(input: {
  ledger: StoryStateLedger;
  sceneBeats: string;
  draftContent: string;
}): string {
  return [
    '你是 InkFlow 的长篇连续性审稿员，只检查长篇一致性，不评价文风。',
    '',
    '【故事状态账本】',
    summarizeStoryStateLedger(input.ledger),
    '',
    '【本章分镜】',
    input.sceneBeats.trim() || '无',
    '',
    '【本章草稿】',
    input.draftContent.trim() || '无',
    '',
    '请检查：',
    '1. 人物状态是否矛盾。',
    '2. 道具归属、唯一性、能力边界是否矛盾。',
    '3. 时间线是否矛盾。',
    '4. 地点移动是否缺少过渡。',
    '5. 力量体系是否越界。',
    '6. 当前相关叙事承诺是否被提示或兑现，或正文是否出现新的可记录承诺。计划不等于正文证据。',
    'locationUpdates、powerUpdates 与 narrativePromiseCandidates 必须提供 evidenceQuote，且必须逐字复制本章草稿中的连续原文，不得改写或依据分镜臆测。',
    '',
    '严格输出 JSON，不要输出 Markdown，不要添加解释文字。结构必须是：',
    '{',
    '  "score": 0到100的整数,',
    '  "issues": [',
    '    {',
    '      "severity": "low" | "medium" | "high",',
    '      "category": "character" | "timeline" | "item" | "location" | "power" | "foreshadowing" | "logic",',
    '      "message": "问题说明",',
    '      "evidence": "草稿中的证据",',
    '      "suggestedFix": "建议修复"',
    '    }',
    '  ],',
    '  "proposedPatch": {',
    '    "characterUpdates": [',
    '      { "characterId": "已有角色ID", "summaryAppend": "需要追加到角色摘要的状态变化", "evidenceQuote": "草稿中的逐字连续证据" }',
    '    ],',
    '    "itemUpdates": [',
    '      { "itemId": "已有道具ID", "descriptionAppend": "需要追加到道具描述的状态变化", "evidenceQuote": "草稿中的逐字连续证据" }',
    '    ],',
    '    "locationUpdates": [',
    '      { "locationId": "已有地点ID", "descriptionAppend": "需要追加到地点描述的状态变化", "evidenceQuote": "草稿中的逐字连续证据" }',
    '    ],',
    '    "powerUpdates": [',
    '      { "powerLevelId": "已有力量体系ID", "descriptionAppend": "需要追加到力量体系描述的状态变化", "evidenceQuote": "草稿中的逐字连续证据" }',
    '    ],',
    '    "narrativePromiseCandidates": [',
    '      { "targetType": "existing" | "discovered", "foreshadowingId": "已有伏笔ID，仅 existing", "title": "新承诺标题，仅 discovered", "description": "新承诺说明，仅 discovered", "action": "plant" | "hint" | "payoff", "evidenceQuote": "草稿中的逐字证据", "location": "可选的段落或场景位置" }',
    '    ],',
    '    "timelineEventsToCreate": [',
    '      { "title": "事件标题", "timestamp": "相对或绝对时间", "description": "事件描述", "statusTag": "已发生", "evidenceQuote": "草稿中的逐字连续证据" }',
    '    ],',
    '    "foreshadowingUpdates": [],',
    '    "foreshadowingsToCreate": []',
    '  }',
    '}',
  ].join('\n');
}
