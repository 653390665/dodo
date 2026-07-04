import type { PromptAsset } from './core';

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
  | 'audit-enhance'
  | 'polish-rewrite'
  | 'mount-skill'
  | 'open-flow-step'
  | 'deconstruction-card';

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
  sourceGroup?: 'built-in' | 'square' | 'private' | 'tool' | 'fanqie-supplement' | 'webnovel-writer' | 'test-fixture';

  /** 证据链置信等级 */
  evidenceLevel?: 'scored-from-source' | 'summarized-source' | 'placeholder-for-import' | 'test-fixture';

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
}
