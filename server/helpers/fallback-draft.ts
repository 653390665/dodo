export const MIN_CHAPTER_DRAFT_CHARS = 4000;

export function countDraftChars(text: string) {
  return text.replace(/\s/g, '').length;
}

export function expandDraftToMinimum(baseDraft: string, sceneBeats: string, contextStr: string) {
  const normalizedBeats = String(sceneBeats || '').trim();
  const contextLines = String(contextStr || '')
    .split(/\n+/)
    .map((line) => line.replace(/[【】<>]/g, '').trim())
    .filter((line) => line.length > 8)
    .slice(0, 8);
  const beatHints = normalizedBeats
    .split(/\n+/)
    .map((line) => line.replace(/^[-*#\d.、\s]+/, '').replace(/\*\*/g, '').trim())
    .filter((line) => line.length > 6)
    .slice(0, 12);
  const hints = [...beatHints, ...contextLines].filter(Boolean);
  const seed = hints[0] || '这场变故没有给任何人留下退路';

  const paragraphTemplates = [
    (hint: string, index: number) => `第${index + 1}次沉默落下时，屋里每个人都听见了自己呼吸里的犹疑。${hint}没有立刻变成答案，它先变成一束目光，一次停顿，一句被咽回去的话。有人试图把局面拉回原来的轨道，可桌面上那点细微的痕迹已经足够说明，真正的变化早在他们察觉之前就开始了。`,
    (hint: string) => `他没有急着追问，只把眼前的细节一件件压进心里。灯影、杯沿、袖口、门缝里漏进来的风，都像在替${hint}作证。越是无人承认，越说明这件事不能被轻易说破；越是有人装作镇定，越能看出暗处的压力正在向这里合拢。`,
    (hint: string) => `对方终于开口，声音却比预想中更轻。那不是解释，更像一次试探：既想确认他知道多少，又怕自己先露出破绽。${hint}因此被推到两人中间，像一枚没有点燃的火折子，只差一点风，就能把整间屋子的平静烧穿。`,
    (hint: string) => `外面的动静越来越近，最初只是若有若无的脚步，后来变成短促的停顿和压低的交谈。有人往窗边看了一眼，又立刻移开视线。${hint}在这一刻不再只是猜测，它开始拥有重量，压得桌边的人不得不重新计算每一句话的代价。`,
    (hint: string) => `他想起此前被忽略的一处细节，忽然明白自己真正该防备的并不是眼前这句话，而是这句话背后被藏起来的顺序。${hint}像一条被雨水冲出的暗线，从门口一直延到更深的地方。若顺着它走下去，今晚就不会只是一场偶遇。`,
    (hint: string) => `短暂的僵持之后，局面终于出现裂口。有人先退半步，有人悄悄握紧手边的东西，也有人把早已准备好的说辞重新吞了回去。${hint}把所有人的位置都照得清清楚楚：谁在拖延，谁在等待，谁又已经决定把风险推给别人。`,
    (hint: string) => `他没有给对方继续遮掩的机会，只用一句平稳的话把那层薄纸挑开。屋里安静了一瞬，随后所有细小的声音都变得刺耳。${hint}终于从暗处露出边缘，却仍旧没有露出全貌，像故意留下半截影子，逼人往下一步追。`,
    (hint: string) => `等到门外的声音停住，屋里反而更冷了。没人知道下一刻推门进来的会是谁，也没人能保证自己刚才的选择还能收回。${hint}成了最后的分界线：越过它，所有试探都会变成行动，所有含糊的承诺都会被迫兑现。`,
  ];

  let draft = baseDraft.trim();
  let index = 0;
  while (countDraftChars(draft) < MIN_CHAPTER_DRAFT_CHARS) {
    const hint = hints[index % hints.length] || seed;
    const paragraph = paragraphTemplates[index % paragraphTemplates.length](hint, index);
    draft = draft ? `${draft}\n\n${paragraph}` : paragraph;
    index += 1;
  }
  return draft;
}

export function ensureMinimumDraftLength(draft: string, sceneBeats: string, contextStr: string) {
  if (countDraftChars(draft) >= MIN_CHAPTER_DRAFT_CHARS) {
    return draft;
  }
  return expandDraftToMinimum(draft, sceneBeats, contextStr);
}

export function buildFallbackDraft(sceneBeats: string, contextStr: string) {
  const normalizedBeats = String(sceneBeats || '').trim();
  const intentHint = normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n。]+)/)?.[1]?.trim()
    || '一场试探正在逼近真正的危险';

  // Detect fallback template markers — if the scene beats are AI-generated templates
  // rather than real content, use natural prose fallback instead
  const isFallbackTemplate = /异动入场|试探加深|悬念收束/.test(normalizedBeats);
  if (isFallbackTemplate) {
    const userIntent = normalizedBeats.match(/\*\*核心冲突\*\*[：:]\s*([^\n。，]+)/)?.[1]?.trim() || '';
    const hintText = userIntent ? ` —— ${userIntent}` : '';
    return ensureMinimumDraftLength([
      `门轴轻轻一响，屋里的声音同时低了下去。`,
      ``,
      `他停在门边，没有急着往里走，只先看了一眼光线最暗的角落。那里有人挪开杯盏，像是早就等着这一刻${hintText}。`,
      `空气里压着未说出口的消息，也压着即将逼近的危险。`,
    ].join('\n'), sceneBeats, contextStr);
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
        return [title, conflict, actions, exitHook].filter(Boolean).join('。');
      })
    : normalizedBeats
        .split(/\n+/)
        .map((line) => line.replace(/^[-*\d.、\s]+/, '').replace(/\*\*/g, '').trim())
        .filter(Boolean)
        .slice(0, 4);
  if (beats.length === 0) {
    return ensureMinimumDraftLength(
      '门轴轻轻一响，屋里的声音同时低了下去。\n\n他停在门边，没有急着往里走，只先看了一眼光线最暗的角落。那里有人挪开杯盏，像是早就等着这一刻。空气里压着未说出口的消息，也压着即将逼近的危险。',
      sceneBeats,
      contextStr,
    );
  }

  const firstBeat = beats[0] || intentHint;
  const secondBeat = beats[1] || '试探被接住，旧线索浮出水面';
  const thirdBeat = beats[2] || '危险逼近，角色必须做出选择';

  return ensureMinimumDraftLength([
    `门外的风声先一步撞进来，灯火跟着晃了一下。屋里的人没有立刻说话，只在那一瞬间各自收住了动作。${firstBeat}没有被摊开讲明，它先藏在桌边的一次停顿里，藏在对方避开的眼神里。`,
    `试探从一句不重的话开始。有人故意把问题说得很轻，像只是随口问起；另一个人却在杯沿上停住了手指。${secondBeat}，局势因此往前挪了一寸。没人承认自己知道真相，可每个人都在用沉默承认，今晚的平静已经被撕开了口子。`,
    `${thirdBeat}。远处传来的声音越来越近，像靴底踩过积水，也像刀鞘擦过门槛。最后一盏灯猛地暗下去时，所有人都停住了呼吸。真正的麻烦，还没有进门。`,
  ].join('\n\n'), sceneBeats, contextStr);
}

export function buildFallbackSceneBeats(userIntent: string) {
  const intent = String(userIntent || '').trim() || '主角面对新的局势变化，被迫做出选择';
  return [
    `### 场景 1：异动入场\n\n**入场钩子**：一个异常声音或突发消息打断原本平静的局面。\n\n**核心冲突**：${intent}，但信息并不完整，角色只能先试探。\n\n**关键动作链**：角色观察异常；对方给出含糊回应；一个细节暴露真正风险。\n\n**退场钩子**：新的脚步声、信物或消息把局势推向下一场。`,
    `### 场景 2：试探加深\n\n**入场钩子**：角色主动抛出一个问题或动作诱饵。\n\n**核心冲突**：双方围绕真实目的互相遮掩。\n\n**关键动作链**：试探被接住；旧线索浮出；角色意识到眼前不是偶然。\n\n**退场钩子**：关键人物或危险信号正式出现。`,
    `### 场景 3：悬念收束\n\n**入场钩子**：危险逼近，角色必须决定留下还是行动。\n\n**核心冲突**：保全自身与追查真相发生冲突。\n\n**关键动作链**：角色做出选择；关键道具或信息被确认；局势留下更大的疑问。\n\n**退场钩子**：以一个未解释的动作或声音结束本章。`,
  ].join('\n\n---\n\n');
}
