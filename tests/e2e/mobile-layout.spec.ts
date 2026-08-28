import { test, expect } from '@playwright/test';

test('mobile welcome keeps the primary controls reachable', async ({ page }) => {
  await page.goto('/');

  const advancedTools = page.getByRole('button', { name: '高级工具', exact: true });
  await expect(advancedTools).toBeVisible();
  await expect(advancedTools).toHaveAttribute('aria-expanded', 'false');
  await advancedTools.click();
  await expect(advancedTools).toHaveAttribute('aria-expanded', 'true');
});

test('mobile settings keeps entitlement tab reachable', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const settingsButton = page.locator('button[aria-label="系统设置"]');
  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  const dialog = page.locator('#settings-dialog-container');
  await expect(dialog).toBeVisible();
  const tabList = dialog.getByRole('tablist');
  const listBox = await tabList.boundingBox();
  expect(listBox).not.toBeNull();
  expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(375);
  expect(await tabList.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const entitlementTab = dialog.getByRole('tab', { name: '权益状态', exact: true });
  await expect(entitlementTab).toBeVisible();
  const tabBox = await entitlementTab.boundingBox();
  expect(tabBox).not.toBeNull();
  expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(375);
  await entitlementTab.click();
  await expect(dialog).toContainText('Beta 默认开放');
});

test('Pixel 5 editor and governance surfaces stay usable without horizontal overflow', async ({ page }) => {
  test.setTimeout(60000);
  await page.route(/\/api\/novels\/[^/]+\/outlines(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: [
      { id: 'mobile-master', novelId: 'n', level: 'master', scope: {}, content: '移动端主纲', source: 'user', status: 'active' },
      { id: 'mobile-volume', novelId: 'n', level: 'volume', scope: { volumeName: '第一卷' }, content: '移动端卷纲', source: 'user', status: 'candidate' },
      { id: 'mobile-chapter', novelId: 'n', level: 'chapter', scope: { chapterStart: 1, chapterEnd: 1 }, content: '移动端章纲', source: 'user', status: 'candidate' },
    ] });
    else await route.fallback();
  });
  await page.route(/\/api\/novels\/[^/]+\/canon-patches$/, async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: [] });
    else await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
  await page.locator('#story-seed-input').fill('移动端治理链路：主角在雨夜进入废墟。');
  await page.getByRole('button', { name: /下一步：选择发布平台/ }).click();
  await page.getByRole('button', { name: /番茄平台/ }).first().click();
  await page.getByRole('button', { name: /下一步：篇幅与文风/ }).click();
  await page.getByRole('button', { name: /中长篇规划/ }).first().click();
  await page.getByRole('button', { name: /剧情高能/ }).first().click();
  await page.getByRole('button', { name: /唤醒灵感，智能开书立项/ }).click();
  await expect(page.getByRole('heading', { name: /立项推荐方案方向/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /选择此立项/ }).first().click();
  await page.getByRole('button', { name: /接受治理规划立项/ }).click();
  await page.getByRole('button', { name: '确认选项并继续', exact: true }).click();
  const enable = page.getByRole('button', { name: /选择推荐创作流程/ });
  if (await enable.count()) await enable.click();
  const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
  await expect(editor).toBeVisible({ timeout: 15000 });
  const workspace = page.getByTestId('agent-workspace');
  await page.getByRole('button', { name: '展开智能管家', exact: true }).click();
  await workspace.getByRole('button', { name: '更多', exact: true }).click();
  await workspace.getByRole('menuitem', { name: '写法与能力', exact: true }).click();
  await expect(workspace).toContainText('写法与能力');
  await workspace.getByRole('button', { name: '写法与能力', exact: true }).click();
  await workspace.getByRole('menuitem', { name: '全书大纲', exact: true }).click();
  await expect(workspace).toContainText('大纲治理');
  await expect(workspace.getByLabel('主大纲 mobile-master')).toBeChecked();
  await expect(workspace).toContainText('第一卷');
  await expect(workspace).toContainText('章 1-1');
  await expect.poll(async () => page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    body: document.body.scrollWidth <= document.body.clientWidth,
  }))).toEqual({ document: true, body: true });
  await expect(workspace.getByRole('button', { name: '全书大纲', exact: true })).toBeVisible();
});

test('Pixel 5 writing-style confirmation dialog stays inside viewport', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/api/novels/*/writing-style/resolve', async (route) => {
    await route.fulfill({ json: {
      resolution: { mode: 'default', fingerprint: 'mobile-style-1', summary: '移动端系统写法', confirmed: false, sources: [{ label: '系统默认' }] },
      candidates: [{ mode: 'default', summary: '系统默认' }],
    } });
  });
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
  await page.locator('#story-seed-input').fill('移动写法确认：雨夜进入城市。');
  await page.getByRole('button', { name: /下一步：选择发布平台/ }).click();
  await page.getByRole('button', { name: /番茄平台/ }).first().click();
  await page.getByRole('button', { name: /下一步：篇幅与文风/ }).click();
  await page.getByRole('button', { name: /中长篇规划/ }).first().click();
  await page.getByRole('button', { name: /剧情高能/ }).first().click();
  await page.getByRole('button', { name: /唤醒灵感，智能开书立项/ }).click();
  await expect(page.getByRole('heading', { name: /立项推荐方案方向/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /选择此立项/ }).first().click();
  await page.getByRole('button', { name: /接受治理规划立项/ }).click();
  await page.getByRole('button', { name: '确认选项并继续', exact: true }).click();
  const enable = page.getByRole('button', { name: /选择推荐创作流程/ });
  if (await enable.count()) await enable.click();
  const style = page.getByRole('region', { name: '本次写法' });
  await expect(style).toBeVisible({ timeout: 15000 });
  await style.getByRole('button', { name: '确认并生成', exact: true }).click();
  const dialog = style.getByRole('dialog', { name: '确认本次写法' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('Pixel 5 capability studio keeps current-work context and governed actions reachable', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
  await page.locator('#story-seed-input').fill('移动能力治理：主角在雨夜进入废墟。');
  await page.getByRole('button', { name: /下一步：选择发布平台/ }).click();
  await page.getByRole('button', { name: /番茄平台/ }).first().click();
  await page.getByRole('button', { name: /下一步：篇幅与文风/ }).click();
  await page.getByRole('button', { name: /中长篇规划/ }).first().click();
  await page.getByRole('button', { name: /剧情高能/ }).first().click();
  await page.getByRole('button', { name: /唤醒灵感，智能开书立项/ }).click();
  await expect(page.getByRole('heading', { name: /立项推荐方案方向/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /选择此立项/ }).first().click();
  await page.getByRole('button', { name: /接受治理规划立项/ }).click();
  await page.getByRole('button', { name: '确认选项并继续', exact: true }).click();
  await page.getByRole('button', { name: /选择推荐创作流程/ }).click();
  const style = page.getByRole('region', { name: '本次写法' });
  await expect(style).toBeVisible({ timeout: 15000 });
  await style.getByRole('button', { name: '管理能力卡', exact: true }).click();
  await expect(page.getByRole('heading', { name: '作品能力中心', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('当前创作流程', { exact: true })).toBeVisible();
  await expect(page.getByText('常用技法', { exact: true })).toBeVisible();
  await expect(page.getByText('作品卡组', { exact: true })).toBeVisible();
  await expect(page.getByText('护栏状态', { exact: true })).toBeVisible();
  await page.getByTestId('app-shell-main').getByRole('button', { name: '能力商店', exact: true }).click();
  for (const label of ['创作流程', '写作技法', '拆书卡', '审稿与精修', '系统护栏']) {
    await expect(page.getByRole('tab', { name: new RegExp(`^${label}\\s+\\d+$`) })).toBeVisible();
  }
  const flowTab = page.getByRole('tab', { name: /^创作流程\s+\d+$/ });
  const flowLabel = await flowTab.innerText();
  const flowCount = Number(flowLabel.match(/(\d+)$/)?.[1] || 0);
  expect(flowCount).toBeGreaterThan(0);
  await expect(flowTab).toContainText(String(flowCount));
  await expect(page.getByRole('button', { name: '免密预览流程详情' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '全部阶段', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部阶段', exact: true }).click();
  await page.getByRole('tab', { name: /^写作技法\s+\d+$/ }).click();
  const techniqueAction = page.getByRole('button', { name: '收藏为常用技法', exact: true }).first();
  await techniqueAction.click();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '取消收藏', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '收藏为常用技法', exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: /^拆书卡\s+\d+$/ }).click();
  await expect(page.getByRole('button', { name: '应用配置后设为作品默认', exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: /^审稿与精修\s+\d+$/ }).click();
  await expect(page.getByText('运行审稿诊断', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: /^系统护栏\s+\d+$/ }).click();
  await expect(page.getByRole('tab', { name: /^系统护栏\s+\d+$/ })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
});
