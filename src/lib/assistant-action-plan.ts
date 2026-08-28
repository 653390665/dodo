import type { AssistantActionIntent, AssistantActionPlan } from '../../shared/types';

export interface AssistantQuickAction {
  intent: Exclude<AssistantActionIntent, 'start-creation'>;
  label: string;
  prompt: string;
}

const ACTIONS: Record<AssistantActionIntent, Omit<AssistantActionPlan, 'intent' | 'userRequest' | 'novelId' | 'chapterId'>> = {
  'draft-prose': { label: '创作当前章节', scope: 'chapter', executionMode: 'single-run', outputArtifact: 'chapter-prose-candidate', recommendedCapabilityId: 'prose-mouth-flavor', requiresReview: true },
  'plan-scene': { label: '规划本章分镜', scope: 'chapter', executionMode: 'single-run', outputArtifact: 'scene-beat-candidate', recommendedCapabilityId: 'opening-gold-three', requiresReview: true },
  'build-setting': { label: '完善作品设定', scope: 'project', executionMode: 'single-run', outputArtifact: 'world-candidate', recommendedCapabilityId: 'bible-world-builder', requiresReview: true },
  'plan-structure': { label: '规划故事结构', scope: 'project', executionMode: 'single-run', outputArtifact: 'outline-candidate', recommendedCapabilityId: 'opening-gold-three', requiresReview: true },
  'save-fragment': { label: '整理灵感碎片', scope: 'project', executionMode: 'memory', outputArtifact: 'idea-fragment', requiresReview: false },
  'start-creation': { label: '开始完整创作', scope: 'project', executionMode: 'workflow', outputArtifact: 'creation-flow', recommendedCapabilityId: 'generic-novel-flow', requiresReview: false },
};

const PROMPTS: Record<AssistantQuickAction['intent'], string> = {
  'draft-prose': '基于当前章节，给我一段可编辑的正文候选。',
  'plan-scene': '基于当前章节目标，给我 3 条下一步场景分镜。',
  'build-setting': '只围绕当前卡点，补一条最关键的设定，不要发散。',
  'plan-structure': '基于当前作品目标，给出下一步最关键的结构候选。',
  'save-fragment': '把我现在的想法整理成一条可回收的灵感碎片。',
};

export function buildAssistantActionPlan(
  intent: AssistantActionIntent,
  userRequest: string,
  context: { novelId?: string; chapterId?: string } = {},
): AssistantActionPlan {
  return { intent, userRequest, ...context, ...ACTIONS[intent] };
}

export function getAssistantQuickActions(context: { hasNovel: boolean; hasChapter: boolean }): AssistantQuickAction[] {
  const intents: AssistantQuickAction['intent'][] = context.hasChapter
    ? ['draft-prose', 'plan-scene', 'build-setting', 'save-fragment']
    : ['build-setting', 'plan-structure', 'save-fragment'];
  return intents.map((intent) => ({ intent, label: ACTIONS[intent].label, prompt: PROMPTS[intent] }));
}
