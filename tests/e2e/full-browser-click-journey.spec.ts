import { expect, test, type Page } from '@playwright/test';

import { validateCompleteChapterDraftQuality } from '../../shared/lib/draft-quality';

const FULL_BROWSER_DRAFT_BASE = [
  '门轴在暴雨里轻轻一响，屋内的灯火同时矮了半截。林舟停在废墟门边，没有急着踏过积水，只借着墙面反光确认那盏不该亮着的灯。',
  '潮汐城的潮水每逢午夜都会倒流，石阶上的水痕却刚刚从城内退向城外。林舟抬起左手，导师留下的青铜铃在掌心碰出一声闷响，巷口随即传来第二道脚步。',
  '他把铃扣进袖口，沿着断墙向前挪动。门后的守门人没有露面，只将一枚生锈的铁牌推到缝隙下方。铁牌背面刻着导师惯用的三道短线，最后一道被人故意刮去。',
  '林舟用指腹摸过缺口，听见城外的追捕者正在分开搜索。那一刻他明白，灯火不是引路的信号，而是有人提前点亮的诱饵。守门人终于开口，报出一半暗号，又在最关键的字上停住。',
  '青铜铃在袖中再次震动，第三声余音从地下传上来，墙脚的砖缝随之裂开一线。林舟没有回头看追兵，只把铁牌插进裂缝，潮水忽然逆着台阶涌回，沉在城下的门锁响了一声。',
  '门锁的回声没有向城内扩散，反而沿着水面退向他脚边。林舟侧身避开涌来的冷水，发现水里漂着一张被撕去姓名的纸。纸背画着一条通往地下的红线，终点正落在那盏灯下。',
  '追捕者撞开外墙，碎石砸在铁牌上。守门人终于从暗处现身，手里没有兵器，只有一串与青铜铃同样磨损的钥匙。他盯着林舟的袖口，像是在确认某个已经等了很多年的答案。',
  '林舟把纸片折成窄条，压在铁牌下面，随后抬眼看向守门人。两人都没有再提导师的名字，但钥匙串里最短的那一把已经插进了锁孔。门缝里涌出的不是风，而是一股带着盐味的旧水。',
  '城下传来第二次震动，追兵的火把在门外连成一线。林舟握紧铃柄，先踏进只容一人通过的缝隙，再用肩膀顶住回落的石门。身后的脚步被水声截断，地下却亮起了一排无人点燃的灯。',
  '最里面的灯影映出一面刻满名字的石壁，导师的名字被新鲜的泥水遮去一半。林舟抹开泥痕，石壁后忽然传来熟悉的三短一长的敲击，像有人在黑暗里回应他的到来。',
  '青铜铃最后一次震动时，潮汐城的水面彻底静了下来。林舟把钥匙推进锁芯，听见门后有人轻声说出缺失的暗号。门没有完全打开，却把一束冷光投到他的脚尖，照出泥水里第二双刚刚留下的脚印。',
].join('\n\n');

// Keep the browser contract representative of a complete chapter. Each
// paragraph must add a choice, a consequence, or new information; a repeated
// filler loop would validate the workflow while hiding the literary defect.
const FULL_BROWSER_DRAFT_EXPANSIONS = [
  '林舟把那张缺名的纸贴在灯罩上，红线随火光缓慢移动，最后停在石壁西侧。守门人看见这个变化，立刻收起钥匙，低声说：“别碰那面墙。”',
  '警告来得太晚。墙砖向内陷了一寸，潮湿的气息从缝隙里涌出，带着铁锈和陈年药草的味道。林舟没有后退，反而用铁牌抵住裂口，给自己争出一条观察的缝。',
  '缝隙后不是通道，而是一间倒扣在地下的房间。桌上摆着三只空碗，碗底都压着相同的铜屑，像有人每天准时来这里等待，却从未等到该回来的人。',
  '“导师来过这里？”林舟问。守门人盯着那三只碗，半晌才回答：“他留下了门，却没留下出去的方法。”这句话让林舟意识到，眼前的锁并不是为了挡住外面的人。',
  '外墙又响了一次，追捕者开始用火油烧门。热气穿过砖缝，地下的水面泛起细密的波纹。林舟将铜铃放进水里，铃舌没有碰撞，远处却传来一声回应。',
  '回应来自房间深处。守门人伸手拦住他，指尖在半空画出三道短线，正好补上铁牌背面被刮去的那一道。林舟这才明白，缺口不是破坏，而是一条只有两个人知道的邀请。',
  '他把铁牌翻过来，三道短线在水光里组成一枚箭头。箭头指向桌脚。林舟移开空碗，下面露出一块可以旋转的石板，石板边缘留着新鲜的泥，说明有人比他们更早来过。',
  '守门人不肯解释泥印的主人，甚至挡住了林舟伸向石板的手。两人的力道只交错了一瞬，林舟却发现对方手腕上缠着和导师同款的黑线，那根线已经被血浸成暗褐色。',
  '门外传来喊声：“里面的人，报出身份！”守门人松手，退到灯影之外。林舟没有应答，他把铁牌塞入石板凹槽，随后朝门外大声说出一个故意错误的地名。',
  '喊声立即变成咒骂，烧门的人判断他们还在地面。争取来的几息时间足够林舟旋开石板。地面下方露出一圈向下的铁梯，梯底传来水滴声，每一滴都与铃声保持相同间隔。',
  '同伴先下去探路，脚刚落地，头顶便有石屑坠落。林舟抬头，看见门梁已经被火油烧穿，守门人却没有跟上来，只把那串钥匙抛进暗道，自己转身迎向门外。',
  '“你不走？”林舟接住钥匙。守门人的声音隔着烟尘传来：“总得有人让他们相信，这里只有一扇门。”门板轰然裂开，火光将他的影子切成两半。',
  '林舟沿铁梯下降，地下水没过脚踝。水底铺着一层细沙，沙上留有拖行重物的痕迹，方向与红线一致。他让同伴熄灭火折子，借着墙上微弱的冷光摸索前进。',
  '暗道拐角处立着一块石碑，碑面没有文字，只有七个凹陷的圆孔。林舟取出铜屑逐一嵌入，前六孔都没有反应，最后一孔却从里面渗出温热的水。',
  '温水冲开石碑背后的暗格，露出一枚被油布包裹的木匣。木匣上没有锁，只有导师留下的指纹印。林舟没有直接拆开它，先问同伴是否还听见追兵的声音。',
  '回答他的是一阵沉闷的鼓点。那不是来自上方，而是沿着地下水道从远处传来，节奏与守门人的暗号相反。林舟将木匣贴近耳边，里面传出细小的撞击，像有人被关在其中。',
  '他撬开木匣，里面只有一枚黑色种子和一张折叠地图。种子表面布满细纹，纹路与潮汐城的街道完全重合。地图的终点没有标注城门，而是标在城市最深处的钟楼。',
  '同伴指着地图上的空白处，那里被人用刀尖划出一个名字：沈川。林舟认识这个名字，它属于三年前负责封锁潮汐城的巡查官，也属于导师最后一封信里被反复涂黑的那个人。',
  '上方忽然传来守门人的惨叫，短促得像被什么东西掐断。林舟合上地图，把种子收入内袋，决定先去钟楼。他不能确认守门人是否还活着，却能确认火势正在沿着铁梯下降。',
  '钟楼入口藏在一条被水淹没的街道尽头。林舟用钥匙串试过三把锁，前两把通向空屋，第三把打开后，墙内传出密集的齿轮声，整座城的灯火同时转向了他们。',
  '灯光照出水面上的人影。那不是三个人，而是四个。多出来的影子站在林舟身后，手里握着一把没有刀刃的短柄。林舟没有转身，只把地图递给同伴，轻声说：“等我数到三，往左跑。”',
  '陌生声音贴着他的耳侧响起：“你终于拿到种子了。”林舟盯着钟楼的倒影，故意把手伸向空处。对方的影子随之偏移，露出墙角一截被水泡白的袖口，袖口上绣着巡查官的徽记。',
  '他数到二便突然敲响铜铃。所有灯火熄灭，水道里只剩急促的呼吸声。同伴按照约定冲向左侧，林舟则把黑色种子抛进钟楼底座，种子落水的瞬间，整座城市发出了一声低沉的回响。',
  '回响中，失踪的导师终于说完了那句暗号：“第三声不是开门，是换人。”林舟转过身，看见守门人的影子从水里站起来，而刚才那名巡查官已经不在原地。',
  '潮水开始上涨，钟楼的齿轮一格格转动。林舟握住重新发热的铜铃，发现铃面浮出一行刚刻成的字：明晚，带一个相信你的人回来。远处的火光重新亮起，新的脚步正从城外靠近。',
  '同伴在左侧街口打出手势，示意追兵已经分成两队。林舟把地图卷成细筒藏进靴筒，随后踩灭脚边的冷光，逼自己在完全黑暗里辨认水流方向。',
  '水流绕过钟楼底座，钻进一条狭窄的沟槽。沟槽边刻着旧城居民的姓名，许多名字被硬生生刮掉，只剩下最后一个字。林舟摸到其中一处凹痕，指尖沾上了尚未干透的墨。',
  '墨迹来自一封刚写完的信。信上只有一句话：不要相信带钥匙的人。林舟回头望向守门人的影子，影子已经沉入水底，只留下一串钥匙浮在波纹中央。',
  '他没有捞起钥匙，而是用铁牌将它推到同伴脚下。两人交换了一个眼神，决定把这件诱饵留在原地。钟楼的指针忽然反向转动，指向城外尚未熄灭的第七盏灯。',
  '第七盏灯的位置在旧渡口。林舟沿着水道疾走，鞋底几次打滑，肩膀撞上潮湿的石柱。每一次撞击都让墙内传出回声，回声数量逐渐增多，仿佛暗道里还有别的队伍。',
  '他们在渡口发现一艘没有船夫的木船。船头系着导师的黑线，船舱却堆满陌生人的行李，里面有儿童鞋、药瓶和一张被撕去半边的城防图。林舟终于理解，这座城市的秘密牵涉的不只是追捕者。',
  '同伴翻开药瓶，闻到与地下房间相同的药草味。瓶底刻着巡查官的徽记，旁边还写着一个日期。日期早于潮汐城封锁的那天，说明有人在封城之前就准备好了撤离路线。',
  '渡口上方传来弓弦声。林舟将木船推入水中，自己留下来遮住船灯。同伴问他是否跟上，他只回答：“船到对岸再点灯。”说完便把铜铃抛向相反方向，铃声引着箭矢射入空巷。',
  '箭矢落地，黑暗中有人骂了一声。林舟借着短暂的火星看见对方袖口，那里的徽记不是巡查官，而是导师曾经警告过的“守潮人”。这个新名字让他明白，追捕从来不是单独一支队伍。',
  '木船撞上对岸的石桩，同伴在雾里点亮一盏蓝灯。蓝光照出城门外的山路，也照出山路尽头一辆停了多年的马车。车门半开，车内挂着一块写有林舟姓名的木牌。',
  '他跨上对岸时，铜铃从远处水沟里重新响起。铃声只有两下，第三下迟迟没有落下。林舟收起木牌，望向正在逼近的火把，终于确认导师留下的不是一条逃生路，而是一场尚未结束的换人。',
  '同伴在马车旁找到一盏熄灭的提灯，灯芯仍然温热。林舟打开车门，里面没有车夫，只有一面被雨水打湿的镜子，镜中映出的城门比现实更近。',
  '镜面浮出一条新的水痕，像有人从另一侧伸手写字。林舟用袖口擦去雾气，看见那行字指向城外的山路，并标出一个与导师暗号相同的时间。',
  '火把的光已经越过渡口。林舟把提灯交给同伴，让他沿山路先走，自己留下来拖住来人。临别前，他把木牌折断一半，约定只要另一半亮起，便立刻回城。',
  '马车后的车轮突然自行转动，拖痕一直延伸到水里。林舟握紧青铜铃，听见第三声终于落下；潮汐城的灯火随之全部转向山路，像在为下一场追逐指路。',
  '山路上响起短促的哨声，同伴没有回头，只把蓝灯挂到一块突出的岩石上。林舟看见灯光在雾里留下断续的标记，知道这条路已经有人走过，而且那个人刻意让他们跟上。',
  '他最后看了一眼被雨水覆盖的城门，收起断裂的木牌，转身追向山路。身后的第三声铃响没有消散，反而像一根细线牵住整座城市，把过去和即将到来的夜晚缝在了一起。',
  '山风掠过耳侧，远处的火光又亮了一盏。',
  '林舟没有停步。',
  '雨声更急了。',
  '山坡另一侧传来石子滚落的声音，林舟握住铃柄，脚下的泥土跟着轻轻震动。',
  '他没有回头确认来者，只把那盏蓝灯再往前推了一段，让雾中的标记延伸到看不见的地方。',
  '蓝光落在湿石上，照出一条尚未干涸的新鲜脚印。',
  '脚印通向山口。',
  '雾更浓了。',
  '停。',
];
const FULL_BROWSER_DRAFT = [FULL_BROWSER_DRAFT_BASE, ...FULL_BROWSER_DRAFT_EXPANSIONS].join('\n\n');

const FULL_BROWSER_POLISHED = '潮汐城的潮水在午夜会逆流。林舟扣住门框，把青铜铃压回掌心，先看清水痕退向城外的方向。门缝后的守门人没有回答，只将钥匙串轻轻一晃，示意他别让追捕者看见灯影。';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-ready')).toHaveAttribute('data-ready-state', 'true');
}

async function installDeterministicAiFixtures(page: Page) {
  let draftCalls = 0;
  let latestDraftContext = '';
  let auditCalls = 0;
  let latestAuditContent = '';
  let rewriteCalls = 0;
  const capabilityCalls: string[] = [];
  let worldCandidateNovelId = 'full-browser-novel';

  await page.route('**/api/orchestrate-draft', async (route) => {
    draftCalls += 1;
    const body = JSON.parse(route.request().postData() || '{}') as { databaseGeneration?: number; contextStr?: string };
    latestDraftContext = body.contextStr || '';
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-inkflow-database-generation': String(body.databaseGeneration ?? 1),
      },
      body: [
        'data: {"type":"status","message":"Writer Agent 正在生成离线确定性候选…"}\n\n',
        `data: ${JSON.stringify({ type: 'token', content: FULL_BROWSER_DRAFT })}\n\n`,
        `data: ${JSON.stringify({ type: 'done', text: FULL_BROWSER_DRAFT })}\n\n`,
      ].join(''),
    });
  });

  const audit = {
    score: 78,
    fatalIssues: [{
      issueType: 'action-chain', issueSubtype: 'weak-action-chain', severity: 'major',
      snippet: '潮汐城的潮水每逢午夜都会倒流', explanation: '异常设定出现后缺少即时动作承接。', patchHint: '补充林舟确认异常后的动作。',
    }],
    sceneChecks: [{ scene: '暴雨废墟', status: 'weak', note: '入口动作可更具体。' }],
    surgerySuggestions: ['让林舟先确认灯火来源，再进入城市。'],
    evidence: [{ category: 'hard_canon', severity: 'high', quote: '潮汐城', explanation: '世界规则被正文提及。', suggestedFix: '保持规则前后一致。' }],
  };
  const passingAudit = {
    score: 94,
    fatalIssues: [],
    sceneChecks: [{ scene: '暴雨废墟', status: 'ok', note: '章节目标、行动和结果完整。' }],
    surgerySuggestions: [],
    evidence: [
      { category: 'scene_execution', severity: 'low', quote: '林舟停在废墟门边', explanation: '章节目标通过行动展开。', suggestedFix: '保持行动链。' },
      { category: 'character_state', severity: 'low', quote: '林舟握紧铃柄', explanation: '人物选择与压力一致。', suggestedFix: '保持人物动机。' },
      { category: 'hard_canon', severity: 'low', quote: '潮汐城的潮水每逢午夜都会倒流', explanation: '世界规则有正文证据。', suggestedFix: '保持规则前后一致。' },
      { category: 'foreshadowing', severity: 'low', quote: '第二双刚刚留下的脚印', explanation: '章末悬念有可定位证据。', suggestedFix: '下一章继续推进。' },
    ],
  };
  const auditFeedback = `## 审稿诊断\n发现一个动作链问题。\n<!-- audit-structured:${Buffer.from(JSON.stringify(audit), 'utf8').toString('base64')} -->`;
  const passingAuditFeedback = `## 审稿通过\n<!-- audit-structured:${Buffer.from(JSON.stringify(passingAudit), 'utf8').toString('base64')} -->`;

  await page.route('**/api/audit', async (route) => {
    auditCalls += 1;
    const auditBody = route.request().postDataJSON() as { draftContent?: string; databaseGeneration?: number };
    latestAuditContent = auditBody.draftContent || '';
    await route.fulfill({ status: 200, json: { jobId: 'full-browser-audit-job', databaseGeneration: auditBody.databaseGeneration ?? 1 } });
  });
  await page.route('**/api/audit/jobs/full-browser-audit-job**', async (route) => {
    const result = auditCalls === 2
      ? { status: 'fail', score: audit.score, feedback: auditFeedback }
      : { status: 'pass', score: passingAudit.score, feedback: passingAuditFeedback, structured: passingAudit };
    await route.fulfill({ status: 200, json: { status: 'completed', result } });
  });
  await page.route('**/api/rewrite', async (route) => {
    rewriteCalls += 1;
    const body = JSON.parse(route.request().postData() || '{}') as { databaseGeneration?: number };
    const polished = FULL_BROWSER_POLISHED;
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-inkflow-database-generation': String(body.databaseGeneration ?? 1) },
      body: `data: ${JSON.stringify({ type: 'token', content: polished })}\n\ndata: ${JSON.stringify({ type: 'done', text: polished })}\n\n`,
    });
  });

  await page.route('**/api/novels/*/capabilities/*/execute', async (route) => {
    const pathname = new URL(route.request().url()).pathname.split('/');
    const assetId = pathname[pathname.length - 2] || 'unknown-capability';
    capabilityCalls.push(assetId);
    const body = JSON.parse(route.request().postData() || '{}') as { databaseGeneration?: number };
    const isDiagnostic = assetId.includes('audit') || assetId.includes('diagnostic') || assetId === 'text-diagnostics';
    await new Promise((resolve) => setTimeout(resolve, 80));
    const contextReceipt = {
      actual: true,
      sourceIds: ['e2e-chapter', assetId],
      runtimeSha256: 'e2e-runtime-sha',
      injectedChars: 42,
      itemCount: 2,
      truncated: false,
      sources: [],
    };
    await route.fulfill({
      status: 200,
      json: isDiagnostic
        ? {
          kind: 'diagnostic',
          capabilityId: assetId,
          report: { issueCount: 1, score: 91, issues: [{ category: '动作链', line: 1, snippet: '林舟走进废墟', suggestion: '补充动作因果' }] },
          baselineHash: 'e2e-baseline',
          contextReceipt,
          resolvedAtGeneration: body.databaseGeneration ?? 1,
          readOnly: true,
        }
        : {
          kind: 'transform-preview',
          capabilityId: assetId,
          preview: '林舟扣住门框，雨水沿着袖口滴落。',
          baselineHash: 'e2e-baseline',
          contextReceipt,
          resolvedAtGeneration: body.databaseGeneration ?? 1,
          readOnly: true,
        },
    });
  });

  await page.route('**/api/generate-outline', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { novelId?: string; techniqueId?: string; databaseGeneration?: number };
    if (body.techniqueId !== 'bible-world-builder') {
      await route.continue();
      return;
    }
    worldCandidateNovelId = body.novelId || worldCandidateNovelId;
    await route.fulfill({
      status: 200,
      json: { jobId: 'full-browser-world-candidate-job', databaseGeneration: body.databaseGeneration ?? 1 },
    });
  });
  await page.route('**/api/world/jobs/full-browser-world-candidate-job**', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        status: 'completed',
        progress: 100,
        result: {
          candidate: {
            id: 'full-browser-world-candidate',
            novelId: worldCandidateNovelId,
            target: { kind: 'world', id: worldCandidateNovelId, label: '全链路测试作品' },
            operation: 'optimize',
            baseFingerprint: 'full-browser-world-base',
            sourceCapabilityVersions: [{ capabilityId: 'bible-world-builder', version: '1' }],
            proposedCore: { premise: '潮汐城的灯火是城市记忆的锚点', rules: ['午夜后灯火不会熄灭'] },
            proposedContent: '候选世界观：潮汐城的灯火是城市记忆的锚点。',
            diff: { changed: true, fields: [{ path: 'premise', after: '潮汐城的灯火是城市记忆的锚点', kind: 'added' }] },
            impactReport: { downstream: [], reviewRequired: [], manuscriptConflict: false, reasons: ['测试候选'] },
            status: 'pending',
          },
        },
      },
    });
  });

  return {
    get draftCalls() { return draftCalls; },
    get latestDraftContext() { return latestDraftContext; },
    get auditCalls() { return auditCalls; },
    get latestAuditContent() { return latestAuditContent; },
    get rewriteCalls() { return rewriteCalls; },
    capabilityCalls,
  };
}

async function createNovel(page: Page) {
  await page.route('**/api/onboarding/llm-session', route => route.fulfill({ status: 201, json: { sessionId: 'full-browser-session' } }));
  await page.route('**/api/story-cards', route => route.fulfill({ json: {
    source: 'fallback',
    cards: [{
      id: 'full-browser-card',
      hook: '废墟深处的城市仍在呼吸。',
      protagonist: '边境调查者林舟',
      coreConflict: '林舟必须在追捕者抵达前找到城市真相。',
      tone: '紧张、克制、快节奏',
      whyItWorks: '先用异常灯火建立谜团，再用追捕推动行动。',
      starterSeeds: { worldSeed: '失落城市与不会熄灭的灯火。', relationshipSeed: '林舟与失踪导师留下的暗号。', chapterOneSeed: '林舟在暴雨夜进入废墟。' },
      planningFit: { recommendedLength: '中长篇规划', recommendedFocus: '剧情推进', recommendedPacing: '紧推进', reason: '快速进入核心冲突。' },
      riskNote: '不要在第一章解释城市全部真相。',
      mixTags: ['悬疑', '废墟', '异能'],
      signals: { tone: '紧张', conflictType: '探索与追捕', worldWeight: 0.6, characterWeight: 0.4, pacingPreference: 'tight' },
      sourceBadge: 'manual',
    }],
  } }));

  await page.locator('#story-seed-input').fill('林舟在暴雨废墟中发现一座仍有灯火的失落城市。');
  await page.getByRole('button', { name: /下一步：选择发布平台/ }).click();
  await page.getByRole('button', { name: /番茄平台/ }).first().click();
  await page.getByRole('button', { name: /下一步：篇幅与文风/ }).click();
  await page.getByRole('button', { name: /中长篇规划/ }).first().click();
  await page.getByRole('button', { name: /剧情高能/ }).first().click();
  await page.getByRole('button', { name: /唤醒灵感，智能开书立项/ }).click();
  await expect(page.getByRole('heading', { name: /立项推荐方案方向/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /选择此立项/ }).first().click();
  await page.getByRole('button', { name: /接受治理规划立项/ }).click();
  await page.getByRole('button', { name: '确认选项并继续', exact: true }).click();
  const flow = page.getByRole('button', { name: /选择推荐创作流程/ });
  if (await flow.count()) await flow.click();
  await expect(page.locator('textarea[placeholder="在这里开始书写这一章……"]')).toBeVisible({ timeout: 15_000 });
}

async function openSkills(page: Page) {
  const sidebarButton = page.getByRole('button', { name: '作品能力中心', exact: true });
  if (await sidebarButton.count()) {
    await sidebarButton.click();
  } else {
    const manageCapabilities = page.getByRole('button', { name: '管理能力卡', exact: true });
    await expect(manageCapabilities).toBeVisible();
    await manageCapabilities.click();
  }
  await expect(page.getByRole('heading', { name: '作品能力中心', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '能力商店', exact: true }).click();
}

function capabilityCard(page: Page, name: string) {
  return page.getByRole('heading', { name: new RegExp(`^${name}`) })
    .locator('xpath=ancestor::div[contains(@class,"bg-theme-sidebar")][1]');
}

async function clickStageFilter(page: Page, name: string) {
  const button = page.getByRole('button', { name: new RegExp(`^${name}`) });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByRole('heading', { name: new RegExp(name.replace(/[①②③④]/g, '')) })).toBeVisible();
}

async function seedProductionEvidence(page: Page) {
  return page.evaluate(async () => {
    const call = async (method: string, args: unknown[], databaseGeneration?: number) => {
      const response = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-id': 'full-browser-evidence' },
        body: JSON.stringify({ method, args, ...(databaseGeneration === undefined ? {} : { databaseGeneration }) }),
      });
      const payload = await response.json() as { result?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error || `${method} failed: ${response.status}`);
      return payload.result;
    };
    const generationResponse = await fetch('/api/db/generation');
    const { databaseGeneration } = await generationResponse.json() as { databaseGeneration: number };
    const novels = await call('listNovels', []) as Array<{ id: string }>;
    const novelId = novels[0]?.id;
    if (!novelId) throw new Error('full-browser novel not found');
    const now = Date.now();
    await call('updateNovel', [novelId, { worldRules: '潮汐城的潮水每逢午夜都会倒流' }], databaseGeneration);
    await call('createCharacter', [{
      id: `full-browser-character-${now}`, novelId, name: '林舟', role: 'protagonist',
      summary: '只用左手解读导师暗号', traits: ['克制'], bio: '', createdAt: now, updatedAt: now,
    }], databaseGeneration);
    await call('createForeshadowing', [{
      id: `full-browser-foreshadowing-${now}`, novelId, title: '青铜铃',
      description: '第三次响起会打开地下城门', status: 'planted', relatedCharacterIds: [],
      createdAt: now, updatedAt: now,
    }], databaseGeneration);
    return novelId;
  });
}

test('浏览器点击全流程：能力卡到正文', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const clicked: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') console.log(`[browser:error] ${message.text()}`);
  });

  await ready(page);
  const aiFixtures = await installDeterministicAiFixtures(page);
  await createNovel(page);
  clicked.push('脑洞、平台、篇幅、调性、立项、治理确认、设定确认、创作流程');

  await openSkills(page);
  await page.getByRole('tab', { name: /写作技法/ }).click();
  await clickStageFilter(page, '① 立设定与大纲');
  await expect(page.getByRole('heading', { name: /^长篇超宏大世界观设定器/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '核心角色人设卡与成长弧光生成', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '黄金三章核心冲突大纲展开器', exact: true })).toBeVisible();
  for (const cardName of ['长篇超宏大世界观设定器', '核心角色人设卡与成长弧光生成', '黄金三章核心冲突大纲展开器']) {
    const card = capabilityCard(page, cardName);
    const favorite = card.getByRole('button', { name: '收藏为常用技法', exact: true });
    if (await favorite.count()) await favorite.click();
  }
  const applyConfiguration = page.getByRole('button', { name: '应用配置并返回写作', exact: true });
  await expect(applyConfiguration).toBeVisible();
  await applyConfiguration.click();
  await expect(page.locator('textarea[placeholder="在这里开始书写这一章……"]')).toBeVisible({ timeout: 15_000 });
  clicked.push('世界观96、角色91、黄金三章95');

  await openSkills(page);
  await page.getByRole('tab', { name: /写作技法/ }).click();
  await clickStageFilter(page, '② 写正文与提速');
  const proseCard = capabilityCard(page, '场景肢体动作与画面张力正文器');
  await expect(proseCard).toContainText('冷启动证据 94');
  await proseCard.getByRole('button', { name: '应用配置后设为作品默认', exact: true }).click();
  await expect(page.locator('textarea[placeholder="在这里开始书写这一章……"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[title*="场景肢体动作与画面张力正文器"]')).toBeVisible();
  clicked.push('正文94全文统一');

  await openSkills(page);
  await page.getByRole('tab', { name: /写作技法/ }).click();
  await clickStageFilter(page, '② 写正文与提速');
  await expect(capabilityCard(page, '场景肢体动作与画面张力正文器').getByRole('button', { name: '收藏为常用技法', exact: true })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('tab', { name: /审稿与精修/ }).click();
  await clickStageFilter(page, '③ 审稿与精修');
  const auditCard = capabilityCard(page, '去AI腔腔调与废话净化质检仪');
  await expect(auditCard).toContainText('冷启动证据 95');

  const polishCard = capabilityCard(page, '深度AI句式与套话物理抹除器');
  await expect(polishCard).toContainText('冷启动证据 97');

  await page.getByRole('tab', { name: /能力包/ }).click();
  for (const packageName of ['脑洞与角色构建包', '第一章闭环包', '基础审稿增强包', '基础去 AI 腔增强包']) {
    const packageCard = page.getByRole('heading', { name: packageName, exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await expect(packageCard).toBeVisible();
    await packageCard.getByRole('button', { name: /展开并选择/ }).click();
    const dialog = page.getByRole('dialog', { name: packageName });
    await expect(dialog).toBeVisible();
    const checkboxes = dialog.getByRole('checkbox');
    await expect(checkboxes.first()).toBeVisible();
    // Exercise the package's actual selection contract, including dependency
    // unlocks. A package can expose optional and required steps; select every
    // currently enabled step and verify the checked state before closing.
    for (let pass = 0; pass < 3; pass += 1) {
      for (let index = 0; index < await checkboxes.count(); index += 1) {
        const checkbox = checkboxes.nth(index);
        if (await checkbox.isEnabled() && !(await checkbox.isChecked())) await checkbox.check();
      }
    }
    for (let index = 0; index < await checkboxes.count(); index += 1) {
      const checkbox = checkboxes.nth(index);
      if (await checkbox.isEnabled()) await expect(checkbox).toBeChecked();
    }
    await dialog.getByRole('button', { name: '加入本次配置候选', exact: true }).click();
    await expect(dialog).toContainText(/已提交的配置仍待应用|已提交的运行项可立即执行/);
    const closePackageButton = dialog.getByRole('button', { name: /关闭能力包/ });
    if (await closePackageButton.isVisible().catch(() => false)) await closePackageButton.click();
    await expect(page.getByRole('dialog', { name: packageName })).toBeHidden();
  }
  clicked.push('能力包：世界观角色、首章、大纲正文、审稿、去AI腔');

  await page.getByRole('tab', { name: /审稿与精修/ }).click();
  await clickStageFilter(page, '③ 审稿与精修');
  await capabilityCard(page, '去AI腔腔调与废话净化质检仪').getByRole('button', { name: '运行审稿诊断', exact: true }).click();
  clicked.push('审稿95');
  await expect.poll(() => aiFixtures.capabilityCalls.some((id) => id.includes('audit') || id.includes('diagnostic')), { timeout: 15_000 }).toBe(true);
  await expect(page.getByRole('region', { name: '能力执行结果' })).toContainText('动作链', { timeout: 15_000 });
  await expect(page.getByRole('region', { name: '能力执行结果' })).toContainText('确认后再应用');

  await openSkills(page);
  await page.getByRole('tab', { name: /审稿与精修/ }).click();
  await clickStageFilter(page, '③ 审稿与精修');
  await capabilityCard(page, '深度AI句式与套话物理抹除器').getByRole('button', { name: '生成精修预览', exact: true }).click();
  clicked.push('精修97');
  await expect.poll(() => aiFixtures.capabilityCalls.some((id) => !id.includes('audit') && !id.includes('diagnostic')), { timeout: 15_000 }).toBe(true);
  await expect(page.getByRole('region', { name: '能力执行结果' })).toContainText('林舟扣住门框', { timeout: 15_000 });

  await openSkills(page);
  await page.getByRole('tab', { name: /写作技法/ }).click();
  await clickStageFilter(page, '② 写正文与提速');
  await capabilityCard(page, '场景肢体动作与画面张力正文器').getByRole('button', { name: '用于本章', exact: true }).click();
  clicked.push('正文94');
  await expect(page.locator('textarea[placeholder="在这里开始书写这一章……"]')).toBeVisible({ timeout: 15_000 });
  const novelId = await seedProductionEvidence(page);
  const expandWorkspaceAfterAccept = page.getByRole('button', { name: '展开智能管家', exact: true });
  if (await expandWorkspaceAfterAccept.count()) await expandWorkspaceAfterAccept.click();
  await expect(page.getByText('世界观已就绪', { exact: true })).toHaveCount(0);
  await expect(page.getByText('本次写法来源', { exact: true })).toHaveCount(0);
  await expect(page.getByText('AI 已连接', { exact: true })).toHaveCount(0);
  const titleBox = await page.locator('#chapter-title').boundingBox();
  const assistantToggleBox = await page.getByRole('button', { name: '收起智能管家', exact: true }).first().boundingBox();
  expect(titleBox).not.toBeNull();
  expect(assistantToggleBox).not.toBeNull();
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(assistantToggleBox!.x);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
  const workspace = page.getByTestId('agent-workspace');
  await workspace.getByRole('button', { name: '分镜', exact: true }).click();
  await workspace.locator('textarea[placeholder^="请描述本章创作意图"]').fill('林舟进入废墟，确认灯火来自失落城市，遭遇追捕。');
  const beats = workspace.locator('textarea[placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."]');
  await beats.fill('场景一：暴雨废墟；林舟发现灯火。场景二：旧暗号指向城市入口。场景三：追捕者在门外出现。');
  await workspace.getByRole('button', { name: 'AI 扩写正文', exact: true }).click();
  const editor = page.locator('textarea[placeholder="在这里开始书写这一章……"]');
  const baselineContent = await editor.inputValue();
  await expect(page.getByText('AI 处理中', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => aiFixtures.draftCalls, { timeout: 15_000 }).toBe(1);
  const accept = page.getByRole('button', { name: '接受并写入', exact: true });
  await expect(accept).toBeDisabled({ timeout: 30_000 });
  const expandWorkspace = page.getByRole('button', { name: '展开智能管家', exact: true });
  if (await expandWorkspace.count()) await expandWorkspace.click();
  await workspace.getByRole('button', { name: '审稿', exact: true }).click();
  await workspace.getByRole('button', { name: '开始 AI 审计', exact: true }).click();
  await expect.poll(() => aiFixtures.auditCalls, { timeout: 15_000 }).toBe(1);
  expect(aiFixtures.latestAuditContent).toContain('门轴在暴雨里轻轻一响');
  await expect(accept).toBeEnabled({ timeout: 30_000 });
  await expect(editor).toHaveValue(baselineContent);
  await accept.click();
  const confirm = workspace.getByRole('button', { name: '确认写入', exact: true });
  if (await confirm.count()) await confirm.click();
  await expect(editor).not.toHaveValue('', { timeout: 30_000 });
  const content = await editor.inputValue();
  expect(content.replace(/\s/g, '').length).toBeGreaterThanOrEqual(4000);
  expect(content).toContain('潮汐城的潮水每逢午夜都会倒流');
  expect(content).toContain('林舟');
  expect(content).toContain('青铜铃');
  expect(content).not.toContain('证据-');
  const generatedQuality = validateCompleteChapterDraftQuality(content);
  expect(generatedQuality.ok, generatedQuality.violations.join('；')).toBe(true);
  expect(generatedQuality.mechanicalReview?.status).toBe('pass');
  expect(generatedQuality.mechanicalReview?.hits.length || 0).toBeLessThanOrEqual(2);
  expect(generatedQuality.findings.some((finding) => finding.code === 'mechanical-quality')).toBe(false);
  const executionEvidence = await page.evaluate(async (targetNovelId) => {
    const response = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': 'full-browser-evidence' },
      body: JSON.stringify({ method: 'listChapters', args: [targetNovelId] }),
    });
    const payload = await response.json() as { result?: Array<{ workflowMeta?: { capabilityState?: { techniqueIds?: string[] } } }> };
    if (!response.ok) throw new Error(`listChapters failed: ${response.status}`);
    return payload.result?.[0]?.workflowMeta?.capabilityState;
  }, novelId);
  expect(executionEvidence?.techniqueIds).toContain('prose-action-booster');
  expect(aiFixtures.latestDraftContext).toContain('世界观法则');
  expect(aiFixtures.latestDraftContext).toContain('林舟');
  expect(aiFixtures.latestDraftContext).toContain('青铜铃');

  // The editor audit -> polish -> accept path must remain candidate-first:
  // audit is read-only for prose, polish previews without changing the editor,
  // and only explicit acceptance persists content and a version.
  const expandWorkspaceAfterCandidateAccept = page.getByRole('button', { name: '展开智能管家', exact: true });
  if (await expandWorkspaceAfterCandidateAccept.count()) await expandWorkspaceAfterCandidateAccept.click();
  await expect(page.getByTestId('agent-workspace')).toBeVisible();
  const workspaceAfterDraft = page.getByTestId('agent-workspace');
  await workspaceAfterDraft.getByRole('button', { name: '审稿', exact: true }).click();
  const auditButton = workspaceAfterDraft.getByRole('button', { name: '开始 AI 审计', exact: true });
  await expect(auditButton).toBeVisible();
  const beforeAudit = await editor.inputValue();
  const auditCallsBeforeRecheck = aiFixtures.auditCalls;
  await auditButton.click();
  await expect.poll(() => aiFixtures.auditCalls, { timeout: 15_000 }).toBe(auditCallsBeforeRecheck + 1);
  await expect(workspaceAfterDraft.getByText('诊断质量得分', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(editor).toHaveValue(beforeAudit);

  const polishButton = workspaceAfterDraft.getByRole('button', { name: '执行局部手术精修', exact: true });
  await expect(polishButton).toBeVisible();
  await polishButton.click();
  await expect.poll(() => aiFixtures.rewriteCalls, { timeout: 15_000 }).toBe(1);
  await expect(workspaceAfterDraft.getByText('正文候选待确认', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(editor).toHaveValue(beforeAudit);
  const acceptPolish = workspaceAfterDraft.getByRole('button', { name: '接受并写入', exact: true });
  await expect(acceptPolish).toBeDisabled();
  const auditCallsBeforePolishRecheck = aiFixtures.auditCalls;
  await workspaceAfterDraft.getByRole('button', { name: /重新审计章节|开始 AI 审计/, exact: true }).click();
  await expect.poll(() => aiFixtures.auditCalls, { timeout: 15_000 }).toBe(auditCallsBeforePolishRecheck + 1);
  await expect(acceptPolish).toBeEnabled({ timeout: 30_000 });
  await acceptPolish.click();
  await expect.poll(async () => (await editor.inputValue()).includes(FULL_BROWSER_POLISHED), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await editor.inputValue()).length, { timeout: 30_000 }).toBeGreaterThan(800);

  const persisted = await page.evaluate(async ({ targetNovelId, polished }) => {
    const list = async (method: string, args: unknown[]) => {
      const response = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
      const payload = await response.json() as { result?: unknown };
      if (!response.ok) throw new Error(`${method} failed`);
      return payload.result;
    };
    const chapters = await list('listChapters', [targetNovelId]) as Array<{ id: string; content: string; workflowMeta?: { reviewState?: { issues?: Array<{ status?: string }> } } }>;
    const current = chapters.find((chapter) => chapter.content.includes(polished));
    if (!current) throw new Error('未找到本次精修写入的目标章节');
    const versions = await list('listChapterVersions', [current.id]) as Array<{ content: string }>;
    return { content: current.content, versions, reviewStatuses: current.workflowMeta?.reviewState?.issues?.map((issue) => issue.status) || [] };
  }, { targetNovelId: novelId, polished: FULL_BROWSER_POLISHED });
  expect(persisted.content).toContain(FULL_BROWSER_POLISHED);
  expect(persisted.versions.some((version) => version.content === beforeAudit)).toBe(true);
  expect(persisted.reviewStatuses).toContain('applied');
  const persistedQuality = validateCompleteChapterDraftQuality(persisted.content);
  expect(persistedQuality.ok, persistedQuality.violations.join('；')).toBe(true);
  expect(persistedQuality.mechanicalReview?.status).toBe('pass');
  await page.screenshot({ path: 'test-results/full-browser-click-journey.png', fullPage: true });
  console.log(`[full-browser-click-journey] clicked=${clicked.join(' -> ')}`);
  console.log(`[full-browser-click-journey] proseLength=${content.length}`);
  console.log(`[full-browser-click-journey] prosePreview=${content.slice(0, 240)}`);
});
