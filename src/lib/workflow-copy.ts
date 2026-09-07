/**
 * 007 T4 动作词表：跨表面统一"下一步动作"的动词文案。
 *
 * 规则：同一动作无论出现在横幅、工作台还是状态条，都用同一个词。
 * 新增动作先在这里登记，再在各表面引用；存量旧文案渐进替换。
 */
export const WORKFLOW_ACTION_LABELS = {
  /** 生成本章正文（快速或完整生产的正文段） */
  drafting: '生成本章正文',
  /** 运行完成审查/质量报告 */
  audit: '开始 AI 审计',
  /** 生成分镜 */
  plan: '生成分镜',
  /** 接受候选写入章节 */
  accept: '接受并写入',
  /** 打开工作台质量页签处理问题 */
  handleInWorkbench: '到工作台处理',
} as const;

export type WorkflowActionKey = keyof typeof WORKFLOW_ACTION_LABELS;
