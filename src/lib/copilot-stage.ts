import type { CopilotReasons, CopilotStage, CopilotSuggestion } from '../../shared/types';

export interface CopilotInput {
  hasCurrentChapter: boolean;
  hasSummary: boolean;
  hasGlobalOutline: boolean;
  hasWorldRules: boolean;
  hasContinuationPackContext: boolean;
  hasSceneBeats: boolean;
  hasChapterContent: boolean;
  hasCritique: boolean;
  hasSniffedNewEntities: boolean;
  mountedSkillCount: number;
  fitScore: number;
  lastFocusArea:
    | 'editor'
    | 'production'
    | 'outline'
    | 'planning'
    | 'quality'
    | 'trace'
    | 'bible'
    | 'skills'
    | 'versions'
    | 'ideas'
    | 'foreshadowing'
    | 'pacing'
    | 'context';
}

export function deriveCopilotStage(input: CopilotInput): CopilotStage {
  const hasStoryFrame = input.hasContinuationPackContext || (
    input.hasSummary &&
    input.hasGlobalOutline &&
    input.hasWorldRules
  );
  if (!hasStoryFrame) {
    return 'missing-setup';
  }
  if (input.hasSniffedNewEntities) {
    return 'needs-memory-sync';
  }
  if (!input.hasCurrentChapter || !input.hasSceneBeats) {
    return 'missing-beats';
  }
  if (!input.hasChapterContent) {
    return 'ready-to-draft';
  }
  if (!input.hasCritique) {
    return 'pending-audit';
  }
  return 'pending-polish';
}

function buildReasons(input: CopilotInput): CopilotReasons {
  const ready: string[] = [];
  const missing: string[] = [];
  const risks: string[] = [];

  if (input.hasContinuationPackContext) ready.push('续写资料包上下文');
  if (input.hasSummary) ready.push('故事简介');
  else if (!input.hasContinuationPackContext) missing.push('故事简介');
  if (input.hasGlobalOutline) ready.push('全局大纲');
  else if (!input.hasContinuationPackContext) missing.push('全局大纲');
  if (input.hasWorldRules) ready.push('世界规则');
  else if (!input.hasContinuationPackContext) missing.push('世界规则');
  if (input.hasCurrentChapter) ready.push('当前章节');
  else missing.push('当前章节');
  if (input.hasSceneBeats) ready.push('本章分镜');
  else if (input.hasCurrentChapter) missing.push('本章分镜');
  if (input.hasChapterContent) ready.push('章节正文');
  if (input.hasCritique) ready.push('审稿意见');
  if (input.mountedSkillCount > 0) ready.push(`作品默认能力卡 ${input.mountedSkillCount} 张`);
  else risks.push('尚未配置作品默认能力卡');
  if (input.fitScore < 60) risks.push('能力匹配偏低');
  if (input.hasSniffedNewEntities) risks.push('新实体未同步');

  return { ready, missing, risks };
}

export function buildCopilotSuggestion(input: CopilotInput): CopilotSuggestion {
  const stage = deriveCopilotStage(input);
  const reasons = buildReasons(input);

  switch (stage) {
    case 'missing-setup':
      return {
        stage,
        stageLabel: '骨架未稳',
        title: '先补全故事骨架',
        summary: '当前缺少 summary、全局大纲或世界规则，继续写容易跑偏。',
        primaryAction: { key: 'fill-setup', label: '先补设定' },
        secondaryActions: [
          { key: 'open-bible', label: '打开记忆库' },
          { key: 'open-skills', label: '查看能力配置' },
        ],
        reasons,
      };
    case 'needs-memory-sync':
      return {
        stage,
        stageLabel: '记忆待同步',
        title: '先同步新设定',
        summary: '当前章节已经出现未入库实体，先同步记忆库更稳。',
        primaryAction: { key: 'sync-memory', label: '同步设定' },
        secondaryActions: [
          { key: 'open-bible', label: '打开记忆库' },
          { key: 'open-quality', label: '查看质量面板' },
        ],
        reasons,
      };
    case 'missing-beats':
      return {
        stage,
        stageLabel: '缺少分镜',
        title: '先生成场景分镜',
        summary: '当前章节还没有稳定的本章分镜，直接扩写容易发散。',
        primaryAction: { key: 'generate-beats', label: '生成分镜' },
        secondaryActions: [
          { key: 'open-planning', label: '打开分镜' },
          { key: 'fill-setup', label: '先补设定' },
        ],
        reasons,
      };
    case 'ready-to-draft':
      return {
        stage,
        stageLabel: '可生成正文',
        title: '先扩写正文',
        summary: '分镜已经具备，下一步最值当的是生成章节正文。',
        primaryAction: { key: 'generate-draft', label: '扩写正文' },
        secondaryActions: [
          { key: 'open-planning', label: '查看分镜' },
          { key: 'open-skills', label: '调整能力配置' },
        ],
        reasons,
      };
    case 'pending-audit':
      return {
        stage,
        stageLabel: '待审稿',
        title: '先审这一章',
        summary: '当前章节已有正文，但还没有经过一致性和节奏检查。建议立即启动审稿人审计。',
        primaryAction: { key: 'run-audit', label: '开始审稿' },
        secondaryActions: [
          { key: 'open-quality', label: '打开审稿面板' },
          { key: 'open-skills', label: '查看能力配置' },
        ],
        reasons,
      };
    case 'pending-polish':
    default:
      return {
        stage: 'pending-polish',
        stageLabel: '待精修',
        title: '按审稿做局部精修',
        summary: '审稿意见发现去 AI 味、动作链缺失、对白突兀等高价值问题，推荐执行局部手术式精修。',
        primaryAction: { key: 'run-polish', label: '局部手术精修' },
        secondaryActions: [
          { key: 'open-quality', label: '查看审稿意见' },
          { key: 'open-planning', label: '回看分镜' },
        ],
        reasons,
      };
  }
}
