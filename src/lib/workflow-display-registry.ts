import type { WorkflowAction, WorkflowPhase } from './workflow-state';

export interface WorkflowDisplay {
  stage: string;
  primaryAction: string;
  targetView: 'welcome' | 'world' | 'factory' | 'editor';
}

const REGISTRY: Record<WorkflowPhase, WorkflowDisplay> = {
  import: { stage: '资料准备', primaryAction: '查看资料', targetView: 'world' },
  review: { stage: '资料审核', primaryAction: '审核资料包', targetView: 'world' },
  sync: { stage: '资料接入', primaryAction: '接入本章上下文', targetView: 'world' },
  planning: { stage: '分镜规划', primaryAction: '规划本章分镜', targetView: 'factory' },
  drafting: { stage: '正文起草', primaryAction: '生成本章正文', targetView: 'editor' },
  audit: { stage: '正文审阅', primaryAction: '审阅本章正文', targetView: 'editor' },
  polish: { stage: '局部精修', primaryAction: '按审阅意见精修', targetView: 'editor' },
  next_chapter: { stage: '下一章', primaryAction: '创建下一章', targetView: 'editor' },
};

const ACTION_REGISTRY: Record<Exclude<WorkflowAction, WorkflowPhase>, WorkflowDisplay> = {
  resume: { stage: '正文编辑', primaryAction: '继续编辑', targetView: 'editor' },
  'generate-plan': { stage: '分镜规划', primaryAction: '规划本章分镜', targetView: 'factory' },
  'generate-prose': { stage: '正文起草', primaryAction: '生成本章正文', targetView: 'editor' },
  'complete-chapter': { stage: '章节完成', primaryAction: '完成本章', targetView: 'editor' },
  'resolve-issues': { stage: '问题处理', primaryAction: '处理审阅问题', targetView: 'editor' },
  'confirm-facts': { stage: '事实确认', primaryAction: '确认章节事实', targetView: 'editor' },
  'create-next-chapter': { stage: '下一章', primaryAction: '创建下一章', targetView: 'editor' },
};

export function getWorkflowDisplay(phase: WorkflowPhase | WorkflowAction): WorkflowDisplay {
  if (phase in REGISTRY) return REGISTRY[phase as WorkflowPhase];
  return ACTION_REGISTRY[phase as Exclude<WorkflowAction, WorkflowPhase>];
}
