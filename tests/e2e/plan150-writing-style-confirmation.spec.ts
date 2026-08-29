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
  // Expansion pools for the quality-gate-compliant fixture (plan 172): every
  // sentence embeds a per-paragraph index so no complete sentence repeats.
  const draftExpansionOpenings = [
    '追兵停在巷口', '锁舌退回暗槽', '铃声沉入地下', '冷风穿过袖口', '红线延向门后',
    '泥水遮住刻痕', '钥匙碰出轻响', '灯芯忽然一跳', '影子贴近墙角', '城门留下回声',
    '瓦檐滴水未停', '更声隔了三街', '火折子在袖中熄了', '檐角铁马轻响', '雨声忽然稀了',
    '茶面的白雾直起', '门钉比昨日多痕', '梁上灰簌未落', '信筒封蜡重压', '靴底泥浆未干',
  ];
  const draftExpansionClues = [
    '一枚压在泥里的铜扣', '半张浸湿的布防图', '一道新凿的石缝', '封蜡上倒按的指印',
    '梁头垂下的细线', '墙内侧的刮痕', '茶盏底部的刻字', '门闩上的新鲜汗渍',
    '钟楼方向的火光', '藏在灯座里的纸捻',
  ];
  const draftExpansionPlaces = [
    '门后的暗渠入口', '北墙的钟楼基座', '西厢的柴房夹层', '正厅的供桌下方',
    '马厩最深的那格', '地窖的第二级石阶', '窗棂与墙的夹角', '院中枯井的边沿',
  ];
  const draftExpansionFindings = [
    '纹章的缺口与档案记载互补', '刻痕的走向指向城北', '封蜡的重按方向刻意反了',
    '细线的末端系着半截香头', '汗渍说明有人久候未离', '刻字是另一种密写法',
  ];
  const draftExpansionRisks = [
    '雨停之前必须有人先露面', '更声再响两次城门就会换防', '梁上的旁观者随时可能先动',
    '同伴的咳嗽声已是第二次警告', '火光每亮一次方位就移一里',
  ];
  // Resumed drafts must not reuse the non-resumed expansion text: the accepted
  // first draft is already part of the editor baseline, so identical expansion
  // paragraphs would trip the chapter quality gate's duplicate checks (plan 172).
  const draftExpansionShapes = [
    (i: number, n: number) => `${draftExpansionOpenings[i % draftExpansionOpenings.length]}。沈砚在第${n}次对照里停了停，把${draftExpansionClues[i % draftExpansionClues.length]}与${draftExpansionPlaces[(i * 3) % draftExpansionPlaces.length]}对在一起看。${draftExpansionFindings[i % draftExpansionFindings.length]}，这个判断不喧哗，却把方向钉住了。第${n}条警戒线画在明处：${draftExpansionRisks[i % draftExpansionRisks.length]}。`,
    (i: number, n: number) => `${draftExpansionPlaces[(i * 5 + 2) % draftExpansionPlaces.length]}那边的动静先来。同伴压低声音，把第${n}条提示说了两遍：${draftExpansionRisks[i % draftExpansionRisks.length]}。沈砚摆手，示意第${n}处线索还没有核对完。他把${draftExpansionClues[(i * 2 + 1) % draftExpansionClues.length]}折进袖口，脚步没有停下。`,
    (i: number, n: number) => `第${n}轮清点不是多余——${draftExpansionFindings[(i * 2) % draftExpansionFindings.length]}就摆在眼前。${draftExpansionRisks[(i * 7 + 1) % draftExpansionRisks.length]}，这话由同伴说出，分量翻了一倍。沈砚把注意力从${draftExpansionClues[(i * 3) % draftExpansionClues.length]}挪向${draftExpansionPlaces[(i * 5) % draftExpansionPlaces.length]}，像棋手提前让出一子。`,
    (i: number, n: number) => `没有人催他，可第${n}处异样自己浮了上来。${draftExpansionClues[(i * 5 + 2) % draftExpansionClues.length]}是实据，${draftExpansionFindings[(i * 4) % draftExpansionFindings.length]}是推断，两者合上，${draftExpansionPlaces[(i * 2) % draftExpansionPlaces.length]}就成了必须走的一站。他在心里给${draftExpansionRisks[i % draftExpansionRisks.length]}留了位置。`,
    (i: number, n: number) => `他在${draftExpansionPlaces[(i * 7 + 3) % draftExpansionPlaces.length]}停了很久。不是犹豫，是把第${n}轮观察重新过了一遍：${draftExpansionClues[(i * 6 + 1) % draftExpansionClues.length]}没有变，${draftExpansionRisks[(i * 2 + 1) % draftExpansionRisks.length]}也没有变。变的是他愿意为第${n}个判断付多少代价。`,
    (i: number, n: number) => `${draftExpansionFindings[(i * 5) % draftExpansionFindings.length]}——写这种结论只需要一瞬间，证它却要从${draftExpansionClues[(i * 4) % draftExpansionClues.length]}一路磨到${draftExpansionPlaces[(i * 3 + 2) % draftExpansionPlaces.length]}。第${n}次对照结束时，沈砚把两条证据并排放好，像把两块碎瓷拼回原状，缺口对缺口。`,
  ];
  const completeDraft = (lead: string, resumed = false) => [
    `${lead} 雨水从断裂的城墙边缘倾落，敲在石阶上，像有人在黑暗中一遍遍数着时间。沈砚没有立刻踏进城门，他先抬头确认风向，又把掌心贴在冰冷的门钉上，感到门后传来极轻的震动。那震动并不规律，却每隔三次呼吸便重新响起，仿佛沉睡的城市正在回应他的到来。远处的灯火被雨幕切成细碎的金线，照出街面上尚未干涸的车辙，也照出一枚压在泥里的铜扣。铜扣上的纹章与他记忆中的旧档案完全相同，这让他意识到，今晚的路线早已被某个看不见的人安排好了。旧档案里还记载着一条无人敢走的暗渠，入口就在城门后的第三块石板下面，而暗渠尽头通向废弃的钟楼。沈砚把这个线索默默记下，决定无论屋里等着什么，都不能让同伴先暴露身份。`,
    `沈砚弯腰捡起铜扣，没有把它收入衣袋，而是用指尖擦去表面的泥水。纹章下方刻着一行几乎磨平的小字，只有在闪电照亮街口时才能辨清其中两个笔画。身后的同伴催他快走，声音隔着斗篷传来，带着掩饰不住的紧张。沈砚示意对方噤声，随后侧身贴近门缝，听见里面有杯盏轻碰的声音，接着是三下短促的敲击。那是他们约定过的暗号，可敲击的节奏被人故意改过，最后一下拖得很长。这个细节说明接头人仍然活着，却已经失去了主动选择的余地。更让他不安的是，杯盏碰撞的回声来自两个方向，说明屋里至少还有一名藏在梁上的旁观者。沈砚调整呼吸，给同伴做了一个等候的手势，又把匕首藏到袖口深处，准备先试探对方的底线。${resumed ? '他又检查了一遍铜扣的内侧，确认新出现的划痕并非雨水冲出的偶然痕迹。' : ''}`,
    `他把铜扣递给同伴，自己则推开半扇门，让一线冷风先进入屋内。屋里的炉火没有点燃，桌上却摆着两盏温热的茶，茶面浮着细小的白雾。最暗的角落里有人挪开杯盏，露出一截沾血的袖口，那人没有报出姓名，只说城北的钟已经停了。沈砚听懂了这句话背后的警告，停在门槛外重新观察每一处阴影。街上忽然传来马蹄声，越来越近，门内的人也在同一刻收紧手指。沈砚终于跨过门槛，把门后的闩条压下，决定先弄清楚谁在追踪他们，再寻找失踪的地图。门闩落下的声音惊动了梁上的人，一根细线从屋顶垂落，线端系着一只尚未点燃的信筒。沈砚没有伸手去碰，只将铜扣放在桌面中央，等着真正的接头人从阴影里做出选择。${resumed ? '这一次他没有靠近信筒，而是先记下线端指向的方向，等屋里的第三个人先露出破绽。' : ''}`,
    // Expansion paragraphs must satisfy the chapter quality gate (plan 172):
    // every sentence unique, varied paragraph openings, no template structure.
    ...Array.from({ length: 44 }, (_, index) => {
      if (resumed) return draftExpansionShapes[index % draftExpansionShapes.length](index, index + 1);
      const n = index + 1;
      const o = draftExpansionOpenings[index % draftExpansionOpenings.length];
      const c = draftExpansionClues[index % draftExpansionClues.length];
      const p = draftExpansionPlaces[(index * 3 + 1) % draftExpansionPlaces.length];
      const f = draftExpansionFindings[index % draftExpansionFindings.length];
      const r = draftExpansionRisks[(index * 5 + 2) % draftExpansionRisks.length];
      return `${o}。沈砚把第${n}处线索记进心里——${c}，位置对着${p}。他弯腰细看，指尖停在不属于雨水的痕迹上，得出${f}的判断。同伴用眼色问要不要动，他摇头，只把布防图的折痕对向更声传来的方向。${r}，这条界线之内，谁先伸手谁就先暴露。`;
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
