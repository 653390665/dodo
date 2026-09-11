import { expect, type Page } from '@playwright/test';

/**
 * Plan 187 — 开书向导 → 编辑器 的共享 UI 旅程。
 * 全程真实链路（keyless → 确定性本地保底），无 stub。
 */
export async function runOnboardingToEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');

  const seedInput = page.locator('#story-seed-input');
  await expect(seedInput).toBeVisible();
  await seedInput.fill('旅程验证：主角在末日废墟中觉醒异能，开始复仇。');
  await page.locator('button:has-text("下一步：选择发布平台")').click();
  await page.locator('button:has-text("番茄平台")').first().click();
  await page.locator('button:has-text("下一步：篇幅与文风")').click();
  await page.locator('button:has-text("中长篇规划")').first().click();
  await page.locator('button:has-text("剧情高能")').first().click();
  await page.locator('button:has-text("唤醒灵感，智能开书立项")').click();
  await expect(page.locator('h2:has-text("立项推荐方案方向")')).toBeVisible({ timeout: 30_000 });
  await page.locator('button:has-text("选择此立项")').first().click();
  await page.locator('button:has-text("接受治理规划立项")').click();
  await page.getByRole('button', { name: '确认选项并继续', exact: true }).click();
  await page.locator('button:has-text("选择推荐创作流程")').click();

  const editorTextarea = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
  await expect(editorTextarea).toBeVisible({ timeout: 15_000 });
}

/** 通过 workspace-family-switcher 切换工作台视图（桌面视口可见）。 */
export function workspaceSwitcherTab(page: Page, label: '总览' | '写作' | '设定') {
  return page.locator('[data-testid="workspace-family-switcher"]').getByRole('button', { name: label });
}
