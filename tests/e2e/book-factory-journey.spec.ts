import { test, expect } from '@playwright/test';
import { runOnboardingToEditor } from './helpers/onboarding';

/**
 * Plan 187 — 拆书工厂（Book Factory）最小旅程：
 * 向导建书（绑定作品）→ 侧栏高级工具进入工厂 → 粘贴文本 → 真实拆书
 * （keyless → 服务端同步返回确定性保底萃取，source: 'fallback'）
 * → 断言拆书卡结果与保底徽标回显。无 stub。
 */
test.describe.configure({ retries: 1 });

const SAMPLE_TEXT = [
  '夜色像一层湿透的布，压在旧城的屋檐上。林舟贴着墙根往前走，脚步落在积水里，几乎没有声音。',
  '他知道巷子尽头有人等着他，也知道那一壶酒里掺了什么。可他还是去了。',
  '「你来晚了。」对面的人说。林舟坐下，把刀放在桌上，刀柄朝着自己。',
  '「路不好走。」他说。两个人都没有再说话，酒过三巡，灯花爆了一声。',
].join('');

test('book factory：保底萃取生成拆书卡并回显', async ({ page }) => {
  test.setTimeout(240_000);
  await runOnboardingToEditor(page);

  // 侧栏「高级工具」→ 拆书工厂
  await page.getByRole('button', { name: '高级工具', exact: true }).click();
  await page.getByRole('button', { name: '拆书工厂' }).click();

  const pasteInput = page.locator('textarea[placeholder="或直接粘贴小说文本到此处..."]');
  await expect(pasteInput).toBeVisible({ timeout: 15_000 });
  await pasteInput.fill(SAMPLE_TEXT);

  const analyzeButton = page.locator('button:has-text("开始拆书并生成拆书卡")');
  await expect(analyzeButton).toBeEnabled();
  await analyzeButton.click();

  // 服务端同步返回保底萃取结果：结果面板 + 保底徽标 + 卡片计数
  await expect(page.getByText('拆书卡结果')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('保底萃取').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/当前共生成 \d+ 张拆书卡。/)).toBeVisible({ timeout: 30_000 });
});
