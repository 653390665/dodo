import { sanitizeFallbackContext, validateDraftQuality } from '../../shared/lib/draft-quality';

export const MIN_CHAPTER_DRAFT_CHARS = 4000;

export function countDraftChars(text: string) {
  return text.replace(/\s/g, '').length;
}

export function expandDraftToMinimum(baseDraft: string, sceneBeats: string, contextStr: string, minChars?: number) {
  const effectiveMin = minChars && minChars >= 200 ? minChars : MIN_CHAPTER_DRAFT_CHARS;
  const normalizedBeats = String(sceneBeats || '').trim();
  const contextLines = sanitizeFallbackContext(String(contextStr || '').replace(/[【】<>]/g, ''));
  const isFallbackTemplate = /异动入场|试探加深|悬念收束/.test(normalizedBeats);
  const beatHints = isFallbackTemplate
    ? sanitizeFallbackContext(normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n]+)/)?.[1] || '').slice(0, 2)
    : sanitizeFallbackContext(normalizedBeats.replace(/\*\*/g, '').replace(/^#+\s*/gm, '')).slice(0, 12);
  const hints = [...beatHints, ...contextLines].filter(Boolean);
  const seed = hints[0] || '这场变故没有给任何人留下退路';
  const hintSentence = (hint: string) => `${hint.replace(/[。！？!?；;，,]+$/, '')}。`;

  const paragraphTemplates = [
    (hint: string) => `屋里先静了一拍。${hintSentence(hint)}这件事没有被谁说破，只从一束避开的目光、一次收回的手势里露了个边。`,
    (hint: string) => `他把杯沿转了半圈，借着这个动作重新看清每个人的位置。${hintSentence(hint)}这条线索落在眼前，像一枚暂时无法归类的证物。`,
    (hint: string) => `对方开口时刻意放低了声音，句尾还留着一点空白。${hintSentence(hint)}这让一句看似寻常的话多出一层试探。`,
    (hint: string) => `窗纸被风顶得向内一鼓，外面的脚步随即停住。${hintSentence(hint)}线索在这点停顿里变得具体，逼得屋内的人重新斟酌下一步。`,
    (hint: string) => `他没有顺着对方递来的解释往下走，而是盯住了那处被忽略的细节。${hintSentence(hint)}它像从雨水里浮出的细线，牵着更深的麻烦。`,
    (hint: string) => `短暂的僵持被一个细小动作打破：有人挪开椅子，有人按住袖口。${hintSentence(hint)}这个变化把各自的打算照出一角。`,
    (hint: string) => `他只问了一个不带锋芒的问题，屋里的空气却立刻换了方向。${hintSentence(hint)}疑问从暗处向前挪了一步，仍旧没有露出全部答案。`,
    (hint: string) => `门外的声音远了一些，没人因此松气。${hintSentence(hint)}它反倒像一条新的界线，提醒他们刚才的选择已经留下痕迹。`,
    (hint: string) => `桌面上的水痕被灯光切成两段，他顺着那道反光看向角落。${hintSentence(hint)}细节与眼前的沉默叠在一起，指向同一个未完的疑问。`,
    (hint: string) => `有人把准备好的话咽了回去，改用指节轻敲桌面。${hintSentence(hint)}异样没有得到确认，却让等待本身成了回答。`,
    (hint: string) => `他退开半步，把门口让出一条窄缝。${hintSentence(hint)}冷风带进来的不只是雨气，还有这个细节留下的压力。`,
    (hint: string) => `对方的手停在半空，像是在衡量一件看不见的东西。${hintSentence(hint)}线索于是被放到两人之间，谁先碰它，谁就得先承担后果。`,
    (hint: string) => `远处传来一声短促的金属碰撞，谈话被迫停下。${hintSentence(hint)}它从背景里浮出来，成为此刻唯一不能忽略的线索。`,
    (hint: string) => `他记住了那一瞬间的顺序：先是灯影晃动，随后才有人移步。${hintSentence(hint)}这个细节没有解释一切，却让下一步有了明确方向。`,
    (hint: string) => `屋里的人各自做了选择，有人靠近出口，有人守住桌边。${hintSentence(hint)}这件事将这些选择串在一起，形成一场尚未落幕的较量。`,
    (hint: string) => `最后一句话落下后，谁也没有接住。${hintSentence(hint)}疑问留在半空，像一扇尚未推开的门，门后传来更近的脚步。`,
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
  ];
  const cycleBridges = [
    '局面再次偏转，没人再把它当作巧合。',
    '新的细节压上来，先前的判断必须重新排列。',
    '局面没有回到原点，所有人的选择都留下了痕迹。',
    '下一步已经逼到门口，沉默也不再提供遮掩。',
  ];
  while (countDraftChars(draft) < effectiveMin) {
    const cycle = Math.floor(index / paragraphTemplates.length);
    const hint = hints[index]
      || detailHints[(index - hints.length + cycle * 3) % (isFallbackTemplate ? 16 : detailHints.length)]
      || seed;
    // A bridge marks the start of a new pass through the scene templates. It
    // must not be appended to every paragraph or it becomes a repeated slogan.
    const bridge = cycle > 0 && index % paragraphTemplates.length === 0
      ? cycleBridges[(cycle - 1) % cycleBridges.length]
      : '';
    let action = paragraphTemplates[index % paragraphTemplates.length](hint);
    if (!isFallbackTemplate && index % paragraphTemplates.length === 2) {
      action = action.replace(
        '这让一句看似寻常的话多出一层试探。',
        `这让${hint.replace(/[。！？!?；;，,]+$/, '')}的意味又重了一层。`,
      );
    }
    if (!isFallbackTemplate && index % paragraphTemplates.length === 5) {
      action = action.replace(
        '这个变化把各自的打算照出一角。',
        `这个变化让${hint.replace(/[。！？!?；;，,]+$/, '')}显出新的方向。`,
      );
    }
    const supportIndex = (index + cycle * 5) % cadence.length;
    // A planner-generated fallback is intentionally kept behind the quality
    // gate: its structured beats are not prose. Ordinary orchestration
    // fallbacks, however, still need a readable deterministic draft. Avoid
    // re-inserting the same detail as both the action hint and support line;
    // that was the source of the duplicate-sentence gate failures.
    const support = isFallbackTemplate
      ? index % 2 === 0
        ? `${cadence[supportIndex]}${texture[(supportIndex + 3) % texture.length]}`
        : `${detailHints[supportIndex]}。${reflection[(supportIndex + 3) % reflection.length]}`
      : index % 2 === 0
        ? cadence[supportIndex]
        : reflection[(supportIndex + 3) % reflection.length];
    const turnLine = turn[(index + cycle * 7) % turn.length];
    const paragraph = (isFallbackTemplate
      ? `${action}${support}${turnLine}${bridge}`
      : `${action}${support}${turnLine}${bridge}`
        .replace(/他没有/g, '他并未')
        .replace(/没有人/g, '谁也不')
        .replace(/危险却没有退去/g, '危险仍在原处')
        .replace(/这一次/g, '这一回'));
    draft = draft ? `${draft}\n\n${paragraph}` : paragraph;
    index += 1;
  }
  return draft;
}

export function ensureMinimumDraftLength(draft: string, sceneBeats: string, contextStr: string, minChars?: number) {
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
  const intentHint = sanitizeFallbackContext(
    normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n。]+)/)?.[1]?.trim() || '',
  )[0]
    || '一场试探正在逼近真正的危险';

  // Detect fallback template markers — if the scene beats are AI-generated templates
  // rather than real content, use natural prose fallback instead
  const isFallbackTemplate = /异动入场|试探加深|悬念收束/.test(normalizedBeats);
  if (isFallbackTemplate) {
    const userIntent = sanitizeFallbackContext(
      normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n。，]+)/)?.[1]?.trim() || '',
    )[0] || '';
    const hintText = userIntent ? ` —— ${userIntent}` : '';
    return ensureMinimumDraftLength([
      `门轴轻轻一响，屋里的声音同时低了下去。`,
      ``,
      `他停在门边，没有急着往里走，只先看了一眼光线最暗的角落。那里有人挪开杯盏，像是早就等着这一刻${hintText}。`,
      `空气里压着未说出口的消息，也压着即将逼近的危险。`,
    ].join('\n'), sceneBeats, contextStr, minChars);
  }
  const sceneBlocks = normalizedBeats
    .split(/\n\s*---\s*\n|(?=###\s*场景)/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 4);
  const beats = sceneBlocks.length > 0
    ? sceneBlocks.map((block, index) => {
        const title = block.match(/###\s*场景\s*\d+[：:]\s*([^\n（(]+)/)?.[1]?.trim() || `第 ${index + 1} 个转折`;
        const conflict = block.match(/\*\*核心冲突\*\*[：:]\s*([^\n]+)/)?.[1]?.trim();
        const actions = block.match(/\*\*关键动作链\*\*[：:]\s*([^\n]+)/)?.[1]?.trim();
        const exitHook = block.match(/\*\*退场钩子\*\*[：:]\s*([^\n]+)/)?.[1]?.trim();
        return sanitizeFallbackContext([title, conflict, actions, exitHook].filter(Boolean).join('。'))[0] || '';
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
      minChars,
    );
  }

  const firstBeat = beats[0] || intentHint;
  const secondBeat = beats[1] || '试探被接住，旧线索浮出水面';
  const thirdBeat = beats[2] || '危险逼近，角色必须做出选择';

  return ensureMinimumDraftLength([
    `门外的风声先一步撞进来，灯火跟着晃了一下。屋里的人没有立刻说话，只在那一瞬间各自收住了动作。${firstBeat}没有被摊开讲明，它先藏在桌边的一次停顿里，藏在对方避开的眼神里。`,
    `试探从一句不重的话开始。有人故意把问题说得很轻，像只是随口问起；另一个人却在杯沿上停住了手指。${secondBeat}，局势因此往前挪了一寸。没人承认自己知道真相，可每个人都在用沉默承认，今晚的平静已经被撕开了口子。`,
    `${thirdBeat}。远处传来的声音越来越近，像靴底踩过积水，也像刀鞘擦过门槛。最后一盏灯猛地暗下去时，所有人都停住了呼吸。真正的麻烦，还没有进门。`,
  ].join('\n\n'), sceneBeats, contextStr, minChars);
}

export function buildFallbackSceneBeats(userIntent: string) {
  const intent = String(userIntent || '').trim() || '主角面对新的局势变化，被迫做出选择';
  return [
    `### 场景 1：异动入场\n\n**入场钩子**：一个异常声音或突发消息打断原本平静的局面。\n\n**核心冲突**：${intent}，但信息并不完整，角色只能先试探。\n\n**关键动作链**：角色观察异常；对方给出含糊回应；一个细节暴露真正风险。\n\n**退场钩子**：新的脚步声、信物或消息把局势推向下一场。`,
    `### 场景 2：试探加深\n\n**入场钩子**：角色主动抛出一个问题或动作诱饵。\n\n**核心冲突**：双方围绕真实目的互相遮掩。\n\n**关键动作链**：试探被接住；旧线索浮出；角色意识到眼前不是偶然。\n\n**退场钩子**：关键人物或危险信号正式出现。`,
    `### 场景 3：悬念收束\n\n**入场钩子**：危险逼近，角色必须决定留下还是行动。\n\n**核心冲突**：保全自身与追查真相发生冲突。\n\n**关键动作链**：角色做出选择；关键道具或信息被确认；局势留下更大的疑问。\n\n**退场钩子**：以一个未解释的动作或声音结束本章。`,
  ].join('\n\n---\n\n');
}
