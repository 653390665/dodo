import type { PromptAsset } from './core';
import type { CapabilityManifestEntry } from './capability-manifest';
import type { CapabilityStage } from './capability-execution';
import type { CardRole } from '../lib/capability-card-role.js';

/**
 * 提示词清洗状态 (Sanitization Status)
 * - raw: 原始、未经处理的提示词。
 * - needs-sanitization: 已授权，但包含敏感词或作者信息，急需白标安全清洗。
 * - sanitized: 已完成物理清除，且不带任何脱敏占位代称（如 [微信号]、***）。
 * - runtime-ready: 清洗且验证无误，可直接在运行时加载。
 */
export type SanitizationStatus = 'raw' | 'needs-sanitization' | 'sanitized' | 'runtime-ready';

/**
 * 提示词产品化放置等级 (Placement Tier)
 * - core-default: 核心默认内置质量护栏（如去 AI 腔、审稿）。
 * - agent-guided: 由 Agent 按需引导加载的辅助资产（如脑洞、取名、世界观）。
 * - optional-style: 用户可选的写作风格/流派/题材包。
 * - flow-default: 选定特定长篇流程后自动启用的资产。
 * - premium-enhancement: 高级诊断与定制编排资产。
 * - sanitize-required: 已获得授权但尚未清洗，禁止在产品中对用户可见。
 * - research-only: 质量不达标 或 无合法授权的纯研究资产。
 */
export type PlacementTier =
  | 'core-default'
  | 'agent-guided'
  | 'optional-style'
  | 'flow-default'
  | 'premium-enhancement'
  | 'sanitize-required'
  | 'research-only';

/**
 * 提示词资产大类归属分类 (Prompt Category V2)
 * - quality-guardrail: 通用质量护栏（底线防御，如去 AI 腔、净化废话）
 * - utility-tool: 功能工具（如对白润色、成语生花等局部增色功能）
 * - author-workflow: 作者流程（如黄金三章大纲、审稿人角色定制）
 * - constellation-pack: 题材包（如克苏鲁诡秘题材、高武玄幻题材包）
 * - platform-criteria: 平台维度（如番茄开局审核指标、七猫签约评分准则）
 * - style-reference: 风格参考（如实体写实风格、古风华丽风格参考）
 */
export type PromptCategoryV2 =
  | 'quality-guardrail'
  | 'utility-tool'
  | 'author-workflow'
  | 'constellation-pack'
  | 'platform-criteria'
  | 'style-reference';

/**
 * 推荐卡片可执行动作分类 (Prompt Asset Action Kind)
 */
export type PromptAssetActionKind =
  'audit-enhance' | 'polish-rewrite' | 'mount-skill' | 'open-flow-step' | 'deconstruction-card';

/**
 * 敏感词物理抹除清洗命中报告 (Sanitization Hits Report)
 */
export interface SanitizationHits {
  /** 敏感联系方式被删计数（如微信、QQ群、手机、邮箱等） */
  contacts: number;
  /** 作者或署名定制信息被删计数（如风华、沐殇、fire等） */
  authors: number;
  /** 竞品软件水印被删计数（如墨流等） */
  brands: number;
  /** 其他不可信或水印关键字被删计数 */
  watermarks: number;
}

/**
 * 统一治理提示词资产 (Governed Prompt Asset)
 * 基于基础 PromptAsset 扩展，具备分级、评分、授权和白标清洗状态追溯的能力。
 */
export interface GovernedPromptAsset extends Omit<PromptAsset, 'id'> {
  /** 唯一标识符，可包含内置键值或外部定制 UUID */
  id: string;

  /** 作者或贡献者标识 */
  author?: string;

  /** Plan 240 人工策展档位：featured=独立方法论 / standard=普通供给 / suspect-duplicate=疑似同质重复。仅供下架决策与治理查询，不影响排序与展示。 */
  curationTier?: 'featured' | 'standard' | 'suspect-duplicate';

  /** 关联的特定作者创作流 ID */
  authorFlowId?: string;

  /** 平台兼容性标签 */
  platformTags?: string[];

  /** 小说题材/风格标签 */
  genreTags?: string[];

  /** 适用任务标签 */
  taskTags?: string[];

  /** 预警及安全风险标签 */
  riskFlags?: string[];

  /** 授权合规状态 */
  licenseStatus: 'user-authorized' | 'public' | 'built-in' | 'unknown';

  /** 白标清洗状态 */
  sanitizationStatus: SanitizationStatus;

  /** 清洗命中统计 */
  sanitizationHits?: SanitizationHits;

  /**
   * 壳目录投影派生标记（Plan 262 B1）：公开壳目录会物理清空 `template`，
   * 故把「源正文是否为引用壳」的判定在生成期固化下来，供渲染层治理/审计复用。
   */
  isShellBody?: boolean;

  /** 资产大类分流判定: 审稿、去 AI 腔为内置(built-in); 流派题材包等为可选(optional) */
  promptCategory?: 'built-in' | 'optional';

  /** 运行时生命周期状态 */
  runtimeStatus: 'candidate' | 'direct-use-test' | 'active' | 'deprecated' | 'rejected';

  /** 产品化放置等级 */
  placementTier: PlacementTier;

  /** 提示词质量评分 (0 - 100) */
  score?: number;

  /** 治理分级 */
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';

  // --- V2 资产评分治理新增属性 ---
  /** 主归属分类 (Primary Category V2) */
  primaryCategory?: PromptCategoryV2;

  /** 次归属分类 (Secondary Category V2) */
  secondaryCategory?: PromptCategoryV2;

  /** 是否白标 (是否彻底完成物理清洗漂白) */
  isWhiteLabeled?: boolean;

  /** 是否可运行时动态直接使用 */
  isRuntimeReady?: boolean;

  /** 提示词资产来源方式: 购买授权、广场共享、官方内置 */
  sourceType?: 'licensed' | 'plaza' | 'built-in';

  // --- V2 路由与流程系列扩展属性 ---
  /** 治理处理结论 */
  processDecision?: 'adopt' | 'sanitize' | 'reject' | 'research-only';

  /** 关联流程系列 ID */
  seriesId?: string;

  /** 拆书卡特殊分类类型 */
  deconstructionCardType?:
    | 'worldview-card'
    | 'character-card'
    | 'pacing-card'
    | 'hook-card'
    | 'conflict-card'
    | 'style-card'
    | 'platform-card';

  // --- V2.1 来源可追溯与路由引擎升级新增属性 ---
  /** 来源文件、原始 ID、行号或章节名 */
  sourceRef?: string;

  /** 来源大组 */
  sourceGroup?:
    | 'built-in'
    | 'square'
    | 'private'
    | 'tool'
    | 'fanqie-supplement'
    | 'webnovel-writer'
    | 'test-fixture';

  /** 证据链置信等级 */
  evidenceLevel?:
    'scored-from-source' | 'summarized-source' | 'placeholder-for-import' | 'test-fixture';

  /** 推荐原因（由路由引擎动态组装） */
  recommendationReason?: string;
}

export interface InferenceOutput {
  targetPlatform?: string;
  genreTags: string[];
  activeSeriesId: string;
  commercialMode: 'free' | 'paid' | 'strict';
}

export interface EnhancementPackage {
  id: string;
  name: string;
  type: 'free' | 'paid';
  description: string;
  whyUpgrade?: string; // 为什么此时推荐升级说明
  assets?: string[]; // 关联的资产 ID 列表
  /** 兼容旧 assets 列表的可执行步骤配方。 */
  version?: string;
  intendedOutcome?: string;
  steps?: readonly EnhancementPackageStep[];
  prerequisites?: readonly string[];
  conflicts?: readonly string[];
}

export interface EnhancementPackageStep {
  readonly id: string;
  readonly assetId: string;
  readonly mode: 'configure' | 'schedule' | 'run-now' | 'recommend';
  readonly trigger: 'project-setup' | 'outline' | 'before-draft' | 'after-draft' | 'milestone';
  readonly scope: 'project' | 'volume' | 'chapter' | 'selection' | 'single-run';
  readonly order: number;
  readonly required: boolean;
  readonly dependsOn?: readonly string[];
  readonly name?: string;
  readonly intendedOutcome?: string;
  readonly prerequisites?: readonly string[];
  readonly conflicts?: readonly string[];
}

/** Plan-facing aliases; the original EnhancementPackage remains the compatibility shape. */
export type PackageStep = EnhancementPackageStep;
export type EnhancementPackageV2 = EnhancementPackage;

/**
 * 链路步骤的卡片槽位（批次 B「步骤卡片槽位」）。
 *
 * 语义：`stages` 声明「这张卡的正文进入哪些阶段的 prompt」；`role` 是声明角色
 * （投影校验用，见 shared/lib/flow-step-card-slot.ts）；`cardId` 缺省 = 槽位已声明但未挂卡
 * （合法状态，运行时回退 assetId 旧路径）。
 */
export interface FlowStepCardRef {
  readonly role: CardRole;
  readonly stages: readonly CapabilityStage[];
  readonly cardId?: string;
}

/**
 * 步骤质量门声明（批次 B「质量门判定与推进拦截」；批次 C「双门合一」收敛为唯一门槛字段）。
 *
 * 语义：`kind` 决定判定源 ——
 * - `mechanical` → shared 整章交付门 `validateCompleteChapterDraftQuality`
 *   （`threshold` 为最小有效字符数覆盖，按 [800, 4000] 夹取）；
 * - `critic`     → 服务端 critic 分类结果（`threshold` 为 0-100 分门槛，与服务端 `SCORE_THRESHOLD` 同口径）；
 * - `manual`     → 显式人工确认；
 * - `advisory`   → 只有人类可读的文本验收（`note`），**不拦截推进**（旧 `qualityGate` 文案的迁移落点）。
 *
 * `note` 是提示词 `【质量门】` 行与界面展示的唯一文案源（见 shared/lib/flow-step-gate.ts）；
 * **未声明本字段的步骤不做判定**（旧链路行为不变）。
 */
export type FlowStepGateKind = FlowStepGate['kind'];

export interface FlowStepGate {
  readonly kind: 'mechanical' | 'critic' | 'manual' | 'advisory';
  readonly threshold?: number;
  /** 人类可读验收文案（提示词与界面同源）。 */
  readonly note?: string;
}

/**
 * 步骤能力引用（Plan 262 C5「步骤引用图谱能力卡」）：本步可触发一次**可执行工具卡**动作。
 *
 * 与 `cardRef`（卡片正文进提示词）语义相反 —— 能力引用不注入任何文本，只声明：
 * 界面给出运行入口、执行回执标明本步跑过哪张能力卡。判定与执行内核见
 * shared/lib/flow-step-capability-ref.ts（kind utility/diagnostic + action run-* + active + project 作用域）。
 */
export interface FlowStepCapabilityRef {
  readonly assetId: string;
}

/** 能力引用解析结果（快照 / 界面展示用；缺失即 null + 诊断码）。 */
export interface FlowStepCapabilityResolution {
  readonly assetId: string;
  /** 货架标题（界面「本步可执行能力：<title>」）。 */
  readonly title: string;
  readonly kind: 'utility' | 'diagnostic';
  readonly action: 'run-utility' | 'run-diagnostic';
  /** 能力清单声明阶段（仅供展示/诊断，不参与提示词注入）。 */
  readonly stages: readonly CapabilityStage[];
  /** 动作作用域（当前仅 project：作品级同步动作）。 */
  readonly scope: 'project';
}

export interface SkillSeriesFlowStep {
  id: string; // 步骤唯一物理 ID (如 'xiaofeiji-novel-flow-step1')
  stepNumber: number; // 序号 (1-based)
  name: string; // 步骤展示名称 (如 '脑洞灵感闪耀')
  description: string; // 步骤具体执行说明
  input: string; // 阶段输入特征
  output: string; // 阶段输出特征
  /**
   * 本步目标阶段声明（批次 B「步骤阶段语义化」）：规划/大纲类 → planner，正文类 → writer，
   * 审稿/诊断类 → critic（语义表见 shared/lib/flow-step-stage.ts）。
   *
   * **声明优先**：不再继承关联资产的 `stage`（此前 30 步里 25 步因资产是 polish 而错落 writer）。
   * 缺省时回退资产 stage 并记 `FLOW_STEP_STAGE_UNDECLARED`（诊断可见，不静默丢 prompt）。
   */
  stage?: CapabilityStage;
  assetId: string; // 关联的真实治理资产 ID
  /** 步骤卡片槽位：优先于 assetId 解析（缺省 → 回退 assetId 旧路径，行为不变）。 */
  cardRef?: FlowStepCardRef;
  /**
   * 步骤能力引用（Plan 262 C5）：声明本步关联的**可执行工具卡**（knowledge-extract / foreshadow-settle 一类）。
   * 不注入提示词：工具卡正文不因本字段进入 planner/writer/critic 的写作规则文本。
   */
  capabilityRef?: FlowStepCapabilityRef;
  /**
   * 质量门声明（批次 C「双门合一」唯一门槛字段）：`advisory` = 文本验收不拦截，
   * `mechanical`/`critic`/`manual` = 可判定门。旧 `qualityGate: string` 字段已删除，文案迁入 `gate.note`。
   */
  gate?: FlowStepGate;
  /**
   * 「仅引导」声明（批次 B「空壳链路清账」）。关联资产的治理面标 `isRuntimeReady=true`，
   * 正文却只有「[XX体] 围绕 X 执行」式转投语（引用壳，见 shared/lib/prompt-shell.ts）时，
   * 本步必须显式声明为「仅引导」：不指望资产生成正文，由作者用自己的模型/素材完成这一步。
   *
   * **未声明的壳 = 静默幻觉**（`FLOW_STEP_GUIDANCE_UNDECLARED_SHELL`，仓内必须为 0，
   * 见 shared/lib/flow-step-guidance.ts）；声明后运行时 availability='guidance'，
   * UI 必须给出可见提示（GUIDANCE_ONLY_HINT，链路详情 + 推进页两处）。
   */
  guidanceOnly?: boolean;
  nextStepId: string | null; // 下一步 ID，尾步骤为 null
  switchAllowed: boolean; // 是否允许中途跳跃切换
  navigateTo?: string; // 完成本步后自动跳转的目标标签页 (如 'bible'/'outline'/'planning'/'production'/'quality')
}

export interface SkillSeriesFlow {
  id: string;
  name: string;
  description: string;
  steps: SkillSeriesFlowStep[];
}

export interface CuratedProductSkill {
  id: string;
  title: string;
  curatedCategory:
    'opening' | 'bible' | 'prose' | 'audit' | 'de-ai' | 'platform' | 'style' | 'deconstruct';
  goal: string;
  successSignal: string;
  score: number;
  grade: string;
  sourceType: 'built-in' | 'plaza' | 'licensed';
  primaryCategory: string;
  inputs: string[];
  actionType: 'direct-exec' | 'equip' | 'import';
  /** Plan 240 人工策展档位（散卡治理用，见 GovernedPromptAsset.curationTier）。 */
  curationTier?: 'featured' | 'standard' | 'suspect-duplicate';
  parentSkillId?: string;
  capabilityManifest?: CapabilityManifestEntry;
}
