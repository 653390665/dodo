import { test, expect } from '@playwright/test';
import { runOnboardingToEditor, workspaceSwitcherTab } from './helpers/onboarding';

/**
 * Plan 187 — 驾驶舱（Project Cockpit）最小旅程：
 * 向导建书 → 编辑器 → 「总览」页签 → 行动推荐卡渲染 → 点击推荐 → 回到编辑器。
 * 不 stub cockpit 的推荐计算与静默执行——那是真实路由行为。
 */
test.describe.configure({ retries: 1 });

test('cockpit：行动推荐渲染并可跳转编辑器', async ({ page }) => {
  test.setTimeout(180_000);
  await runOnboardingToEditor(page);

  await workspaceSwitcherTab(page, '总览').click();

  // 章节数据异步装载后渲染治理推荐主卡（或空章节首章卡）
  const primaryAction = page.getByTestId('cockpit-primary-action');
  const firstChapterAction = page.getByTestId('cockpit-first-chapter-action');
  await expect(primaryAction.or(firstChapterAction).first()).toBeVisible({ timeout: 30_000 });
  // LLM 可用性诚实展示（keyless → 琥珀降级态）
  await expect(page.getByTestId('cockpit-llm-availability')).toBeVisible();

  if (await primaryAction.isVisible()) {
    await primaryAction.click();
  } else {
    await firstChapterAction.click();
  }

  const editorTextarea = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
  await expect(editorTextarea).toBeVisible({ timeout: 20_000 });
});
