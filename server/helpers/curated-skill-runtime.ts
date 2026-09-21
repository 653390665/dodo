import { CURATED_PRODUCT_SKILLS } from '../../shared/lib/curated-product-skills.js';
import { sanitizeWhiteLabelText } from '../../shared/lib/prompt-sanitizer.js';

/**
 * 私有提示词大包字典 (IP Protection Matrix)
 * 彻底从前端引用的 shared 目录中剥离，放在纯服务端，阻断提示词大包被打包进入前端 bundle
 */
const PRIVATE_CURATED_TEMPLATES: Record<string, string> = {
  'opening-gold-three':
    '你现在是顶流网文导师。请结合大纲展开前三章，每章必须建立一个强烈的情节钩子和完读悬念，保证节奏紧凑、戏剧张力拉满。',
  'opening-novelty-hook':
    '结合番茄与各大顶流网文标准，重点审视主角金手指是否在前三章显露、反派智商是否在线以及剧情钩子是否合理。',
  'bible-world-builder':
    '你现在是奇幻科幻设定专家。请协助完善作品的世界观构架，包含力量等级分划、核心法则、冲突流派等，确保设定无死角且自洽。',
  'bible-character-arc':
    '请生成具有多维度立体人设的角色卡，包含性格缺陷、潜在成长动机、对主角态度及核心金手指，拒绝千人一面的扁平角色。',
  'refine-character-rebuild':
    '下面提供的是作者既有的角色资料，属于既定事实：必须全部保留，不得新增与之冲突的设定。请只做结构性重组：消解自相矛盾之处、补齐动机链与成长弧光、标明金手指适配点，并将不可动摇的事实写入 immutableFacts，输出完整角色卡。',
  'refine-outline-rebuild':
    '下面提供的是作者既有的大纲与设定资料，属于既定事实：既有人物、世界观与关键节点必须全部保留，不得新增与之冲突的事实。请只做结构性重组：修补剧情断点、拉齐因果链、强化钩子与爽点分布，输出结构化大纲。',
  'prose-mouth-flavor':
    '请使用极其干净流畅、带有一流网文节奏的口语化行文撰写小说，拒绝掉书袋与文绉绉的机械翻译腔，用高频交互与爽点推进情节。文风基准——只模仿下列句式节奏与幽默感，禁止复用其具体情节与专有名词：短句直给，冷幽默藏在叙述里而非旁白解说；用精确到荒诞的数字制造喜感（示例节奏："老街三百二十七块地砖，十九块是松的，他知道是哪十九块"）；对话短、糙、有脾气（示例节奏："不死人我不去"）；每个段落落在具体动作或物件上，不落在情绪总结上。',
  'prose-action-booster':
    '你现在是电影感主笔。请在人物交谈或对决时，融入细微的表情、动作反应、环境描写（如声音、光影、粘稠、冷峻等），避免站桩。',
  'audit-logical-sanity':
    '请作为极其刻苛的小说金牌主编，通读该章节，严格指出任何角色言行不合常识、剧情逻辑断层、突兀转折和降智细节，并给出具体修改指南。',
  'audit-cliche-detector':
    '作为反AI陈词滥调专家，请通读以下内容，找出一切像“然而”、“不得不”、“勾勒”、“闪烁”、“正如...那样”等高频无意义词汇并提出净化方案。',
  'de-ai-slop-shield':
    '请清洗段落中的AI陈词滥调，剔除无意义的排比和空洞的情感口号。将所有套话转换为更具有画面、动作、心理或写实代入感的原生中国网文描写。',
  'de-ai-rhythm-restorer':
    '请通过重组行文结构、合理截断句子与增减动词，将这一段呆板的AI语流重构为长短相间、起承转合自然、富有灵性网文节奏的极品段落。',
  // Plan 259 后续：长篇商业连载流程的大纲方法论卡（user-authorized 白标资产）接入私表，
  // 使其可通过 /api/generate-outline 的 techniqueId 通道驱动项目大纲重构。
  'private-175':
    '你是百万字长篇大纲架构师。按核心创意输出万字级大纲：1）五卷结构，每卷含卷名、核心冲突、主角能力/地位起点与终点、关键配角进出表；2）三线主线（明线事件链、暗线阴谋链、感情线）逐卷各给三个节点；3）每卷末标注一个大高潮与一个伏笔回收点；4）卷与卷之间写明因果推进句，禁止并列堆砌。输出：分卷大纲，按万字级展开。',
  // Plan 259 后续：长篇商业连载流程的章纲卡（user-authorized 白标资产）同步接入。
  'private-179':
    '你是长篇章纲写手。输入卷大纲与当前进度后输出本章纲：1）字段含章节目标、出场人物、三个场景节拍、冲突升级方式、信息增量、章末钩子；2）每场景标注地点与时间差，禁止无时空锚点的空转对话；3）本章必须推进主线一格并维护一条支线，写明推进内容；4）与前章衔接处用一句承接说明。输出：结构化章纲。',
  'platform-tomato-scoring':
    '对照番茄爆款模型 and 签约红线，严厉质检作品是否具备钩子、爽点、节奏反转及金手指是否足够吸睛，给出一个100分制模拟得分及改进硬建议。',
  'platform-webnovel-criteria':
    '请评估作品对欧美读者的爽点穿透力。重点检测：主角冲突的爽度显露是否够快、系统力量面板是否够直观、反派欺压是否极致、升级奖励是否清晰。',
  'style-cthulhu-mystique':
    '你现在是克苏鲁流派小说大师。请在行文中加入不可名状的冰冷黏腻感、细碎低语与压抑张力，重点提炼环境的腐朽感与角色心智的颤栗。',
  'style-ancient-elegance':
    '请用具有古典雅韵、唯美工整的句式润色文字。重点修饰人物衣着、簪发细节、古典园林、茶礼景致，增添清雅悠远的古典美感。',
  'deconstruct-golden-climax':
    '作为资深网文拆书专家。请提取神作名篇中的高爽节奏、核心装逼打脸、冲突对立与情绪顶点分布，转化为极其精细的节奏和步骤拆书卡。',
  'deconstruct-suspense-hook':
    '请剖析指定故事切片在章尾、章首拉满完读率的草蛇灰线手法，梳理出其悬念铺设和解答时机的黄金公式，生成极其细致的引导词卡片。',
};

/** Returns the server-only prompt for a governed curated technique. */
export function resolveCuratedTechniquePrompt(id: string): string | undefined {
  const template = PRIVATE_CURATED_TEMPLATES[id];
  return template ? sanitizeWhiteLabelText(template) : undefined;
}

/**
 * 运行时解密还原引擎：在拼装 Prompt 阶段将占位符还原并做脱敏。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveRuntimeCuratedPrompts(skills: any[]): any[] {
  if (!skills) return [];
  return skills.map((s) => {
    if (s.style === 'INKFLOW_CURATED_RUNTIME_DECOUPLED_PLACEHOLDER') {
      const parentId = s.parentSkillId || s.id?.split('-clone-')[0];
      const rawTemplate = PRIVATE_CURATED_TEMPLATES[parentId];
      const match = CURATED_PRODUCT_SKILLS.find((c) => c.id === parentId);
      if (rawTemplate && match) {
        return {
          ...s,
          style: sanitizeWhiteLabelText(rawTemplate),
          pacing: sanitizeWhiteLabelText(match.successSignal || s.pacing || ''),
          description: sanitizeWhiteLabelText(match.goal || s.description || ''),
        };
      }
    }
    return s;
  });
}
