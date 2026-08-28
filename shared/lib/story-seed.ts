export function sanitizeIdeaSeed(raw: string): string {
  return raw
    .replace(/^我想写一个?\s*/g, '')
    .replace(/^我想写\s*/g, '')
    .replace(/^想写一个?\s*/g, '')
    .replace(/^想写\s*/g, '')
    .replace(/^写一个?\s*/g, '')
    .replace(/^写\s*/g, '')
    .replace(/^关于\s*/g, '')
    .replace(/^一个?\s*/g, '')
    .replace(/[「」『』""''【】]/g, '')
    .replace(/^[，,。！？、；：\s]+/g, '')
    .trim();
}

export type StorySeedQuality =
  | { status: 'ok' }
  | { status: 'needs_clarification'; error: string; questions: string[] };

function calcCharDiversity(text: string): number {
  const chars = text.replace(/[^一-鿿]/g, '');
  if (chars.length === 0) return 0;
  const unique = new Set(chars);
  return unique.size / chars.length;
}

function detectCharRepetition(text: string): boolean {
  const chineseOnly = text.replace(/[^一-鿿]/g, '');
  if (chineseOnly.length < 3) return false;
  const freq = new Map<string, number>();
  for (const ch of chineseOnly) freq.set(ch, (freq.get(ch) || 0) + 1);
  const maxFreq = Math.max(...freq.values());
  return maxFreq / chineseOnly.length > 0.6;
}

function detectDigitNoise(text: string): boolean {
  const chineseChars = text.replace(/[^一-鿿]/g, '');
  const digits = text.replace(/[^0-9]/g, '');
  return chineseChars.length === 0 && digits.length >= 4;
}

function hasConcreteElements(text: string): boolean {
  const chineseOnly = text.replace(/[^一-鿿]/g, '');
  if (chineseOnly.length === 0) return false;
  const functionWords = /[的了在是我不人他这个上下看着来去也就那要会可以还能没说过道得地里和自着之它们一个后大小多少怎么如果因为所以但是然而已经]/g;
  const funcCount = (chineseOnly.match(functionWords) || []).length;
  return funcCount / chineseOnly.length < 0.7;
}

function looksExpandableSeed(normalized: string, chineseChars: string): boolean {
  if (chineseChars.length < 5) return false;
  if (!hasConcreteElements(normalized)) return false;

  return /(故事|传说|江湖|长生|武侠|修仙|宗门|王朝|剑|刀|宫|城|记忆|世界|末日|异能|复仇|秘密|悬疑|案|夜|雨|人|者)$/.test(normalized)
    || /的故事|的人生|的传说|来了|恩怨|传奇|风云|秘闻|疑案|之谜/.test(normalized);
}

export function assessStorySeedQuality(seed: string): StorySeedQuality {
  const normalized = String(seed || '').trim();
  const chineseChars = normalized.replace(/[^\u4e00-\u9fff]/g, '');

  if (detectDigitNoise(normalized)) {
    return {
      status: 'needs_clarification',
      error: '输入全部是数字，看起来不像故事种子。请用中文描述你的故事念头。',
      questions: ['故事发生在哪里？', '主角是谁？', '第一件麻烦事是什么？'],
    };
  }

  if (chineseChars.length < 3) {
    return {
      status: 'needs_clarification',
      error: '输入太短，看不出故事方向。请补一个场景、人物或冲突。',
      questions: ['故事发生在哪里？', '谁遇到了麻烦？', '他/她想得到或逃开什么？'],
    };
  }

  if (/^[a-zA-Z0-9\s]+$/.test(normalized) && normalized.length < 20) {
    return {
      status: 'needs_clarification',
      error: '输入看起来像拼音或英文片段。请用中文写一句故事种子。',
      questions: ['故事发生在哪里？', '主角是谁？', '第一件麻烦事是什么？'],
    };
  }

  if (detectCharRepetition(normalized)) {
    return {
      status: 'needs_clarification',
      error: '输入中同一个字重复太多次，不像完整的故事描述。请写一个具体的场景或冲突。',
      questions: ['故事发生在哪里？', '主角遇到了什么麻烦？', '他/她想得到什么？'],
    };
  }

  const diversity = calcCharDiversity(normalized);
  if (chineseChars.length >= 6 && diversity < 0.35) {
    return {
      status: 'needs_clarification',
      error: '输入字符太单一，看不出故事轮廓。请用完整中文句子描述你的念头。',
      questions: ['故事发生在哪里？', '谁遇到了麻烦？', '他/她想得到或逃开什么？'],
    };
  }

  if (chineseChars.length >= 4 && !hasConcreteElements(normalized)) {
    return {
      status: 'needs_clarification',
      error: '输入几乎全是虚词，缺少具体的人物、场景或事件。请补一个具体的故事元素。',
      questions: ['这个故事里有谁？', '发生在哪里？', '最开始的冲突是什么？'],
    };
  }

  const storySignal =
    /(酒馆|客栈|便利店|雨夜|深夜|城市|王朝|江湖|学校|医院|公司|废墟|战场|世界|主角|少年|少女|刀客|乞丐|皇帝|杀手|医生|老师|陌生人|复仇|追杀|背叛|失踪|死亡|秘密|阴谋|危机|冲突|逃亡|相遇|救下|寻找|觉醒|穿越|重生|系统|记忆|契约|诅咒|灵气|异能|悬疑|恐惧|愤怒|孤独|爱恨|后悔|仙侠|玄幻|武侠|都市|科幻|末日|推理|恐怖|恋爱|青春|历史|权谋|商战|电竞|盗墓|探案|宫斗|种田|升级|打脸|逆袭|扮猪|吃虎|玉玺|古墓|门派|宗门|功法|修炼|考验|试炼|封印|结界|时空|平行|宇宙|星舰|机甲|丧尸|变异|进化|超能力|魔法|剑与|骑士|领主|贵族|奴隶|起义)/.test(normalized);
  const phraseLike = /[，,。！？、；：]/.test(normalized) || chineseChars.length >= 8;
  const expandableSeed = looksExpandableSeed(normalized, chineseChars);
  const obviousNoise = /^(不补|补哦|哦啵|哈哈|啊啊|嗯嗯|随便|测试|不知道|无所谓|没有想法|不造|母鸡|阿巴|阿吧|嘤嘤|呜呜|嘿嘿|嘻嘻|呵呵|emm|hhh|666|111|1234|abcd)/i.test(normalized);

  if ((!storySignal && !expandableSeed) || obviousNoise || (!phraseLike && !expandableSeed)) {
    return {
      status: 'needs_clarification',
      error: '这还不像故事种子。请补一个场景、人物、冲突或情绪后再生成。',
      questions: ['这个念头里的人物是谁？', '故事发生在什么地方？', '第一章最先爆发的冲突是什么？'],
    };
  }

  return { status: 'ok' };
}
