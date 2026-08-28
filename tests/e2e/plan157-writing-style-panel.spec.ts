import { expect, test } from '@playwright/test';

test('partial preference profile keeps writing-style and capability round trip usable', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
  await page.getByRole('button', { name: '我的书库', exact: true }).click();

  const title = `Plan157 半残画像 ${Date.now()}`;
  await page.getByRole('button', { name: '新作品', exact: true }).click();
  await page.getByPlaceholder('在此输入新书名...').fill(title);
  await page.getByRole('button', { name: '立即创建', exact: true }).click();
  const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
  await expect(editor).toBeVisible({ timeout: 15_000 });

  await page.evaluate(async (novelTitle) => {
    const listResponse = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': 'plan157-setup' },
      body: JSON.stringify({ method: 'listNovels', args: [] }),
    });
    const list = await listResponse.json() as { result?: Array<{ id: string; title: string }> };
    const novel = list.result?.find((entry) => entry.title === novelTitle);
    if (!novel) throw new Error('Plan157 test novel not found');
    const now = Date.now();
    const createResponse = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': 'plan157-setup' },
      body: JSON.stringify({ method: 'createChapter', args: [{
        id: `plan157-chapter-${now}`,
        novelId: novel.id,
        title: '第二章',
        content: '',
        order: 1,
        wordCount: 0,
        createdAt: now,
        updatedAt: now,
      }] }),
    });
    if (!createResponse.ok) throw new Error(`Plan157 chapter setup failed: ${createResponse.status}`);
  }, title);

  await page.route('**/api/db', async (route) => {
    const body = route.request().postDataJSON() as { method?: string };
    if (body.method !== 'getNovel') return route.continue();
    const response = await route.fetch();
    const payload = await response.json() as { result?: { projectPreferenceProfile?: unknown } };
    if (payload.result) payload.result.projectPreferenceProfile = { tags: [] };
    await route.fulfill({ response, json: payload });
  });

  await page.reload();
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '展开章节列表', exact: true }).click();
  await page.getByRole('button', { name: '打开章节：第二章', exact: true }).click();
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.fill('第二章正文：雨声盖过了远处的钟。');

  const style = page.getByRole('region', { name: '本次写法' });
  await style.getByRole('button', { name: '查看本章写法', exact: true }).click();
  const workspace = page.getByTestId('agent-workspace');
  await expect(workspace.getByRole('heading', { name: '本章写法与能力', exact: true })).toBeVisible();
  await expect(workspace.getByText('作品写法画像', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: '进入作品能力中心', exact: true }).click();

  await expect(page.getByRole('heading', { name: '作品能力中心', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('能力配置会带回刚才那一章，不需要重新找章节。')).toBeVisible();
  await page.getByRole('button', { name: '回到刚才章节写作', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('第二章');
  await expect(editor).toHaveValue('第二章正文：雨声盖过了远处的钟。');
  await expect(page.getByText('Cannot convert undefined or null to object')).toHaveCount(0);
});
