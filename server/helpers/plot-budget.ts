/**
 * Dynamic plot point budget and execution modes (Opening Mode vs Cyclic Mode) helper.
 * Promotes long-term story stability and prevents early exhaustion of setting and climax reveals.
 */

export function getPlotBudgetGuidelines(chapterOrder: number): string {
  const isOpeningMode = chapterOrder <= 10;
  const modeName = isOpeningMode ? "开篇模式 (Opening Mode)" : "十章循环模式 (10-Chapter Cyclic Mode)";
  
  let budgetPrompt = `\n\n### 剧情点预算与控制规约 (Plot Point Budget & Controls)
【当前执行模式】：${modeName} (当前第 ${chapterOrder} 章)
【剧情点消耗与揭示原则】：
1. 区分管理剧情点：
   - **可揭示**：本章允许彻底揭露、说明或解答的设定/伏笔。
   - **只埋伏**：本章仅限安插线索、引入悬念、种下引子，严禁当章揭秘。
   - **禁止提前消耗**：核心真相、终极大招或后续关键反转在本章中必须保持完全神秘，绝对禁止提及或提前被角色识破或消耗。
`;

  if (isOpeningMode) {
    budgetPrompt += `2. **开篇模式特殊要求（第1-10章）**：
   - 专注于展现核心世界观切面，引入关键金手指并明确其基础限制与反噬。
   - 保持开篇高悬念钩子与强主角驱动力。
   - 隐藏任何最终真相的同步揭示，本阶段的所有伏笔以“埋设”为主，禁止消耗大纲中的后期高潮真相。`;
  } else {
    budgetPrompt += `2. **十章循环模式特殊要求（第11章及以后）**：
   - 本章预算剧情揭露点最多 1 处，多余的谜底强制只埋设新线索，绝对不予戳破，以维持极具悬念的宏观推进空间。
   - 每次推进高潮后必须留下至少 2 个新的期待型伏笔悬念。
   - 严格防范前期过度透支设定。本章产生的设定与冲突必须可收回，确保后续章节有清晰的向上空间。`;
  }
  
  return budgetPrompt;
}
