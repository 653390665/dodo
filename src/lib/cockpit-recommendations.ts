/**
 * @file cockpit-recommendations.ts
 * @description 墨影 (InkFlow) 驾驶舱自适应创作建议核心推荐算法
 * @copyright Google DeepMind Advanced Agentic Coding Group
 * 
 * 遵守 Google 编程规范 (Google TypeScript Style Guide)，自带详细中文注释。
 */

/**
 * 创作建议计算参数接口
 */
export interface ComputeRecommendationsParams {
  /** 当前作品章节总数 */
  chaptersCount: number;
  /** 世界设定（人物/场景等）的总实体数量 */
  worldEntitiesCount: number;
  /** 当前选定章节是否包含分镜/Beats 规划 */
  hasBeats: boolean;
  /** 当前选定章节是否包含正文内容 */
  hasContent: boolean;
  /** 当前选定章节是否包含 AI 或人工审稿意见 */
  hasCritique: boolean;
  /** 当前作品激活的 SOP 写作流/序列 ID（例如：'book-deconstruction-flow'） */
  activeSeriesId?: string;
  /** 当前作品已完成的 SOP 步骤标记数组 */
  completedSteps?: string[];
}

/**
 * 根据当前作品的各种状态，计算出针对创作者的最佳行动建议推荐列表。
 * 支持「拆书转化流」的特殊自适应引导，并可在完成后平滑穿透回常规推荐。
 * 
 * @param params 推荐计算所需的各项上下文指标
 * @returns 推荐行动标识符数组 (长度最多为 3)
 */
export function computeCockpitRecommendations(params: ComputeRecommendationsParams): string[] {
  const {
    chaptersCount,
    worldEntitiesCount,
    hasBeats,
    hasContent,
    hasCritique,
    activeSeriesId,
    completedSteps = []
  } = params;
  
  // ==========================================
  // 1. 特殊流程判定：拆书转化工作流 (Book Deconstruction Flow)
  // ==========================================
  if (activeSeriesId === 'book-deconstruction-flow') {
    const isStep1Done = completedSteps.includes('completed-step:book-deconstruction-flow:step1');
    const isStep2Done = completedSteps.includes('completed-step:book-deconstruction-flow:step2');
    
    // 如果步骤 1 尚未完成，强推“拆书转化第 1 步”
    if (!isStep1Done) {
      return [
        'deconstruct_flow_step1',
        ...[
          chaptersCount === 0 ? 'create_first_chapter' : null,
          worldEntitiesCount < 2 ? 'add_world_setting' : null,
          'mount_skill'
        ].filter((x): x is string => x !== null)
      ].slice(0, 3);
    }
    // 如果步骤 1 已完成，但步骤 2 未完成，强推“拆书转化第 2 步”
    else if (!isStep2Done) {
      return [
        'deconstruct_flow_step2',
        ...[
          chaptersCount === 0 ? 'create_first_chapter' : null,
          worldEntitiesCount < 2 ? 'add_world_setting' : null,
          'mount_skill'
        ].filter((x): x is string => x !== null)
      ].slice(0, 3);
    }
    // 注：若步骤 1 与步骤 2 都已完成，则自适应穿透回下方常规推荐逻辑
  }

  // ==========================================
  // 2. 常规创作流程自适应推荐逻辑 (金字塔递进式)
  // ==========================================
  
  // 极简主义：全新书起步
  if (chaptersCount === 0) {
    return ['create_first_chapter', 'add_world_setting', 'import_continuation'];
  }
  
  // 设定冷启动：实体太少，无法形成世界设定上下文
  if (worldEntitiesCount < 2) {
    return ['add_world_setting', 'resume_editor', 'mount_skill'];
  }
  
  // 分镜规划冷启动：有章无分镜
  if (!hasBeats) {
    return ['planning_beats', 'add_world_setting', 'mount_skill'];
  }
  
  // 正文撰写冷启动：有分镜无正文
  if (!hasContent) {
    return ['production_content', 'planning_beats', 'mount_skill'];
  }
  
  // 质量审计冷启动：有正文无审稿
  if (!hasCritique) {
    return ['start_audit', 'polish_content', 'resume_editor'];
  }
  
  // 最终精修：已有高能审计，推荐进行针对性精修润色
  return ['polish_content', 'resume_editor', 'export_db_backup'];
}
