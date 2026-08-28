import { test, expect, type Page } from '@playwright/test';

const generationHeader = 'x-inkflow-database-generation';

async function createNovel(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
  await page.locator('#story-seed-input').fill('写法确认链路：主角在雨夜进入失落城市。');
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
  await expect(page.locator('textarea[placeholder="在这里开始书写这一章……"]')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '展开智能管家', exact: true }).click();
  const workspace = page.getByTestId('agent-workspace');
  await workspace.getByRole('button', { name: '分镜', exact: true }).click();
  await expect(workspace.locator('textarea[placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."]')).toBeVisible({ timeout: 10000 });
  await workspace.locator('textarea[placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."]').fill('固定分镜：雨夜进入废墟。');
  await workspace.getByRole('button', { name: '收起智能管家', exact: true }).click();
}

async function installMocks(page: Page) {
  let styleChanged = false;
  let resolveCalls = 0;
  let confirmCalls = 0;
  let draftCalls = 0;
  let auditCalls = 0;
  let productionRunCalls = 0;
  const draftExpansionOpenings = [
    '雨幕压低了城墙', '灯影贴着石阶', '潮声撞过断桥', '铁牌硌住掌心', '门缝漏进冷光',
    '水痕爬上台阶', '火把照亮泥印', '守门人收紧手指', '石壁落下一层灰', '旧纸卷过脚边',
    '追兵停在巷口', '锁舌退回暗槽', '铃声沉入地下', '冷风穿过袖口', '红线延向门后',
    '泥水遮住刻痕', '钥匙碰出轻响', '灯芯忽然一跳', '影子贴近墙角', '城门留下回声',
  ];
  const completeDraft = (lead: string, resumed = false) => [
    `${lead} 雨水从断裂的城墙边缘倾落，敲在石阶上，像有人在黑暗里一遍遍数着时间。沈砚没有立刻踏进城门，他先抬头确认风向，又把掌心贴在冰冷的门钉上，感到门后传来极轻的震动。那震动并不规律，却每隔三次呼吸便重新响起，仿佛沉睡的城市正在回应他的到来。远处的灯火被雨幕切成细碎的金线，照出街面上尚未干涸的车辙，也照出一枚压在泥里的铜扣。铜扣上的纹章与他记忆中的旧档案完全相同，这让他意识到，今晚的路线早已被某个看不见的人安排好了。旧档案里还记载着一条无人敢走的暗渠，入口就在城门后的第三块石板下面，而暗渠尽头通向废弃的钟楼。沈砚把这个线索默默记下，决定无论屋里等着什么，都不能让同伴先暴露身份。`,
    `沈砚弯腰捡起铜扣，没有把它收入衣袋，而是用指尖擦去表面的泥水。纹章下方刻着一行几乎磨平的小字，只有在闪电照亮街口时才能辨清其中两个笔画。身后的同伴催他快走，声音隔着斗篷传来，带着掩饰不住的紧张。沈砚示意对方噤声，随后侧身贴近门缝，听见里面有杯盏轻碰的声音，接着是三下短促的敲击。那是他们约定过的暗号，可敲击的节奏被人故意改过，最后一下拖得很长。这个细节说明接头人仍然活着，却已经失去了主动选择的余地。更让他不安的是，杯盏碰撞的回声来自两个方向，说明屋里至少还有一名藏在梁上的旁观者。沈砚调整呼吸，给同伴做了一个等候的手势，又把匕首藏到袖口深处，准备先试探对方的底线。${resumed ? '他又检查了一遍铜扣的内侧，确认新出现的划痕并非雨水冲出的偶然痕迹。' : ''}`,
    `他把铜扣递给同伴，自己则推开半扇门，让一线冷风先进入屋内。屋里的炉火没有点燃，桌上却摆着两盏温热的茶，茶面浮着细小的白雾。最暗的角落里有人挪开杯盏，露出一截沾血的袖口，那人没有报出姓名，只说城北的钟已经停了。沈砚听懂了这句话背后的警告，停在门槛外重新观察每一处阴影。街上忽然传来马蹄声，越来越近，门内的人也在同一刻收紧手指。沈砚终于跨过门槛，把门后的闩条压下，决定先弄清楚谁在追踪他们，再寻找失踪的地图。门闩落下的声音惊动了梁上的人，一根细线从屋顶垂落，线端系着一只尚未点燃的信筒。沈砚没有伸手去碰，只将铜扣放在桌面中央，等着真正的接头人从阴影里做出选择。${resumed ? '这一次他没有靠近信筒，而是先记下线端指向的方向，等屋里的第三个人先露出破绽。' : ''}`,
    ...Array.from({ length: 40 }, (_, index) => {
      const opening = resumed ? `第${index + 1}处新痕` : draftExpansionOpenings[index % draftExpansionOpenings.length];
      return `${opening}。第${index + 1}次确认时，沈砚没有重复先前的判断，而是沿着新的水痕调整站位，把眼前的异常和手里的铜扣逐一对照。守门人的沉默因此有了重量，门后的危险也被推近了一步。他让同伴记住墙上的刻痕，自己则把暗号拆成几段，在追兵的脚步声里寻找其中缺失的回音。`;
    }),
  ].join('\n\n');
  await page.route('**/api/novels/*/writing-style/resolve', async (route) => {
    resolveCalls += 1;
    const fingerprint = styleChanged ? 'style-2' : 'style-1';
    await route.fulfill({ json: {
      resolution: { mode: styleChanged ? 'blend' : 'default', fingerprint, summary: styleChanged ? '新的融合写法' : '初始系统写法', confirmed: false, sources: [{ label: styleChanged ? 'Writer Skill：融合' : '系统默认' }] },
      candidates: [{ mode: 'default', summary: '系统默认' }, { mode: 'blend', summary: '融合写法' }],
    } });
  });
  await page.route('**/api/novels/*/writing-style/confirm', async (route) => {
    confirmCalls += 1;
    const body = route.request().postDataJSON() as { mode?: string };
    const fingerprint = styleChanged ? 'style-2' : 'style-1';
    await route.fulfill({ json: {
      fingerprint,
      resolution: { mode: body.mode || 'default', fingerprint, summary: styleChanged ? '新的融合写法' : '初始系统写法', confirmed: true, sources: [{ label: styleChanged ? 'Writer Skill：融合' : '系统默认' }] },
      candidates: [{ mode: 'default', summary: '系统默认' }, { mode: 'blend', summary: '融合写法' }],
    } });
  });
  await page.route('**/api/orchestrate-draft', async (route) => {
    draftCalls += 1;
    if (draftCalls === 2) {
      styleChanged = true;
      await route.fulfill({ status: 409, json: {
        code: 'STYLE_CONFIRMATION_REQUIRED', error: '请先确认本次写法',
        resolution: { mode: 'blend', fingerprint: 'style-2', summary: '新的融合写法', confirmed: false, sources: [{ label: 'Writer Skill：融合' }] },
        candidates: [{ mode: 'default', summary: '系统默认' }, { mode: 'blend', summary: '融合写法' }],
      } });
      return;
    }
    const requestBody = route.request().postDataJSON() as { databaseGeneration?: number };
    const requestGeneration = Number.isFinite(requestBody.databaseGeneration) ? requestBody.databaseGeneration : 0;
    const generatedText = draftCalls >= 3
      ? completeDraft('新的融合写法正文段落。', true)
      : completeDraft('生成正文保留段落。');
    // The client accumulates token events and then appends the final done text;
    // keep the token empty so the fixture does not duplicate the full draft.
    const body = `data: ${JSON.stringify({ type: 'status', message: '离线生成中' })}\n\ndata: ${JSON.stringify({ type: 'token', content: '' })}\n\ndata: ${JSON.stringify({ type: 'done', text: generatedText })}\n\n`;
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', [generationHeader]: String(requestGeneration) }, body });
  });
  const semanticPassAudit = {
    score: 94,
    fatalIssues: [],
    sceneChecks: [{ scene: '雨夜入口', status: 'ok', note: '行动目标与结果完整。' }],
    surgerySuggestions: [],
    evidence: [
      { category: 'scene_execution', severity: 'low', quote: '雨水从断裂的城墙边缘倾落', explanation: '场景行动证据完整。', suggestedFix: '保持行动推进。' },
      { category: 'character_state', severity: 'low', quote: '沈砚没有立刻踏进城门', explanation: '人物选择与压力一致。', suggestedFix: '保持人物动机。' },
      { category: 'hard_canon', severity: 'low', quote: '旧档案', explanation: '世界设定证据可定位。', suggestedFix: '保持设定连续。' },
      { category: 'foreshadowing', severity: 'low', quote: '废弃的钟楼', explanation: '后续悬念已埋入。', suggestedFix: '后续回收线索。' },
    ],
  };
  await page.route('**/api/audit', async (route) => {
    auditCalls += 1;
    const body = route.request().postDataJSON() as { databaseGeneration?: number };
    await route.fulfill({ status: 200, json: { jobId: `plan150-audit-${auditCalls}`, databaseGeneration: body.databaseGeneration ?? 1 } });
  });
  await page.route('**/api/audit/jobs/plan150-audit-*', route => route.fulfill({
    status: 200,
    json: { status: 'completed', result: { status: 'pass', score: 94, feedback: '审稿通过', structured: semanticPassAudit } },
  }));
  await page.route('**/api/chapter-production-runs/**', async (route) => {
    productionRunCalls += 1;
    await route.continue();
  });
  await page.route('**/api/db', async (route) => {
    const body = route.request().postDataJSON() as { method?: string };
    if (body.method === 'createChapterVersion') {
      await route.fulfill({ json: { result: true } });
      return;
    }
    await route.continue();
  });
  return { get resolveCalls() { return resolveCalls; }, get confirmCalls() { return confirmCalls; }, get draftCalls() { return draftCalls; }, get auditCalls() { return auditCalls; }, get productionRunCalls() { return productionRunCalls; } };
}

test.describe('Plan150 writing style confirmation', () => {
  test('desktop confirms, survives style 409, and resumes once', async ({ page }) => {
    test.setTimeout(60000);
    const state = await installMocks(page);
    await createNovel(page);
    const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
    await editor.fill('用户正文保留：城门在雨中开启。');
    const style = page.getByRole('region', { name: '本次写法' });
    await expect(style).toBeVisible({ timeout: 15000 });
    await style.getByRole('button', { name: '确认并生成', exact: true }).click();
    await style.getByRole('dialog', { name: '确认本次写法' }).getByRole('button', { name: '确认并生成', exact: true }).click();
    await expect.poll(() => state.draftCalls).toBe(1);
    await expect(editor).toHaveValue('用户正文保留：城门在雨中开启。');
    const firstCandidate = page.locator('section[aria-label="AI 正文候选"], section[aria-label="智能管家正文候选"]');
    const workspace = page.getByTestId('agent-workspace');
    await expect(firstCandidate).toBeVisible({ timeout: 15_000 });
    await firstCandidate.getByText('查看候选正文预览', { exact: true }).click();
    await expect(firstCandidate).toContainText('生成正文保留段落。');
    await expect(firstCandidate.getByRole('button', { name: '接受并写入', exact: true })).toBeDisabled();
    const expandWorkspace = page.getByRole('button', { name: '展开智能管家', exact: true });
    if (await expandWorkspace.count()) await expandWorkspace.click();
    await workspace.getByRole('button', { name: '审稿', exact: true }).click();
    await workspace.getByRole('button', { name: '开始 AI 审计', exact: true }).click();
    await expect.poll(() => state.auditCalls).toBe(1);
    const reviewedAccept = workspace.getByRole('button', { name: '接受并写入', exact: true });
    await expect(reviewedAccept).toBeEnabled({ timeout: 30_000 });
    await reviewedAccept.click();
    await expect(editor).toContainText('生成正文保留段落。');
    await style.getByRole('button', { name: '融合写法', exact: true }).click();
    // Changing the writing mode invalidates the previous confirmation. The
    // next generation must pass through the confirmation dialog again.
    const staleAction = style.getByRole('button', { name: '确认并生成', exact: true });
    await expect(staleAction).toBeEnabled({ timeout: 15000 });
    await staleAction.click();
    await style.getByRole('dialog', { name: '确认本次写法' }).getByRole('button', { name: '确认并生成', exact: true }).click();
    await expect.poll(() => state.draftCalls).toBe(2);
    await expect(style.getByRole('button', { name: '确认并生成', exact: true })).toBeVisible();
    await expect(style).toContainText('新的融合写法');
    await style.getByRole('button', { name: '确认并生成', exact: true }).click();
    await style.getByRole('dialog', { name: '确认本次写法' }).getByRole('button', { name: '确认并生成', exact: true }).click();
    await expect.poll(() => state.draftCalls).toBe(3);
    const resumedCandidate = page.locator('section[aria-label="AI 正文候选"], section[aria-label="智能管家正文候选"]');
    await expect(resumedCandidate).toBeVisible({ timeout: 15_000 });
    await resumedCandidate.getByText('查看候选正文预览', { exact: true }).click();
    await expect(resumedCandidate).toContainText('新的融合写法正文段落。');
    await expect(resumedCandidate.getByRole('button', { name: '接受并写入', exact: true })).toBeDisabled();
    // The resumed candidate remains a preview; accepting it is a separate
    // action, so the editor must still contain the first accepted draft only.
    await expect(editor).toContainText('用户正文保留：城门在雨中开启。');
    await expect(editor).toContainText('生成正文保留段落。');
    await expect(editor).not.toContainText('新的融合写法正文段落。');
    // Initial confirmation, confirmation after selecting the new mode, and
    // the confirmation required after the server reports the style changed.
    await expect.poll(() => state.confirmCalls).toBe(3);
    expect(state.productionRunCalls).toBe(0);
    await expect(editor).toContainText('用户正文保留：城门在雨中开启。');
  });

});
