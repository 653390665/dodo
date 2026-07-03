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
    foreshadowingUpdates: [],
    timelineEventsToCreate: [],
    foreshadowingsToCreate: [],
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
      };
    })
    .filter((entry) => entry.characterId && entry.summaryAppend);

  normalizedPatch.itemUpdates = asArray(patch.itemUpdates)
    .map((item) => {
      const entry = asRecord(item);
      return {
        itemId: stringValue(entry.itemId).trim(),
        descriptionAppend: stringValue(entry.descriptionAppend).trim(),
      };
    })
    .filter((entry) => entry.itemId && entry.descriptionAppend);

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
      };
    })
    .filter((event) => event.title && event.description);

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
    '6. 已埋伏笔是否被遗忘，或是否出现新的可记录伏笔。',
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
    '      { "characterId": "已有角色ID", "summaryAppend": "需要追加到角色摘要的状态变化" }',
    '    ],',
    '    "itemUpdates": [',
    '      { "itemId": "已有道具ID", "descriptionAppend": "需要追加到道具描述的状态变化" }',
    '    ],',
    '    "foreshadowingUpdates": [',
    '      { "foreshadowingId": "已有伏笔ID", "status": "planted" | "hinted" | "payoff", "notesAppend": "需要追加的伏笔说明" }',
    '    ],',
    '    "timelineEventsToCreate": [',
    '      { "title": "事件标题", "timestamp": "相对或绝对时间", "description": "事件描述", "statusTag": "已发生" }',
    '    ],',
    '    "foreshadowingsToCreate": [',
    '      { "title": "新伏笔标题", "description": "伏笔描述", "status": "planted", "plantedChapterId": "" }',
    '    ]',
    '  }',
    '}',
  ].join('\n');
}
