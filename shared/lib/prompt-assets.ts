import {
  DEFAULT_PROMPT_TEMPLATES,
  PROMPT_TEMPLATE_DEFINITIONS,
} from '../config/prompt-templates';
import type { PromptAsset, PromptOutputShape, PromptStage, PromptTemplateKey } from '../types';

export const PROMPT_STAGE_ORDER: PromptStage[] = [
  'discovery',
  'foundation',
  'planning',
  'drafting',
  'polish',
  'review',
];

const STAGE_BY_TEMPLATE: Record<PromptTemplateKey, PromptStage> = {
  inspirationSystem: 'discovery',
  storyCards: 'discovery',
  setupTaskRefine: 'foundation',
  editorAgent: 'planning',
  manualAudit: 'polish',
  orchestrateWriter: 'drafting',
  orchestrateCritic: 'review',
  extractSkill: 'review',
  generateOutline: 'planning',
};

const OUTPUT_SHAPE_BY_TEMPLATE: Record<PromptTemplateKey, PromptOutputShape> = {
  inspirationSystem: 'plain-text',
  storyCards: 'json',
  setupTaskRefine: 'plain-text',
  editorAgent: 'markdown',
  manualAudit: 'json',
  orchestrateWriter: 'plain-text',
  orchestrateCritic: 'markdown',
  extractSkill: 'json',
  generateOutline: 'markdown',
};

const RISK_NOTES_BY_TEMPLATE: Record<PromptTemplateKey, string[]> = {
  inspirationSystem: ['避免把方向建议提前写成完整正文。'],
  storyCards: ['方向卡必须显式回应篇幅、节奏与重心，否则骨架会发虚。'],
  setupTaskRefine: ['设定细化要补动机和限制，不能只堆名词。'],
  editorAgent: ['分镜要落到可执行动作，不能停留在抽象剧情概括。'],
  manualAudit: ['审计结果必须优先指出可读性硬伤，不能泛泛而谈。'],
  orchestrateWriter: ['正文必须兑现分镜与关键道具，避免生成碎片化段落。'],
  orchestrateCritic: ['内审要给出可重写建议，不能只做情绪化评价。'],
  extractSkill: ['拆书结果要保持单卡单目标，避免一张卡同时承担过多互相打架的写作任务。'],
  generateOutline: ['大纲需要覆盖篇幅分配与情节弧线，不能只列概念。'],
};

const SUCCESS_SIGNAL_BY_TEMPLATE: Record<PromptTemplateKey, string> = {
  inspirationSystem: '用户能快速收敛当前想写的方向，而不是被更多选项打散。',
  storyCards: '三张方向卡都能支撑后续设定与篇幅规划。',
  setupTaskRefine: '输出可直接写入设定记忆，并补足限制与后果。',
  editorAgent: '每个场景都有明确入场、冲突、动作链和退场钩子。',
  manualAudit: '审计 JSON 能直接指导修稿，且问题优先级清晰。',
  orchestrateWriter: '正文像可继续迭代的章节初稿，而不是提纲扩写残片。',
  orchestrateCritic: '评审能明确判断是否可进入下一轮，并指出致命问题。',
  extractSkill: '拆出的能力卡要能直接指导写作，而不是泛化描述。',
  generateOutline: '大纲给出清晰卷轴结构、字数分配和节奏推进。',
};

export function buildPromptAssetMap(): PromptAsset[] {
  return PROMPT_TEMPLATE_DEFINITIONS.map((definition) => ({
    id: definition.key,
    title: definition.label,
    stage: STAGE_BY_TEMPLATE[definition.key],
    goal: definition.description,
    inputs: definition.variables,
    template: DEFAULT_PROMPT_TEMPLATES[definition.key],
    outputShape: OUTPUT_SHAPE_BY_TEMPLATE[definition.key],
    riskNotes: RISK_NOTES_BY_TEMPLATE[definition.key],
    successSignal: SUCCESS_SIGNAL_BY_TEMPLATE[definition.key],
  }));
}

export function getPromptAssetsByStage(
  assets: PromptAsset[],
  stage: PromptStage,
): PromptAsset[] {
  return assets.filter((asset) => asset.stage === stage);
}
