import { test, expect } from '@playwright/test';
import { runOnboardingToEditor } from './helpers/onboarding';

/**
 * Plan 187 — 智能管家（AgentWorkspace）最小旅程：
 * 编辑器展开智能管家 → 面板挂载 → 生成正文页签真实发起一次生产 run
 * （keyless → 确定性保底事件流；Plan 198 改造后默认意图（无字数声明）
 * 的保底草稿即可通过流内完整章质量门）→ 断言 run 进入 review_required
 * 且 plan165 严格门禁用「接受并写入」。无 stub。
 */
test.describe.configure({ retries: 1 });

test('agent workspace：面板挂载并真实生产一章到 review_required', async ({ page }) => {
  test.setTimeout(240_000);
  await runOnboardingToEditor(page);

  await page.getByRole('button', { name: '展开智能管家' }).click();
  const workspace = page.locator('[data-testid="agent-workspace"]');
  await expect(workspace).toBeVisible({ timeout: 10_000 });
  await expect(workspace.getByText('智能管家工作台')).toBeVisible();

  // 生成正文页签
  await workspace.getByRole('button', { name: '生成正文', exact: true }).click();
  const reviewRegion = page.locator('[data-production-run-review="true"]');
  await expect(reviewRegion).toBeVisible({ timeout: 10_000 });

  // 默认意图（无字数声明）：Plan 198 改造后保底草稿可通过整章质量门
  await reviewRegion.getByLabel('生产意图').fill('主角在废墟边缘完成第一次反杀。');

  // 写法未选中时按钮先打开确认弹窗（「确认本次写法」）→ 确认并生成；
  // 若已确认则直接开始。两条路径都收敛到真实 start-stream。
  const generateButton = workspace.getByRole('button', { name: /生成本章正文/ }).first();
  await expect(generateButton).toBeVisible({ timeout: 10_000 });
  await generateButton.click();
  const confirmDialog = page.getByRole('dialog', { name: '确认本次写法' });
  const confirmGenerate = page.getByRole('button', { name: '确认并生成', exact: true });
  if (await confirmDialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirmGenerate.click();
  }

  // run 完成 → 生产报告显示 review_required；保底草稿触发 plan165 严格门：
  // 「接受并写入」禁用 + 未审稿警告（治理拒绝的真实 UI 契约）。
  await expect(reviewRegion.getByText(/状态 review_required/)).toBeVisible({ timeout: 120_000 });
  const acceptButton = reviewRegion.getByRole('button', { name: '接受并写入' });
  await expect(acceptButton).toBeDisabled();
  await expect(reviewRegion.getByText(/保底草稿未经过模型审稿/)).toBeVisible();
});
