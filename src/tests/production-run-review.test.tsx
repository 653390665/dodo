import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { ChapterProductionRun } from '../../shared/types';
import { ProductionRunReview } from '../components/ProductionRunReview';

const listChapterProductionRunsMock = vi.hoisted(() => vi.fn());

const completeDraft = (lead: string) => [
  `${lead} 雨水沿着旧城墙的裂缝落下，沈砚停在门槛外，先听见屋里三次短促的敲击，再看见桌边那盏不该亮着的灯。风从巷口灌进来，卷起地上的纸片，纸片背面留着与失踪档案相同的暗纹。`,
  '他没有立刻推门，而是把掌心贴在冰冷的门钉上，感到门后的震动每隔三次呼吸便重新响起。同行者催促他赶快进入，沈砚却发现脚边有一枚沾泥的铜扣，纹章与旧案卷宗上的标记完全一致。远处传来马蹄声，追踪者正在缩短包围圈。',
  '沈砚捡起铜扣，擦去表面的水珠，将它放在门缝前作为试探。屋内的人没有报出姓名，只把一截染血的袖口推到光线里，并低声说城北的钟已经停了。这个暗号意味着接头人仍然活着，却已经失去主动选择的余地。沈砚压低呼吸，决定先确认屋顶和后窗，再让同伴从另一侧绕行。',
  '门轴终于向内转动，炉火映出墙上摇晃的影子。沈砚跨过门槛时，梁上垂下一只没有点燃的信筒，线端轻轻摆动，像是在提醒他有人一直注视着这场接头。他没有伸手去碰信筒，只把铜扣留在桌面中央，等待真正的主人先做出回应。',
  '同伴在窗边发现一道新鲜的泥痕，泥痕从后院一路延伸到桌脚，说明追踪者已经提前进入过这间屋子。沈砚沿着痕迹查看，没有惊动角落里的陌生人，只将门闩重新扣紧，并把唯一的烛火移到墙侧。阴影随之改变位置，藏在梁上的呼吸声也短暂地停了一下。',
  '他打开信筒，里面没有密信，只有一片画着潮汐线的薄铜片。铜片边缘刻着三个日期，最晚的一个正是明日黎明。沈砚意识到这不是求援，而是一份逼迫接头人按时赴约的警告。屋外的马蹄声越来越近，他必须在追捕者撞门之前决定是否相信眼前的人。',
  '炉火忽然亮了一瞬，陌生人终于从阴影里走出，露出与旧档案照片相同的左眼伤痕。他没有解释失踪的地图，只把一把生锈的钥匙放在铜片旁边。沈砚收起钥匙，示意同伴守住后窗，然后转身面对已经逼近的脚步声，准备让今晚的接头变成一次反向追踪。',
  '门外的人开始撞击木板，灰尘从横梁上簌簌落下。沈砚没有拔刀，而是让同伴熄灭烛火，借着雨夜的微光辨认每个人的位置。陌生人指向地板下方的暗格，表示地图并不在身上，真正的线索藏在城北钟楼。',
  '暗格里只有一张被水浸透的路线图，几处标记已经模糊。沈砚把铜片贴在图纸上，潮汐线竟与河道的弯折完全重合，说明这座城的旧水道仍然能够通行。他记下入口位置，把图纸交给同伴保管，自己留在门边拖延时间。',
  '撞门声停了，外面的人改用短刃撬动门闩。沈砚听出对方的节奏与屋内暗号相反，立刻判断来者不是追捕队，而是想夺走铜片的第三方。他将钥匙插入墙上的锁孔，石墙向两侧退开一线，露出通往地下的阶梯。',
  '地下水道里传来沉闷的钟声，陌生人走在最前方，沈砚断后，同伴则负责记下每一个岔口。三人都没有再说话，因为他们知道从这一刻起，失踪地图不再只是旧案的证据，而会成为决定整座城市命运的筹码。',
  '钟声落下后，水道尽头亮起一盏青灯。沈砚让同伴贴着右墙前进，自己留意水面上不合常理的涟漪。',
  '青灯下放着一只木箱，箱盖被泥水压住，边角露出半张旧城地图。地图上的标记比铜片多出三处，说明有人仍在地下活动。',
  '同伴打开木箱，里面没有武器，只有一叠写着日期的药方。最早的一张来自封城前，最近的一张则写在昨夜，字迹与门外那封信完全一致。',
  '沈砚把药方摊在石阶上，逐张比对潮汐线。每当水位上涨一寸，药方上的某个字便会显出来，连成一条通往北门的路线。',
  '北门已经塌了半边，路线却绕过废墟，指向一座没有登记的桥。桥下传来桨声，船上有人用手电照了三次，像是在确认他们是否带着铜片。',
  '“别回应。”沈砚按住同伴的肩。他认出那种灯语属于守潮人，而守潮人从不单独行动。下一刻，桥柱后同时浮出四点微光。',
  '沈砚把一块石子投入水中，四点微光果然向声响靠拢。他趁机将药方塞进墙缝，留下铜片作为假线索，带着同伴退回刚才的岔路。',
  '退路比来时更窄，石壁上却多了一行新刻的字：真正的门在水上。沈砚看完没有解释，只取下鞋底的泥，沿着另一条水痕走去。',
  '那条水痕通向一扇悬在半空的木门。门后没有房间，只有一片被城墙围住的黑色水面，水面中央停着一艘挂有导师徽记的小舟。',
  '小舟自行靠岸，船篷下传来纸张翻动的声音。沈砚踏上船板，听见远处追捕声再次逼近，便将缰绳解开，让船驶向看不见灯火的水心。',
  '船离开桥洞后，城墙的倒影被水面切成一段段黑色的鳞片。沈砚没有回头，先把铜片贴在船舷上。潮汐线在月光下泛出一层极淡的蓝，蓝光指向船底一枚被钉死的木板。',
  '陌生人用刀尖撬开木板，下面藏着一只油布包。包里是三封没有封口的信，纸张来自同一批军用账册，其中一封的收件人写着沈砚的名字。字迹不是仿写，落笔处还留着他少年时惯用的顿笔。',
  '他拆开第一封信，里面只有一句话：不要让守潮人看见第二座钟。船篷外的桨声突然停住，水流却仍在推着小舟前进。沈砚把信递给同伴，示意对方检查船尾，自己则数起远处灯塔的闪烁次数。',
  '灯塔亮了两次，第三次迟迟没有出现。陌生人说那代表有人截断了信号，随后从袖口取出一粒盐晶，放进船边的水里。盐晶没有融化，反而沿着水纹朝北漂去，像一枚被看不见的手牵引的浮标。',
  '沈砚跟着盐晶调整船头，船底立刻传来金属摩擦声。小舟擦过一块藏在水下的铁栅，栅栏上挂着一只铁牌，刻着城防司早已废止的编号。编号末尾少了一笔，正是旧案中被撕掉的那页记录。',
  '同伴想把铁牌捞上来，沈砚却按住他的手。水下有第二道影子跟着小舟移动，影子的轮廓比船还长。陌生人丢下一枚铜钱，影子立刻缩进黑水，只在船尾留下几圈反常的漩涡。',
  '三人沉默了片刻。沈砚把第二封信压在膝上，询问陌生人为什么知道他的旧笔迹。对方没有回答，只指向船篷顶端。那里缝着一条褪色的红线，线头绕成一个只有他们师门才懂的结。',
  '红线的结意味着求见掌灯人。掌灯人已经失踪七年，所有人都以为他死在封城前夜。沈砚记得师父说过，真正的掌灯人不会点亮灯，只会让别人意识到黑暗里还有一条路。',
  '小舟撞上石岸，船篷里的油灯灭了。沈砚摸黑跳下船，脚下不是泥滩，而是一排向下延伸的青石台阶。台阶尽头传来孩童哼唱，曲调与城北钟楼的报时完全相同，却少了最后一个音。',
  '陌生人留在船上，催他们快走。沈砚让同伴沿左侧台阶查看，自己顺着歌声向下。墙面刻满历任守潮人的名字，最新的一行还没有刻完，刀痕停在“沈”字的起笔处。',
  '他用指腹掠过那道未完成的刻痕，石屑沾在手套上。身后的水道传来桨叶破水声，追兵终于找到入口。沈砚折断火折子，借着铜片微光继续向前，同时把第三封信塞进墙缝。',
  '墙缝里原本已经藏着一封信。两封信的纸边能够严丝合缝地拼在一起，拼出的图案是一座倒置的钟。沈砚忽然明白，第二座钟不是建筑，而是藏在城防司档案中的一份名单。',
  '同伴从左侧回来，带回一枚刻着鸢尾花的骨哨。他说台阶上没有人，只有一扇被石蜡封住的小门。沈砚吹响骨哨，石门没有开启，远处的孩童歌声却改了调，最后一个音补了回来。',
  '补全的音节让墙上的刻痕同时泛白。未完成的“沈”字后面显出一行细字：掌灯人只等一次选择。沈砚把骨哨交给同伴，决定由自己打开石门，因为门后的机关显然与他的血脉有关。',
  '石蜡融化得很慢，门缝里渗出一股带铁锈味的冷气。沈砚将铜扣、钥匙和铜片依次放进三个凹槽，门内传来齿轮咬合声。机关没有立刻放行，反而弹出一枚写着日期的黑色筹码。',
  '日期是封城当晚。那天沈砚的师父曾命令他留在南门，而师父本人却去了北门。筹码背面刻着一段坐标，坐标终点正是他们刚刚离开的那座无名桥。',
  '追兵的脚步踏上第一层台阶。沈砚将筹码收入掌心，让同伴退到石门之后，随后故意把铜片扔向另一条通道。金属撞击声在水道里反复回荡，把追兵引向错误的方向。',
  '石门合拢前，他看见陌生人站在船头，没有跟上来。对方抬手做出师门旧礼，手腕上的伤痕与档案照片相同。沈砚想出声询问，门缝却只剩下一线光，船和人都被黑水吞没。',
  '门后是一间窄小的值守室，墙上悬着七只停摆的铜钟。每只钟下都有一份未寄出的报告，报告末尾统一盖着掌灯人的私印。沈砚翻到最上面那份，发现报告记录的日期竟然是明天。',
  '报告写着：北门桥下会有一艘小舟，船上三人，其中一人会带来第二座钟。沈砚抬头看向同伴，意识到这场接头早已被写进未来。值守室外，第一声追兵的呼喊穿透石门，新的选择已经逼到眼前。',
  '值守室的桌面铺着一张潮湿的值班表，墨迹被水汽晕开，却留下七个清晰的缺口。沈砚把日期逐一对应，发现每个缺口都落在城中一次失火的夜晚。那些火灾从未登上官府的记录，却都发生在掌灯人失踪后的三个月里。',
  '同伴从柜底找到一枚木制印章，印面刻着鸢尾花和半圈齿轮。沈砚用铜片蘸取灯油，在纸上拓出印痕，纸下随即显出一条隐藏的水线。水线绕过北门，终点落在他从未去过的旧天文台。',
  '外面的撞击声停了，追兵似乎在等候命令。沈砚把七份报告按时间排开，最早的一份提到守潮人，最后一份却只写着“换人”。这个词让同伴想起城防司的轮值制度，也让沈砚意识到师父可能并非唯一的掌灯人。',
  '他将地图和报告叠在一起，纸面上的水线终于闭合成环。环心缺少一枚标记，正好对应油布包里那封写着他名字的信。沈砚没有拆第二次，而是把信放到灯火上方，让背面的隐字慢慢浮出来。',
  '隐字只有四个字：先救船夫。沈砚愣了一下，窗外随即传来落水声。他推开侧门，看见一名穿灰衣的人被绳索拖进水渠，正是刚才留在小舟上的陌生人。追兵的火把越过石阶，照亮了对方手腕上的旧伤。',
  '同伴想关门拖延，沈砚已经跃下石阶。他用钥匙割断绳结，将陌生人拽到岸边。对方咳出几口水，第一句话不是道谢，而是告诉他：值守室的七只钟里，有一只从来没有停过。',
  '沈砚回头望向室内，最右侧的铜钟果然微微摆动。钟摆每次落下，墙上的报告便少一行字。石门外的追兵重新逼近，他只能带着两人穿过天文台的暗道，把尚未读完的未来留在身后。',
  '暗道尽头的石梯通向废弃天文台，穹顶裂缝漏下冷白的月光。陌生人指着地上的星盘，说真正的名单藏在今日尚未升起的那颗星下。沈砚记住方位，握紧筹码，带着同伴继续向北门深处走去。',
  '天文台的门锁从里面落下，追兵的火把被隔在石门另一侧。沈砚听见星盘下传来细小的纸页翻动声，伸手按住同伴的肩，等那颗尚未升起的星在裂开的穹顶后露出第一点光。',
].join('\n\n');

vi.mock('../lib/chapter-production-db-client', () => ({
  listChapterProductionRuns: listChapterProductionRunsMock,
}));

function createRun(
  id: string,
  status: ChapterProductionRun['status'],
  draftContent: string,
): ChapterProductionRun {
  return {
    id,
    novelId: 'novel-1',
    status,
    userIntent: `${id} intent`,
    sceneBeats: `${id} beats`,
    draftContent,
    styleAudit: '',
    continuityReport: {
      score: 100,
      auditMeta: { status: 'pass', source: 'model' },
      issues: [],
      proposedPatch: {
        characterUpdates: [],
        itemUpdates: [],
        foreshadowingUpdates: [],
        timelineEventsToCreate: [],
        foreshadowingsToCreate: [],
      },
    },
    createdAt: id === 'old-run' ? 1 : 2,
    updatedAt: id === 'old-run' ? 1 : 2,
  };
}

function renderReview(
  run: ChapterProductionRun | null,
  running: boolean,
  onApply = vi.fn(),
  onStop = vi.fn(),
) {
  render(
    <ProductionRunReview
      run={run}
      userIntent=""
      running={running}
      applying={false}
      novelId="novel-1"
      onIntentChange={vi.fn()}
      onStart={vi.fn()}
      onStop={onStop}
      onApply={onApply}
    />,
  );
  return onApply;
}

describe('ProductionRunReview', () => {
  beforeEach(() => {
    listChapterProductionRunsMock.mockReset();
  });

  test('shows and invokes the production cancel action only while running', () => {
    listChapterProductionRunsMock.mockResolvedValue([]);
    const onStop = vi.fn();
    const { unmount } = render(
      <ProductionRunReview
        run={createRun('running-run', 'running', 'partial preview')}
        userIntent=""
        running
        applying={false}
        novelId="novel-1"
        onIntentChange={vi.fn()}
        onStart={vi.fn()}
        onStop={onStop}
        onApply={vi.fn()}
      />,
    );

    const cancelButton = screen.getByRole('button', { name: '取消生产' });
    fireEvent.click(cancelButton);
    expect(onStop).toHaveBeenCalledTimes(1);

    unmount();
    render(
      <ProductionRunReview
        run={createRun('review-run', 'review_required', 'preview')}
        userIntent=""
        running={false}
        applying={false}
        novelId="novel-1"
        onIntentChange={vi.fn()}
        onStart={vi.fn()}
        onStop={onStop}
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: '取消生产' })).toBeNull();
  });

  test('does not expose an older review result while a new production run is active', async () => {
    const oldRun = createRun('old-run', 'review_required', 'old completed draft');
    const newRun = createRun('new-run', 'running', '');
    listChapterProductionRunsMock.mockResolvedValue([oldRun]);
    const onApply = renderReview(newRun, true);

    await waitFor(() => expect(listChapterProductionRunsMock).toHaveBeenCalledWith('novel-1'));

    expect(screen.queryByText('old completed draft')).toBeNull();
    const applyButton = screen.getByRole('button', { name: '接受并写入' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  test('does not apply a recovered historical run as the active run', async () => {
    const oldRun = createRun('old-run', 'review_required', 'old completed draft');
    const stalePlaceholder = createRun('new-run', 'running', '');
    listChapterProductionRunsMock.mockResolvedValue([oldRun]);
    const onApply = renderReview(stalePlaceholder, false);

    await screen.findByText('old completed draft');

    const applyButton = screen.getByRole('button', { name: '接受并写入' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  test('allows applying the completed active review run', async () => {
    const activeRun = createRun('active-run', 'review_required', completeDraft('active completed draft'));
    listChapterProductionRunsMock.mockResolvedValue([]);
    const onApply = renderReview(activeRun, false);

    await waitFor(() => expect(listChapterProductionRunsMock).toHaveBeenCalledWith('novel-1'));
    const applyButton = screen.getByRole('button', { name: '接受并写入' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(false);
    fireEvent.click(applyButton);
    expect(onApply).toHaveBeenCalledWith(activeRun);
  });

  test('blocks applying a failed audit and explains that the draft needs polish', async () => {
    const failedRun = createRun('failed-audit-run', 'review_required', completeDraft('failed audit draft'));
    failedRun.continuityReport.auditMeta = { status: 'fail', source: 'model', score: 52 };
    listChapterProductionRunsMock.mockResolvedValue([]);
    const onApply = renderReview(failedRun, false);

    const applyButton = await screen.findByRole('button', { name: '接受并写入' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('审稿未通过');
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  test('blocks applying a run with unknown provenance and explains that it must be regenerated', async () => {
    const unknownSourceRun = createRun('unknown-source-run', 'review_required', completeDraft('unknown source'));
    unknownSourceRun.continuityReport.auditMeta = { status: 'pass' } as unknown as typeof unknownSourceRun.continuityReport.auditMeta;
    listChapterProductionRunsMock.mockResolvedValue([]);
    const onApply = renderReview(unknownSourceRun, false);

    const applyButton = await screen.findByRole('button', { name: '接受并写入' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('来源未知');
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  test('blocks applying a fallback draft and preserves the retry path', async () => {
    const fallbackRun = createRun('fallback-run', 'review_required', completeDraft('fallback preview'));
    fallbackRun.continuityReport.auditMeta = { status: 'not_run', source: 'fallback' };
    listChapterProductionRunsMock.mockResolvedValue([]);
    const onApply = renderReview(fallbackRun, false);
    const applyButton = await screen.findByRole('button', { name: '接受并写入' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('保底草稿未经过模型审稿');
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  test('requires a second confirmation before applying an unknown audit', async () => {
    const activeRun = createRun('unknown-run', 'review_required', completeDraft('preview'));
    activeRun.continuityReport.auditMeta = { status: 'unknown', source: 'model' };
    listChapterProductionRunsMock.mockResolvedValue([]);
    const onApply = renderReview(activeRun, false);
    const applyButton = await screen.findByRole('button', { name: '接受并写入' });
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认写入' }));
    expect(onApply).toHaveBeenCalledWith(activeRun);
  });

  test('blocks applying when audit metadata is missing', async () => {
    const legacyRun = createRun('legacy-run', 'review_required', completeDraft('preview'));
    delete legacyRun.continuityReport.auditMeta;
    listChapterProductionRunsMock.mockResolvedValue([]);
    const onApply = renderReview(legacyRun, false);
    const applyButton = await screen.findByRole('button', { name: '接受并写入' });
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('来源未知');
    expect(screen.queryByRole('button', { name: '确认写入' })).toBeNull();
  });

  test('keeps unknown source blocked when the displayed run changes', async () => {
    const firstRun = createRun('first-run', 'review_required', completeDraft('first preview'));
    const secondRun = createRun('second-run', 'review_required', completeDraft('second preview'));
    delete firstRun.continuityReport.auditMeta;
    delete secondRun.continuityReport.auditMeta;
    listChapterProductionRunsMock.mockResolvedValue([]);
    const onApply = vi.fn();
    const { rerender } = render(
      <ProductionRunReview
        run={firstRun}
        userIntent=""
        running={false}
        applying={false}
        novelId="novel-1"
        onIntentChange={vi.fn()}
        onStart={vi.fn()}
        onApply={onApply}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '接受并写入' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(
      <ProductionRunReview
        run={secondRun}
        userIntent=""
        running={false}
        applying={false}
        novelId="novel-1"
        onIntentChange={vi.fn()}
        onStart={vi.fn()}
        onApply={onApply}
      />,
    );
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('来源未知'));
    expect(screen.queryByRole('button', { name: '确认写入' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '接受并写入' }));
    expect(onApply).not.toHaveBeenCalled();
  });

  test('does not show an unverified score in production history', async () => {
    const unknownRun = createRun('history-unknown', 'review_required', 'preview');
    unknownRun.continuityReport.score = undefined;
    unknownRun.continuityReport.auditMeta = { status: 'unknown', source: 'model' };
    listChapterProductionRunsMock.mockResolvedValue([unknownRun]);

    renderReview(null, false);

    expect(await screen.findByText('未评分')).toBeTruthy();
    expect(screen.queryByText('undefined/100')).toBeNull();
  });

  test('hides the legacy start action when writing-style governance owns generation', () => {
    listChapterProductionRunsMock.mockResolvedValue([]);
    render(
      <ProductionRunReview
        run={null}
        userIntent=""
        running={false}
        applying={false}
        novelId="novel-1"
        onIntentChange={vi.fn()}
        onStart={vi.fn()}
        onApply={vi.fn()}
        showStartAction={false}
      />,
    );
    expect(screen.queryByRole('button', { name: '开始生产一章' })).toBeNull();
  });
});
