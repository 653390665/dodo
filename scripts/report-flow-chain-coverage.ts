/**
 * capB：链路 × 卡片配合进入普查 —— 30 步引用了哪些卡、维度分布、引导缺口。
 * 运行：npx tsx scripts/report-flow-chain-coverage.ts
 */
import { SKILL_SERIES_FLOWS, PROMPT_GOVERNANCE_CATALOG } from '../shared/lib/prompt-governance-catalog.js';
import { isShellTemplatePrompt } from '../shared/lib/prompt-shell.js';

type Step = (typeof SKILL_SERIES_FLOWS)[number]['steps'][number];

const DIMENSIONS: Array<{ label: string; pattern: RegExp }> = [
  { label: '创意构思', pattern: /灵感|脑洞|创意|火花|题材/ },
  { label: '世界观', pattern: /世界观|设定|神系|谱系|规则/ },
  { label: '人物', pattern: /人物|角色|对白|人物弧|关系/ },
  { label: '道具', pattern: /道具|遗物|物品|装备/ },
  { label: '副本', pattern: /副本|悬疑|案件|事件|场景单元|单元/ },
  { label: '大纲', pattern: /大纲|三幕|结构|卷|主线/ },
  { label: '细纲', pattern: /细纲|逐章|分章|章节规划|章纲/ },
  { label: '正文', pattern: /正文|写作|扩写|生成/ },
  { label: '审稿精修', pattern: /审|诊断|质检|精修|润色|拆解|评分/ },
];

function dimensionOf(step: Step): string {
  const text = `${step.name} ${step.description} ${step.input} ${step.output}`;
  for (const { label, pattern } of DIMENSIONS) {
    if (pattern.test(text)) return label;
  }
  return '其他';
}

const assetById = new Map(PROMPT_GOVERNANCE_CATALOG.map((a) => [a.id, a]));
const referenced = new Map<string, string[]>();
const dimensionStats = new Map<string, { steps: number; runnable: number; guidance: number; assets: Set<string> }>();

let totalSteps = 0;
let runnable = 0;
let guidance = 0;
let withCardRef = 0;
let withGate = 0;

console.log('=== 逐链路步骤 → 卡片 → 维度 ===');
for (const flow of SKILL_SERIES_FLOWS) {
  console.log(`\n[${flow.id}] ${flow.name ?? ''}`);
  for (const step of flow.steps) {
    totalSteps += 1;
    const asset = assetById.get(step.assetId);
    const shell = !asset || isShellTemplatePrompt(asset.template);
    const guidanceOnly = Boolean((step as unknown as { guidanceOnly?: boolean }).guidanceOnly) || shell;
    if (guidanceOnly) guidance += 1;
    else runnable += 1;
    if (step.cardRef) withCardRef += 1;
    if (step.gate) withGate += 1;
    referenced.set(step.assetId, [...(referenced.get(step.assetId) ?? []), `${flow.id}/${step.id}`]);

    const dim = dimensionOf(step);
    const slot = dimensionStats.get(dim) ?? { steps: 0, runnable: 0, guidance: 0, assets: new Set<string>() };
    slot.steps += 1;
    if (guidanceOnly) slot.guidance += 1;
    else slot.runnable += 1;
    slot.assets.add(step.assetId);
    dimensionStats.set(dim, slot);

    console.log(
      [
        `  step${step.stepNumber}`,
        dim,
        `stage=${step.stage ?? '(未声明)'}`,
        guidanceOnly ? '仅引导' : '可运行',
        `asset=${step.assetId}`,
        `assetCat=${asset?.primaryCategory ?? '(缺卡)'}/${asset?.stage ?? '-'}`,
        asset ? `assetScore=${asset.score}` : '',
        step.cardRef ? `cardRef=${JSON.stringify(step.cardRef)}` : '',
        step.gate ? `gate=${JSON.stringify(step.gate)}` : '',
      ]
        .filter(Boolean)
        .join(' | ')
    );
  }
}

console.log('\n=== 维度汇总（用户口径：创意构思/世界观/人物/道具/副本/大纲/细纲…） ===');
for (const [dim, s] of [...dimensionStats.entries()].sort((a, b) => b[1].steps - a[1].steps)) {
  console.log(`  ${dim}: 步骤 ${s.steps} · 可运行 ${s.runnable} · 仅引导 ${s.guidance} · 关联卡 ${s.assets.size} 张 → ${[...s.assets].join(', ')}`);
}

console.log('\n=== 汇总 ===');
console.log(`  步骤总数 ${totalSteps} · 可运行 ${runnable} (${((runnable / totalSteps) * 100).toFixed(1)}%) · 仅引导 ${guidance}`);
console.log(`  声明 cardRef 的步骤: ${withCardRef} · 声明 gate 的步骤: ${withGate}`);
console.log(`  被链路引用的不同资产: ${referenced.size} / 目录 ${PROMPT_GOVERNANCE_CATALOG.length}`);
const readyAssets = PROMPT_GOVERNANCE_CATALOG.filter((a) => a.isRuntimeReady);
console.log(`  目录中 runtime-ready: ${readyAssets.length}；其中被链路引用: ${readyAssets.filter((a) => referenced.has(a.id)).length}`);
console.log(`  runtime-ready 但从未被任何链路步骤引用: ${readyAssets.filter((a) => !referenced.has(a.id)).length}`);

console.log('\n=== 被引用资产 × 引用它的步骤 ===');
for (const [assetId, where] of [...referenced.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
  const asset = assetById.get(assetId);
  console.log(`  ${assetId}（${asset?.title ?? '缺卡'}）score=${asset?.score ?? '-'} cat=${asset?.primaryCategory ?? '-'} → ${where.length} 处: ${where.join(', ')}`);
}
