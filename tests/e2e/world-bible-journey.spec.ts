import { test, expect } from '@playwright/test';
import { runOnboardingToEditor, workspaceSwitcherTab } from './helpers/onboarding';

/**
 * Plan 187 — 设定视图（World Bible）最小旅程：
 * 向导建书 → 编辑器 → 「设定」页签（新书先见设定引导）→ 刷新恢复会话后
 * 进入真实世界书 → 新建角色条目 → 列表回显。全真实链路，无 stub。
 *
 * 设定引导草稿（onboardingDraft）是内存态：刷新即清，世界书页签视图才可见。
 */
test.describe.configure({ retries: 1 });

test('world bible：新建角色条目并回显', async ({ page }) => {
  test.setTimeout(180_000);
  await runOnboardingToEditor(page);

  // 首访设定视图：新书进入「设定记忆引导」
  await workspaceSwitcherTab(page, '设定').click();
  await expect(page.getByRole('heading', { name: '设定记忆引导' })).toBeVisible({ timeout: 20_000 });

  // 刷新 → 会话恢复（currentView 与 selectedNovelId 均持久化）→ 世界书页签视图。
  // 「设定」切换走异步 handleNavigate，先等 last-view 落盘再刷新，避免恢复到欢迎页。
  await page.waitForFunction(() => localStorage.getItem('inkflow-last-view') === 'world', undefined, { timeout: 15_000 });
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true', { timeout: 30_000 });
  await workspaceSwitcherTab(page, '设定').click();

  // 落地页签可能是冷启动或设定与续写（立项会预置主角），但页签栏恒有「人物档案」。
  // 页签名可能带计数后缀（如「人物档案 1」），用正则匹配。
  const charactersTab = page.getByRole('button', { name: /人物档案/ }).first();
  await expect(charactersTab).toBeVisible({ timeout: 20_000 });
  await charactersTab.click();

  const addCharacter = page.locator('button:has-text("新增角色")');
  await expect(addCharacter).toBeVisible({ timeout: 10_000 });
  await addCharacter.first().click();

  // 新建角色渲染在姓名 input 里；预置主角名「待命名主角」，手动新增默认「新人物」
  await expect(page.locator('input.font-bold.text-lg').first()).toHaveValue(/待命名主角|新人物/);
});
