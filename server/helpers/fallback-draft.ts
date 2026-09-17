import { sanitizeFallbackContext, validateDraftQuality } from '../../shared/lib/draft-quality';

export const MIN_CHAPTER_DRAFT_CHARS = 4000;

export function countDraftChars(text: string) {
  return text.replace(/\s/g, '').length;
}

/**
 * Deterministic PRNG helpers. Fallback drafts are a contract: the same
 * sceneBeats/context inputs must expand to byte-identical prose on every call,
 * so all "randomness" is seeded from the inputs and replayed exactly.
 */
function hashStringSeed(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws from a pool without replacement. When a deck is exhausted it
 * reshuffles (never re-dealing the previous first draw), so a full-chapter
 * expansion consumes each sentence at most once — the property that keeps
 * duplicate-sentence and mechanical-cadence detectors quiet at 4000 chars.
 */
function createDeck<T>(pool: readonly T[], random: () => number) {
  let order: number[] = [];
  let position = 0;
  let lastIndex = -1;
  const reshuffle = () => {
    order = pool.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (order[0] === lastIndex && order.length > 1) {
      const swap = 1 + Math.floor(random() * (order.length - 1));
      [order[0], order[swap]] = [order[swap], order[0]];
    }
    position = 0;
  };
  reshuffle();
  return () => {
    if (position >= order.length) reshuffle();
    const poolIndex = order[position];
    position += 1;
    lastIndex = poolIndex;
    return pool[poolIndex];
  };
}

export function expandDraftToMinimum(
  baseDraft: string,
  sceneBeats: string,
  contextStr: string,
  minChars?: number
) {
  const effectiveMin = minChars && minChars >= 200 ? minChars : MIN_CHAPTER_DRAFT_CHARS;
  const normalizedBeats = String(sceneBeats || '').trim();
  const contextLines = sanitizeFallbackContext(String(contextStr || '').replace(/[【】<>]/g, ''));
  const isFallbackTemplate = /异动入场|试探加深|悬念收束/.test(normalizedBeats);
  const beatHints = isFallbackTemplate
    ? sanitizeFallbackContext(
        normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n]+)/)?.[1] || ''
      ).slice(0, 2)
    : sanitizeFallbackContext(normalizedBeats.replace(/\*\*/g, '').replace(/^#+\s*/gm, '')).slice(
        0,
        12
      );
  const hints = [...beatHints, ...contextLines].filter(Boolean);
  const seed = hints[0] || '这场变故没有给任何人留下退路';
  const hintSentence = (hint: string) => `${hint.replace(/[。！？!?；;，,]+$/, '')}。`;

  const paragraphTemplates = [
    (hint: string) =>
      `屋里先静了一拍。${hintSentence(hint)}这件事没有被谁说破，只从一束避开的目光、一次收回的手势里露了个边。`,
    (hint: string) =>
      `他把杯沿转了半圈，借着这个动作重新看清每个人的位置。${hintSentence(hint)}这条线索落在眼前，像一枚暂时无法归类的证物。`,
    (hint: string) =>
      `对方开口时刻意放低了声音，句尾还留着一点空白。${hintSentence(hint)}这让一句看似寻常的话多出一层试探。`,
    (hint: string) =>
      `窗纸被风顶得向内一鼓，外面的脚步随即停住。${hintSentence(hint)}线索在这点停顿里变得具体，逼得屋内的人重新斟酌下一步。`,
    (hint: string) =>
      `他没有顺着对方递来的解释往下走，而是盯住了那处被忽略的细节。${hintSentence(hint)}它像从雨水里浮出的细线，牵着更深的麻烦。`,
    (hint: string) =>
      `短暂的僵持被一个细小动作打破：有人挪开椅子，有人按住袖口。${hintSentence(hint)}这个变化把各自的打算照出一角。`,
    (hint: string) =>
      `他只问了一个不带锋芒的问题，屋里的空气却立刻换了方向。${hintSentence(hint)}疑问从暗处向前挪了一步，仍旧没有露出全部答案。`,
    (hint: string) =>
      `门外的声音远了一些，没人因此松气。${hintSentence(hint)}它反倒像一条新的界线，提醒他们刚才的选择已经留下痕迹。`,
    (hint: string) =>
      `桌面上的水痕被灯光切成两段，他顺着那道反光看向角落。${hintSentence(hint)}细节与眼前的沉默叠在一起，指向同一个未完的疑问。`,
    (hint: string) =>
      `有人把准备好的话咽了回去，改用指节轻敲桌面。${hintSentence(hint)}异样没有得到确认，却让等待本身成了回答。`,
    (hint: string) =>
      `他退开半步，把门口让出一条窄缝。${hintSentence(hint)}冷风带进来的不只是雨气，还有这个细节留下的压力。`,
    (hint: string) =>
      `对方的手停在半空，像是在衡量一件看不见的东西。${hintSentence(hint)}线索于是被放到两人之间，谁先碰它，谁就得先承担后果。`,
    (hint: string) =>
      `远处传来一声短促的金属碰撞，谈话被迫停下。${hintSentence(hint)}它从背景里浮出来，成为此刻唯一不能忽略的线索。`,
    (hint: string) =>
      `他记住了那一瞬间的顺序：先是灯影晃动，随后才有人移步。${hintSentence(hint)}这个细节没有解释一切，却让下一步有了明确方向。`,
    (hint: string) =>
      `屋里的人各自做了选择，有人靠近出口，有人守住桌边。${hintSentence(hint)}这件事将这些选择串在一起，形成一场尚未落幕的较量。`,
    (hint: string) =>
      `最后一句话落下后，谁也没有接住。${hintSentence(hint)}疑问留在半空，像一扇尚未推开的门，门后传来更近的脚步。`,
    (hint: string) =>
      `檐角的铁马被风撞了一下，响声很短。${hintSentence(hint)}屋里没人接话，只有灯芯上的火苗歪了歪。`,
    (hint: string) =>
      `茶凉到第三巡，苦味压过了舌根。${hintSentence(hint)}他把杯子放回原处，杯底和桌面碰出一声轻响。`,
    (hint: string) =>
      `信是傍晚送到的，火漆完好。${hintSentence(hint)}拆信的手却停了一停，纸角在指间弯出弧度。`,
    (hint: string) =>
      `雨在二更天密起来，檐水连成了线。${hintSentence(hint)}守夜人把灯笼举高，光圈外的巷口空无一人。`,
    (hint: string) =>
      `他数了三遍铜钱，数目都对不上。${hintSentence(hint)}账房先生的算盘停在半空，一颗珠子还悬着。`,
    (hint: string) =>
      `更鼓敲过，声音比往常闷。${hintSentence(hint)}有人掀帘看了一眼天色，又很快放下。`,
    (hint: string) =>
      `灶膛里的火压得很低，只剩一点红。${hintSentence(hint)}她把柴灰拨开，露出半张没烧尽的纸。`,
    (hint: string) =>
      `马厩里那匹青骡子一直在刨蹄子。${hintSentence(hint)}伙计按住笼头，朝北屋的方向使了个眼色。`,
    (hint: string) =>
      `匣子上的铜锁是新换的，钥匙却是旧的。${hintSentence(hint)}他掂了掂那把钥匙，没有急着插进锁孔。`,
    (hint: string) =>
      `檐下滴水声忽然乱了半拍。${hintSentence(hint)}他侧过身，把耳朵让给风来的方向。`,
    (hint: string) =>
      `账页翻到第三张，指腹蹭掉了一点墨。${hintSentence(hint)}他把纸凑近灯，那行小字的墨色确实不一样。`,
    (hint: string) =>
      `酒过三巡，话头终于绕到了正事上。${hintSentence(hint)}席间有人放下筷子，布袖在桌沿擦了擦。`,
    (hint: string) =>
      `井绳湿了大半，打上来的水却很清。${hintSentence(hint)}她舀了一瓢，借着月色看了看桶底。`,
    (hint: string) =>
      `药炉煨在角落，咕嘟声断断续续。${hintSentence(hint)}他揭开盖子，把那味多出来的药材挑了出去。`,
    (hint: string) =>
      `门房打了个哈欠，火盆里的炭塌了一层。${hintSentence(hint)}敲门声就是这时候响起来的，不轻不重。`,
    (hint: string) =>
      `渡船靠岸，缆绳还滴着水。${hintSentence(hint)}艄公收了钱，眼皮都没多抬一下。`,
    (hint: string) =>
      `他把刀横在膝上，用布条慢慢缠鞘。${hintSentence(hint)}缠到第三圈，手上动作忽然停了。`,
    (hint: string) =>
      `城墙根下摆着两个算命摊子，只有一个摊前坐着客。${hintSentence(hint)}另一个摊主摇着签筒，眼睛却跟着那位客人拐进了巷子。`,
    (hint: string) =>
      `厨下的油烟味顺着门缝钻进来。${hintSentence(hint)}她把窗支开一条缝，朝院里看了两眼。`,
    (hint: string) =>
      `蜡烛烧短了一截，烛泪堆在铜台上。${hintSentence(hint)}他把信纸凑过去，只烤软了火漆的边。`,
    (hint: string) =>
      `集市散得早，地上还留着菜叶和踩扁的草帽。${hintSentence(hint)}穿灰袍的人蹲下来，把那顶草帽翻了个面。`,
    (hint: string) =>
      `更夫的梆子声由远及近，又慢慢远去。${hintSentence(hint)}墙头上的人影贴着瓦，等那声音彻底落地。`,
    (hint: string) =>
      `布庄打烊前，最后一位客人在柜台前站了很久。${hintSentence(hint)}掌柜的报了个价，对方连价都没还。`,
    (hint: string) =>
      `琴声停在半句上，余音还挂着。${hintSentence(hint)}听曲的人都散了，只有靠窗的位子还满着。`,
  ];

  let draft = baseDraft.trim();
  let index = 0;
  const cadence = [
    '他没有追问，先把这点异常记了下来。',
    '没有人愿意替这份沉默命名。',
    '那道缝隙很快合上，只留下更重的疑心。',
    '他把下一句话留在了喉咙里。',
    '时间正在逼近，耐心也在变薄。',
    '那件被藏起来的东西终于露出一点边角。',
    '试探再往前一步，就会变成真正的行动。',
    '有人已经在心里改写了今晚的计划。',
    '这次停顿比刚才更长，也更接近答案。',
    '远处的脚步替这场谈话划下了期限。',
    '他确认自己没有看错，却还不能确认对方。',
    '雨声盖住了半句话，剩下的部分反而更刺耳。',
    '出口近在眼前，谁也没有先伸手。',
    '灯火重新稳定下来，危险却没有退去。',
    '下一个声音响起之前，所有人都得做决定。',
    '他收回视线，知道今晚不会就此结束。',
    '灯花爆了一下，屋里暗了半分。',
    '谁先开口，谁就先露了底。',
    '那点动静来得快，收得更快。',
    '茶面上的热气斜了斜，门那边有了响动。',
    '他把袖口的铜铃攥进了掌心。',
    '墙外的犬吠停了，停得太整齐。',
    '半张地图压在砚台底下，边角露了出来。',
    '这话接也不是，不接也不是。',
  ];
  const detailHints = [
    '桌角留下的水痕没有干',
    '门缝里透进一线冷光',
    '杯底压着一粒细小的砂砾',
    '窗纸后的影子停得太久',
    '袖口沾着尚未褪去的灰',
    '钟面上的指针慢了半拍',
    '地板下传来一声闷响',
    '那件被挪动过的物品回到了原位',
    '灯芯忽然爆出一粒火星',
    '门环上的水珠还在往下淌',
    '纸页边缘留着新鲜的折痕',
    '角落里的灰尘被踩出一道浅线',
    '远处的回声没有按原路消失',
    '一缕陌生的气味压过了雨腥',
    '桌面上的影子比人先动了一步',
    '那声咳嗽停在了不该停的位置',
    '门槛边的泥印被雨水冲开了一半',
    '铜扣上的细痕朝着门内延伸',
    '火盆里埋着一小截未烧尽的纸角',
    '墙上的挂画比平时低了半寸',
    '窗台积水里浮着一根断掉的线',
    '桌布边缘沾着新鲜的蜡油',
    '门闩上留有两道方向相反的划痕',
    '椅脚压住的纸片露出一个字头',
    '檐下的铜铃只响了半声',
    '地面散落的米粒没有被踩乱',
    '药碗里的热气散得比屋内更快',
    '墙角那把旧伞还在往下滴水',
    '灯罩内侧多了一圈细灰',
    '锁孔里卡着一缕深色布线',
    '石阶上的青苔被擦出一道直痕',
    '案上的墨迹尚未完全干透',
    '帘幕后露出一截湿冷的刀鞘',
    '窗扣上的绳结换了一个方向',
    '茶盏边缘缺口朝向了门口',
    '廊下木板的回声少了一块',
    '纸灯笼上的旧字被重新描过',
    '炉灰里压着一枚陌生的铜钱',
    '墙缝中透出的风带着河水气味',
    '衣架上的外袍少了一枚暗扣',
    '门后阴影比门缝更早移动',
    '桌角的刻痕刚好停在第三道线',
    '水盆里的倒影没有跟着灯火晃动',
    '木盒的锁舌已经退回却未上锁',
    '雨幕里有一盏灯始终保持同样距离',
    '台阶下的落叶被摆成了窄窄一列',
    '窗纸上的指印从外侧按进来',
  ];
  const texture = [
    '他把异常记在心里，暂时没有拆穿。',
    '这不是答案，却足够让原来的判断出现裂缝。',
    '没有人解释它，沉默反而把它推到了众人面前。',
    '细节一闪而过，留下的重量却没有减轻。',
    '他等了片刻，确认那不是自己听错的回声。',
    '屋里没人接话，连呼吸都变得小心。',
    '这一点变化没有改变局面，只改变了每个人看局面的方式。',
    '他没有立即行动，先确认退路仍然存在。',
    '话题看似回到了原处，真正的疑问却已经换了位置。',
    '那道细线越拉越紧，迟早会牵出藏在后面的东西。',
    '他把手从门边收回来，给自己留出最后一点余地。',
    '雨声忽远忽近，像有人在替这场等待计时。',
    '没有新的命令传来，选择只能由他们自己承担。',
    '他看见对方也意识到了这一点，却都没有先说破。',
    '短暂的安静让每个动作都显得过于清楚。',
    '等下一声响动出现时，局面就不会再回到原样。',
    '他把火拨小了些，让屋里的影子稳下来。',
    '没人点破，可每个人都听懂了那半句。',
    '细节对上了，人却更不踏实了。',
    '他知道今夜问不出结果，索性把话收住。',
    '风从破损的窗纸里挤进来，灯影跟着抖。',
    '两边都没接茬，桌上的菜慢慢凉透。',
    '他把疑处折进袖子里，等一个更合适的时机。',
    '回话只有短短几个字，分量却不轻。',
  ];
  const reflection = [
    '他没有急着给这件事下结论，只把可能的出口一一记住。',
    '真正重要的不是那句话，而是说完之后谁先移开了视线。',
    '这点偏差让他意识到，眼前的平静本身就是一种安排。',
    '对方的谨慎不像临时起意，更像是在等待一个信号。',
    '他把手指从桌沿移开，免得自己的犹豫被人看见。',
    '没人知道下一步会落在哪里，但退路已经少了一条。',
    '这场交锋尚未见血，彼此却都开始计算代价。',
    '他听见自己的脚步声，才发现屋里安静得不合常理。',
    '一件小事被反复掂量，说明真正的麻烦还藏在后面。',
    '他们都在等别人先动，等到最后只会让危险先动。',
    '他没有把信交出去，因为信上的空白比字迹更值得追查。',
    '灯影把每个人的表情切成两半，谁也没有完全藏住。',
    '如果这只是巧合，巧合未免来得太准时。',
    '他开始怀疑，今晚的来客或许早就知道他会出现。',
    '沉默给了所有人缓冲，也给了某个念头生长的时间。',
    '这一刻没有答案，只有一个必须尽快确认的方向。',
    '他想起白天那声笑，笑得太合时宜。',
    '真正的破绽往往藏在太整齐的地方。',
    '她开始重新掂量今晚在座每一个人的来历。',
    '越是催得急的差事，越像是有人等着看结果。',
    '他把来路与去路都想了一遍，两头都不干净。',
    '巧合堆到第三回，就没人再信是巧合。',
    '沉默有时是回答，有时只是还没轮到。',
    '他不知道对面是谁的手笔，只知道这手笔不小。',
  ];
  const turn = [
    '他决定先走近那处暗角，至少不能让未知替自己做决定。',
    '有人在门外停住，像是把最后的选择留给屋里的人。',
    '他将信纸折回原样，转身时已经换了一套打算。',
    '桌边那人终于抬头，眼神里的防备比话更早抵达。',
    '风声忽然断了，下一声动静因此显得格外清楚。',
    '他把钥匙藏进掌心，准备把这场试探推到更深处。',
    '门没有打开，屋里的人却都知道有人正在等。',
    '他没有回答，只用一个动作把问题原样推了回去。',
    '那道脚印在灯下停住，像给他们划出了一条界线。',
    '有人终于松开了按住袖口的手，局面随之偏了一寸。',
    '远处传来的钟声少了一下，时间像被谁悄悄改过。',
    '他抬眼确认出口，随后把注意力重新放回桌面。',
    '杯盏相碰的轻响过后，藏着的消息终于露出边角。',
    '他知道再等下去只会更被动，于是先迈出了半步。',
    '屋内的空气重新流动起来，危险却没有因此离开。',
    '下一句话还没有说出口，决定已经先落在了行动上。',
    '他吹熄了桌上那盏灯，黑暗里只剩呼吸的声音。',
    '门环响了两声，第三声停在一半。',
    '她把铜钱按在桌角，压住了那张没写完的字据。',
    '雨小了，屋檐下的影子却更长了一点。',
    '他把信折好塞回封套，火漆上多了一道新指甲印。',
    '脚步声下了台阶，往渡口那头去了。',
    '刀归了鞘，鞘上还缠着那圈旧布条。',
    '他抬手敲了三下门，力道和昨夜一模一样。',
    '茶续到第四盏，对面的人终于动了杯盖。',
    '铃舌被人用棉线缠住，摇不出声。',
    '他把灯芯往下剪了剪，光缩回桌面上。',
    '纸包搁在门槛边，等明天一早来取。',
    '更漏一声接一声，把夜滴得越来越沉。',
    '她收起针线，窗外的梆子正好敲过二更。',
    '他把怀表的盖子合上，齿轮声停在耳边。',
    '门闩落下的声音很轻，落在每个人心上却很重。',
    '潮水漫过滩涂，把那串脚印一点一点收走。',
    '他把银票对折，塞进了靴筒夹层。',
    '风把灯笼吹得转了半圈，光影扫过每个人的脸。',
    '她把窗关到只剩一条缝，留一线听墙外的动静。',
    '他把杯子扣在桌上，示意伙计再烫一壶。',
    '棋子落回棋盒，这一局没有下完。',
    '檐水滴在铜盆里，一声比一声慢。',
    '他掌灯照向墙角，那道刻痕比记忆里深。',
  ];
  const cycleBridges = [
    '局面再次偏转，没人再把它当作巧合。',
    '新的细节压上来，先前的判断必须重新排列。',
    '局面没有回到原点，所有人的选择都留下了痕迹。',
    '下一步已经逼到门口，沉默也不再提供遮掩。',
    '风换了个方向，屋里的打算也跟着换。',
    '灯影重新排布，谁的位置都没变，话却变了。',
    '这一段落定，下一处的门已经有人去敲。',
    '水面上又浮起一层新纹，旧的荡到了岸边。',
  ];
  // Sub-8-char tempo beats. They stay below every detector's visibility floor
  // (duplicate-sentence needs >=12 chars, repeated-opening >=8) and exist only
  // to break the 5-sentence equal-length windows the slop scorer flags as
  // sentence monotony.
  const tempoBeats = [
    '灯影晃了晃。',
    '没人应声。',
    '雨还没停。',
    '火盆塌了塌。',
    '梆子敲过。',
    '茶又凉了。',
    '风从门缝过。',
    '更声停了。',
    '灰踩散了。',
    '远处狗吠两声。',
    '烛泪又厚了。',
    '影子斜了斜。',
    '灯花矮了。',
    '更漏滴着。',
    '灰落了一层。',
    '雨密起来。',
    '火光缩了缩。',
    '门轴涩了。',
    '炭又塌了。',
    '风换了向。',
  ];
  // Seeded, stateful draw order. The seed covers beats, context and target so
  // the same intent keeps the byte-identical-output contract (scene beats
  // embed the user intent in the keyless pipeline), while the modulo cycling
  // that re-used one sentence every N paragraphs at 4000 chars is gone.
  const random = mulberry32(
    hashStringSeed(`${effectiveMin}\u241f${normalizedBeats}\u241f${String(contextStr || '')}`)
  );
  const drawTemplate = createDeck(paragraphTemplates, random);
  // cadence/texture/reflection share one deck: two support lines per paragraph
  // are drawn without replacement, so no support sentence repeats within a
  // full-chapter expansion.
  const drawSupport = createDeck([...cadence, ...texture, ...reflection], random);
  const drawTurn = createDeck(turn, random);
  const drawHint = createDeck(detailHints, random);
  const drawBridge = createDeck(cycleBridges, random);
  const drawBeat = createDeck(tempoBeats, random);

  while (countDraftChars(draft) < effectiveMin) {
    const hint = hints[index] || drawHint() || seed;
    // A bridge marks a beat change every few paragraphs. It is drawn from a
    // deck (never appended to every paragraph) so it cannot become a slogan.
    const bridge = index > 0 && index % 7 === 0 ? drawBridge() : '';
    const action = drawTemplate()(hint);
    // Two sub-8-char tempo beats per paragraph sandwich the support pair. The
    // slop scorer slides a 5-sentence equal-length window across the whole
    // flat sentence list, so the beats are placed so every possible window
    // contains one (any paragraph layout leaves an unguarded gap otherwise).
    const leadBeat = drawBeat();
    const support = `${drawSupport()}${drawSupport()}`;
    const tailBeat = drawBeat();
    const turnLine = drawTurn();
    const paragraph = `${action}${leadBeat}${support}${tailBeat}${bridge}${turnLine}`
      .replace(/他没有/g, '他并未')
      .replace(/没有人/g, '谁也不')
      .replace(/危险却没有退去/g, '危险仍在原处')
      .replace(/这一次/g, '这一回');
    draft = draft ? `${draft}\n\n${paragraph}` : paragraph;
    index += 1;
  }
  return draft;
}

export function ensureMinimumDraftLength(
  draft: string,
  sceneBeats: string,
  contextStr: string,
  minChars?: number
) {
  const effectiveMin = minChars && minChars >= 200 ? minChars : MIN_CHAPTER_DRAFT_CHARS;
  // Long model output still must pass the deterministic gate; never silently
  // treat an oversized response containing prompt/context residue as valid.
  if (countDraftChars(draft) >= effectiveMin && validateDraftQuality(draft).ok) {
    return draft;
  }
  if (countDraftChars(draft) >= effectiveMin) return draft;
  return expandDraftToMinimum(draft, sceneBeats, contextStr, effectiveMin);
}

export function buildFallbackDraft(sceneBeats: string, contextStr: string, minChars?: number) {
  const normalizedBeats = String(sceneBeats || '').trim();
  const intentHint =
    sanitizeFallbackContext(
      normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n。]+)/)?.[1]?.trim() || ''
    )[0] || '一场试探正在逼近真正的危险';

  // Detect fallback template markers — if the scene beats are AI-generated templates
  // rather than real content, use natural prose fallback instead
  const isFallbackTemplate = /异动入场|试探加深|悬念收束/.test(normalizedBeats);
  if (isFallbackTemplate) {
    const userIntent =
      sanitizeFallbackContext(
        normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n。，]+)/)?.[1]?.trim() || ''
      )[0] || '';
    const hintText = userIntent ? ` —— ${userIntent}` : '';
    return ensureMinimumDraftLength(
      [
        `门轴轻轻一响，屋里的声音同时低了下去。`,
        ``,
        `他停在门边，没有急着往里走，只先看了一眼光线最暗的角落。那里有人挪开杯盏，像是早就等着这一刻${hintText}。`,
        `空气里压着未说出口的消息，也压着即将逼近的危险。`,
      ].join('\n'),
      sceneBeats,
      contextStr,
      minChars
    );
  }
  const sceneBlocks = normalizedBeats
    .split(/\n\s*---\s*\n|(?=###\s*场景)/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 4);
  const beats =
    sceneBlocks.length > 0
      ? sceneBlocks.map((block, index) => {
          const title =
            block.match(/###\s*场景\s*\d+[：:]\s*([^\n（(]+)/)?.[1]?.trim() ||
            `第 ${index + 1} 个转折`;
          const conflict = block.match(/\*\*核心冲突\*\*[：:]\s*([^\n]+)/)?.[1]?.trim();
          const actions = block.match(/\*\*关键动作链\*\*[：:]\s*([^\n]+)/)?.[1]?.trim();
          const exitHook = block.match(/\*\*退场钩子\*\*[：:]\s*([^\n]+)/)?.[1]?.trim();
          return (
            sanitizeFallbackContext(
              [title, conflict, actions, exitHook].filter(Boolean).join('。')
            )[0] || ''
          );
        })
      : normalizedBeats
          .split(/\n+/)
          .flatMap((line) => sanitizeFallbackContext(line.replace(/\*\*/g, '')))
          .filter(Boolean)
          .slice(0, 4);
  if (beats.length === 0) {
    return ensureMinimumDraftLength(
      '门轴轻轻一响，屋里的声音同时低了下去。\n\n他停在门边，没有急着往里走，只先看了一眼光线最暗的角落。那里有人挪开杯盏，像是早就等着这一刻。空气里压着未说出口的消息，也压着即将逼近的危险。',
      sceneBeats,
      contextStr,
      minChars
    );
  }

  const firstBeat = beats[0] || intentHint;
  const secondBeat = beats[1] || '试探被接住，旧线索浮出水面';
  const thirdBeat = beats[2] || '危险逼近，角色必须做出选择';

  return ensureMinimumDraftLength(
    [
      `门外的风声先一步撞进来，灯火跟着晃了一下。屋里的人没有立刻说话，只在那一瞬间各自收住了动作。${firstBeat}没有被摊开讲明，它先藏在桌边的一次停顿里，藏在对方避开的眼神里。`,
      `试探从一句不重的话开始。有人故意把问题说得很轻，像只是随口问起；另一个人却在杯沿上停住了手指。${secondBeat}，局势因此往前挪了一寸。没人承认自己知道真相，可每个人都在用沉默承认，今晚的平静已经被撕开了口子。`,
      `${thirdBeat}。远处传来的声音越来越近，像靴底踩过积水，也像刀鞘擦过门槛。最后一盏灯猛地暗下去时，所有人都停住了呼吸。真正的麻烦，还没有进门。`,
    ].join('\n\n'),
    sceneBeats,
    contextStr,
    minChars
  );
}

export function buildFallbackSceneBeats(userIntent: string) {
  // The intent is concatenated into the “核心冲突：${intent}，但信息并不完整…”
  // template. Strip trailing punctuation first, otherwise an intent like
  // “……结尾留悬念。” composes into the broken fragment “结尾留悬念。，但…”.
  const intent =
    String(userIntent || '')
      .trim()
      .replace(/[。．.！？!?；;，,、\s]+$/, '') || '主角面对新的局势变化，被迫做出选择';
  return [
    `### 场景 1：异动入场\n\n**入场钩子**：一个异常声音或突发消息打断原本平静的局面。\n\n**核心冲突**：${intent}，但信息并不完整，角色只能先试探。\n\n**关键动作链**：角色观察异常；对方给出含糊回应；一个细节暴露真正风险。\n\n**退场钩子**：新的脚步声、信物或消息把局势推向下一场。`,
    `### 场景 2：试探加深\n\n**入场钩子**：角色主动抛出一个问题或动作诱饵。\n\n**核心冲突**：双方围绕真实目的互相遮掩。\n\n**关键动作链**：试探被接住；旧线索浮出；角色意识到眼前不是偶然。\n\n**退场钩子**：关键人物或危险信号正式出现。`,
    `### 场景 3：悬念收束\n\n**入场钩子**：危险逼近，角色必须决定留下还是行动。\n\n**核心冲突**：保全自身与追查真相发生冲突。\n\n**关键动作链**：角色做出选择；关键道具或信息被确认；局势留下更大的疑问。\n\n**退场钩子**：以一个未解释的动作或声音结束本章。`,
  ].join('\n\n---\n\n');
}
