import type { CopilotReasons, CopilotStage, CopilotSuggestion } from '../types';

export interface CopilotInput {
  hasCurrentChapter: boolean;
  hasSummary: boolean;
  hasGlobalOutline: boolean;
  hasWorldRules: boolean;
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
    | 'pacing';
}

export function deriveCopilotStage(input: CopilotInput): CopilotStage {
  if (!input.hasSummary || !input.hasGlobalOutline || !input.hasWorldRules) {
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

  if (input.hasSummary) ready.push('summary');
  else missing.push('summary');
  if (input.hasGlobalOutline) ready.push('global outline');
  else missing.push('global outline');
  if (input.hasWorldRules) ready.push('world rules');
  else missing.push('world rules');
  if (input.hasCurrentChapter) ready.push('current chapter');
  else missing.push('current chapter');
  if (input.hasSceneBeats) ready.push('scene beats');
  else if (input.hasCurrentChapter) missing.push('scene beats');
  if (input.hasChapterContent) ready.push('chapter draft');
  if (input.hasCritique) ready.push('audit critique');
  if (input.mountedSkillCount > 0) ready.push(`${input.mountedSkillCount} mounted skills`);
  else risks.push('no mounted skills');
  if (input.fitScore < 60) risks.push('low fit score');
  if (input.hasSniffedNewEntities) risks.push('new entities not synced');

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
          { key: 'open-skills', label: '查看技能挂载' },
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
        summary: '当前章节还没有稳定的 scene beats，直接扩写容易发散。',
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
          { key: 'open-skills', label: '调整技能' },
        ],
        reasons,
      };
    case 'pending-audit':
      return {
        stage,
        stageLabel: '待审计',
        title: '先做 AI 审计',
        summary: '当前章节已有正文，但还没有经过一致性和节奏检查。',
        primaryAction: { key: 'run-audit', label: '开始审计' },
        secondaryActions: [
          { key: 'open-quality', label: '打开质量面板' },
          { key: 'open-skills', label: '查看技能挂载' },
        ],
        reasons,
      };
    case 'pending-polish':
    default:
      return {
        stage: 'pending-polish',
        stageLabel: '待精修',
        title: '按审计结果精修',
        summary: '这一章已经有审计结果，先处理高价值问题再继续写。',
        primaryAction: { key: 'run-polish', label: '按审计精修' },
        secondaryActions: [
          { key: 'open-quality', label: '查看审计问题' },
          { key: 'open-planning', label: '回看分镜' },
        ],
        reasons,
      };
  }
}
