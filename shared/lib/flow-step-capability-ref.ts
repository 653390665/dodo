/**
 * 步骤能力引用解析（批次 C「步骤引用图谱能力卡」第 4 条，Plan 262 C5）。
 *
 * 链路步骤（`SkillSeriesFlowStep.capabilityRef = { assetId }`）声明「本步可触发一次可执行工具卡动作」。
 * 与 `flow-step-card-slot.ts`（卡片正文进提示词）**语义相反**：能力引用不注入任何文本，只声明：
 * - 界面可在本步给出运行入口（作者点一下 = 一次确定性服务端动作，不是生成）；
 * - 执行回执/快照能标明「这一步跑过哪张能力卡」，让「图谱维护」在链路里可见；
 * - 工具卡正文不因本字段进入 planner/writer/critic 的写作规则文本。
 *
 * 判定与执行内核同源（`shared/lib/knowledge-capabilities.ts`）：
 * - 必须是有执行内核的知识能力卡（`KNOWLEDGE_CAPABILITY_IDS`，服务端 run 路由只实现这两张）；
 * - 必须是运行类工具卡（`isRunnableToolManifest`：kind utility/diagnostic + action run-* + runtimeStatus active）；
 * - 货架资产必须 runtime-ready 且正文不是引用壳；
 * - manifest.allowedScopes 必须含 `project`（步骤动作是作品级同步动作，非 single-run 生成）。
 *
 * 解析失败**不静默**：返回 null + 警告码，调用方回退「无能力引用」的旧行为（不阻断流程推进）。
 * 纯函数 + 可注入依赖（findAsset / findManifest / isRejectedTemplate），便于单测不触碰真实目录。
 */
import { isRuntimeReadyAsset } from './capability-runtime-readiness.js';
import { getCatalogCapabilityManifest } from './capability-manifest-catalog.js';
import { isKnowledgeCapabilityId, isRunnableToolManifest } from './knowledge-capabilities.js';
import { PROMPT_GOVERNANCE_CATALOG } from './prompt-governance-catalog.js';
import { isShellTemplatePrompt } from './prompt-shell.js';
import type { CapabilityManifestEntry } from '../types/capability-manifest.js';
import type {
  FlowStepCapabilityRef,
  FlowStepCapabilityResolution,
  GovernedPromptAsset,
} from '../types/prompt-assets-governed.js';

/** 执行面单源：作品级知识能力动作（服务端 server/routes/utilities.ts，客户端 src/lib/knowledge-client.ts）。 */
export const FLOW_STEP_CAPABILITY_ENDPOINT =
  '/api/novels/:novelId/knowledge-capabilities/:assetId/run';

export const FLOW_STEP_CAPABILITY_WARNINGS = [
  'FLOW_STEP_CAPABILITY_UNRESOLVED',
  'FLOW_STEP_CAPABILITY_NOT_RUNNABLE',
  'FLOW_STEP_CAPABILITY_NO_KERNEL',
  'FLOW_STEP_CAPABILITY_NOT_RUNTIME_READY',
  'FLOW_STEP_CAPABILITY_SHELL',
  'FLOW_STEP_CAPABILITY_SCOPE_INVALID',
] as const;
export type FlowStepCapabilityWarning = (typeof FLOW_STEP_CAPABILITY_WARNINGS)[number];

export interface FlowStepCapabilityDeps {
  /** 货架资产来源（PROMPT_GOVERNANCE_CATALOG）：正文可用性判定。 */
  findAsset?: (id: string) => GovernedPromptAsset | undefined;
  /** 能力清单来源（capability-manifest-catalog）：运行类工具卡判定。 */
  findManifest?: (id: string) => CapabilityManifestEntry | undefined;
  /** 壳卡判定（默认 isShellTemplatePrompt）。 */
  isRejectedTemplate?: (template: string | undefined) => boolean;
}

export interface FlowStepCapabilityAttempt {
  /** null = 本步无可用能力引用（旧行为）。 */
  readonly resolution: FlowStepCapabilityResolution | null;
  readonly warning?: FlowStepCapabilityWarning;
}

export interface FlowStepCapabilitySlotStep {
  readonly capabilityRef?: FlowStepCapabilityRef;
}

export function resolveFlowStepCapability(
  step: FlowStepCapabilitySlotStep,
  deps: FlowStepCapabilityDeps = {}
): FlowStepCapabilityAttempt {
  const ref = step.capabilityRef;
  if (!ref) return { resolution: null };
  const assetId = typeof ref.assetId === 'string' ? ref.assetId.trim() : '';
  if (!assetId) return { resolution: null, warning: 'FLOW_STEP_CAPABILITY_UNRESOLVED' };

  const findAsset =
    deps.findAsset ?? ((id: string) => PROMPT_GOVERNANCE_CATALOG.find((asset) => asset.id === id));
  const findManifest = deps.findManifest ?? ((id: string) => getCatalogCapabilityManifest(id));
  const isRejected = deps.isRejectedTemplate ?? isShellTemplatePrompt;

  const manifest = findManifest(assetId);
  if (!manifest) return { resolution: null, warning: 'FLOW_STEP_CAPABILITY_UNRESOLVED' };
  if (!isRunnableToolManifest(manifest)) {
    return { resolution: null, warning: 'FLOW_STEP_CAPABILITY_NOT_RUNNABLE' };
  }
  if (!isKnowledgeCapabilityId(assetId)) {
    // 运行类工具卡但服务端没有执行内核：宁可拒绝，也不给一个点了会 500 的按钮。
    return { resolution: null, warning: 'FLOW_STEP_CAPABILITY_NO_KERNEL' };
  }
  if (!manifest.allowedScopes?.includes('project')) {
    return { resolution: null, warning: 'FLOW_STEP_CAPABILITY_SCOPE_INVALID' };
  }

  const asset = findAsset(assetId);
  if (!asset) return { resolution: null, warning: 'FLOW_STEP_CAPABILITY_UNRESOLVED' };
  if (!isRuntimeReadyAsset(asset)) {
    return { resolution: null, warning: 'FLOW_STEP_CAPABILITY_NOT_RUNTIME_READY' };
  }
  if (isRejected(asset.template ?? '')) {
    return { resolution: null, warning: 'FLOW_STEP_CAPABILITY_SHELL' };
  }

  return {
    resolution: {
      assetId,
      title: asset.title,
      kind: manifest.kind as 'utility' | 'diagnostic',
      action: manifest.action as 'run-utility' | 'run-diagnostic',
      stages: [...(manifest.stages ?? [])],
      scope: 'project',
    },
  };
}
