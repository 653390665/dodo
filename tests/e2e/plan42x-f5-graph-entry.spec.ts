import { expect, test, type Page } from '@playwright/test';

/**
 * Plan42x F5 — 知识图谱入口可发现性。
 * 1) 设定页"总览"页签常驻"关系图谱"入口，点击直达图谱视图；
 * 2) 图谱空状态的"去添加人物"按钮可用（跳转人物档案页签）。
 */
const novel = {
  id: 'e2e-f5-novel',
  title: 'F5 图谱入口验证',
  authorId: 'local-user',
  summary: 'E2E fixture',
  status: 'ongoing' as const,
  createdAt: 1,
  updatedAt: Date.now(),
  globalOutline: '',
  worldRules: '',
};

async function waitForAppReady(page: Page) {
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
}

async function setupNovel(page: Page, withCharacter: boolean) {
  const tokenResponse = await page.request.get('/api/dev-auth-token');
  const { token } = (await tokenResponse.json()) as { token?: string };
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
  const post = (method: string, args: unknown[]) =>
    page.request.post('/api/db', { headers: authHeaders, data: { method, args } });

  const novelId = withCharacter ? 'e2e-f5-novel' : 'e2e-f5-novel-empty';
  const created = await post('createNovel', [{ ...novel, id: novelId }]);
  expect(created.ok()).toBeTruthy();
  if (withCharacter) {
    const charCreated = await post('createCharacter', [
      {
        id: 'e2e-f5-char',
        novelId,
        name: '林舟',
        role: 'protagonist',
        summary: 'fixture',
        traits: [],
        bio: 'fixture',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    expect(charCreated.ok()).toBeTruthy();
  }
  return novelId;
}

function landOnWorld(page: Page, novelId: string) {
  return page.addInitScript((id) => {
    localStorage.setItem('inkflow-last-view', 'world');
    localStorage.setItem('inkflow-selected-novel-id', id);
  }, novelId);
}

test('F5: 设定总览图谱入口直达图谱视图', async ({ page }) => {
  const novelId = await setupNovel(page, true);
  landOnWorld(page, novelId);
  await page.goto('/');
  await waitForAppReady(page);

  // 总览页签有常驻"关系图谱"入口（title 区别于侧栏页签），点击后直达图谱视图
  await expect(page.getByText('资料续写总览')).toBeVisible({ timeout: 15_000 });
  const graphEntryButton = page.getByTitle('查看人物、地点、道具、势力之间的关系图谱');
  await expect(graphEntryButton).toBeVisible();
  await graphEntryButton.click();
  await expect(page.getByText('全局实体关系图谱')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('img', { name: '故事记忆关系图谱' })).toBeVisible();
});

test('F5: 图谱空状态"去添加人物"跳转人物档案', async ({ page }) => {
  const novelId = await setupNovel(page, false);
  landOnWorld(page, novelId);
  await page.goto('/');
  await waitForAppReady(page);

  // 冷启动态点击侧栏"关系图谱"页签，空态占位提供"去添加人物"按钮
  await expect(page.getByText('初始化您的')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '关系图谱' }).click();
  await expect(page.getByText('全局实体关系图谱')).toBeVisible({ timeout: 10_000 });
  const emptyGoButton = page.getByRole('button', { name: '去添加人物' });
  await expect(emptyGoButton).toBeVisible();
  await emptyGoButton.click();
  // 空世界下人物档案页签仍会被冷启动页覆盖（存量行为），这里验证页签已实际切换
  await expect(page.getByRole('button', { name: '人物档案' })).toHaveClass(/bg-theme-accent/, {
    timeout: 10_000,
  });
});
